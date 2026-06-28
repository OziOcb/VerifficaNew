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
// (Phase 2 adds the authenticated create→put→delete round-trip.)

test.describe("deployed workerd smoke — unauthenticated probes", () => {
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
