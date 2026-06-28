import { test, expect } from "@playwright/test";

// Deployed workerd smoke-gate — test-plan Phase 4, Risk #5: an SSR endpoint, the
// service worker, or env/secret access diverging on the deployed Cloudflare
// `workerd` runtime vs `astro dev` → builds clean, fails only in production.
// This spec runs against the LIVE Worker (baseURL is swapped to the deployed URL
// when SMOKE_DEPLOYED is set — see playwright.config.ts). Wrapped by
// `npm run smoke:deployed`, which captures `wrangler tail` evidence around it.
//
// Oracles are POSITIVE (a real status/body, not merely "no 500"): the dominant
// historical failure (an empty Worker secret) degrades to a quiet 503, and a
// dropped service worker degrades to a 404 — neither is an exception.
//
// Phase 1 rung: cheap UNAUTHENTICATED HTTP probes — no Supabase user, no DB
// write. They give an immediate workerd-init + dropped-SW signal on their own.
// Phase 2 rung: an authenticated create→put→delete round-trip (below) driving the
// real client→server sync path with positive body oracles.

test.describe("deployed workerd smoke — unauthenticated probes", () => {
  // The `deployed` project carries an authenticated storageState (for the round-
  // trip below); override it to empty here so the `request` fixture is genuinely
  // unauthenticated — otherwise the cookie would turn the 401 probe into a 200/204.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("service worker asset is served as JavaScript, not the 404 page", async ({ request }) => {
    // SW is emitted ONLY by the production build; a build/adapter regression that
    // drops /sw.js is invisible until you fetch it on the deployed Worker.
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("javascript");
  });

  test("web app manifest is served", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
  });

  test("home page renders (SSR on workerd)", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
  });

  test("sync endpoint rejects an unauthenticated request with 401", async ({ request }) => {
    // A clean 401 (not a 5xx) proves /api/inspections/sync's module-level import
    // graph — camelcase-keys, snakecase-keys, sync-payload-validation → part1-config
    // → zod — loaded on workerd without a Node-API throw. That graph is evaluated on
    // first load regardless of code path, so the auth-guard 401 already exercises it.
    const res = await request.post("/api/inspections/sync", {
      data: { op: "delete", entityId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("deployed workerd smoke — authenticated round-trip", () => {
  // Uses the `deployed` project's storageState (the ephemeral prod user's
  // @supabase/ssr cookie from deployed-auth.setup.ts), so the `request` fixture
  // carries the edge session. One test drives create → put → delete in order so
  // the row is created, exercised, and cleaned within the same flow; the teardown
  // user-delete is the backstop.
  test("create → put → delete round-trip on the live Worker", async ({ request, baseURL }) => {
    // A same-origin browser fetch attaches an Origin header; Astro's default
    // checkOrigin CSRF guard 403s a state-changing POST without it. Send a matching
    // Origin on every write so the probe mirrors how the real client calls these.
    const origin = baseURL ?? "https://veriffica.veriffica.workers.dev";
    const headers = { Origin: origin };

    // 1. Server-authoritative create → 201 { id }. A 503 here would mean an empty
    //    Worker secret (createClient → null); a 5xx would mean an SSR-dep workerd
    //    init throw. A real id proves the secret + create path are live.
    const create = await request.post("/api/inspections/create", { headers });
    expect(create.status()).toBe(201);
    const { id } = (await create.json()) as { id: string };
    expect(id).toBeTruthy();

    // 2. put a CURRENT-YEAR Part 1 config → 200 with a camelCase authoritative
    //    body. Asserting the year round-trips guards BOTH the snake⇄camel transform
    //    AND the frozen-module-clock regression: if workerd's epoch-frozen clock
    //    leaked into a year bound, a current-year value would be rejected/altered.
    const year = new Date().getFullYear();
    const put = await request.post("/api/inspections/sync", {
      headers,
      data: {
        op: "put",
        entityId: id,
        payload: { id, status: "draft", make: "Toyota", model: "Corolla", year, synced: 0 },
      },
    });
    expect(put.status()).toBe(200);
    const saved = (await put.json()) as Record<string, unknown>;
    // camelCase body fields reflecting the authoritative row (not snake_case).
    expect(saved.year).toBe(year);
    expect(saved.make).toBe("Toyota");
    expect(saved).toHaveProperty("updatedAt");
    // The local-only `synced` flag is stripped at the boundary, never returned.
    expect(saved).not.toHaveProperty("synced");

    // 3. delete the row → 204 (cleans the row AND exercises the delete path).
    const del = await request.post("/api/inspections/sync", {
      headers,
      data: { op: "delete", entityId: id },
    });
    expect(del.status()).toBe(204);
  });
});
