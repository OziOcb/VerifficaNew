import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/database.types";
import { MAX_GLOBAL_NOTES_LENGTH, MAX_PART1_NOTES_LENGTH, M } from "@/lib/part1-config";
import { createConfirmedUser, deleteUser, signInAs } from "./helpers/supabase";

// Exercises POST /api/inspections/sync against a real local Supabase under RLS.
//
// The endpoint imports `astro:env/server` (via @/lib/supabase), which doesn't
// exist in the plain-Node vitest runtime. We mock @/lib/supabase so the handler
// runs against a real signed-in anon client (carrying the user's JWT, so
// auth.uid() resolves and RLS applies) — exactly like the SSR cookie client,
// minus the cookie plumbing. The mock factory reads `mockClient` lazily, so a
// per-test assignment selects which client (or null, for the 503 path) the
// endpoint sees. The `mock` prefix is required for vitest hoisting.
let mockClient: SupabaseClient<Database> | null = null;
vi.mock("@/lib/supabase", () => ({
  createClient: () => mockClient,
}));

// Imported after the mock is registered (vi.mock is hoisted above imports).
const { POST } = await import("@/pages/api/inspections/sync");

const PASSWORD = "test-password-123";
const SUFFIX = Date.now();
const A_EMAIL = `sync-user-a-${SUFFIX}@example.com`;
const B_EMAIL = `sync-user-b-${SUFFIX}@example.com`;

// Minimal fake APIContext — the handler only touches request, cookies, locals.
// createClient is mocked, so headers/cookies are inert.
function makeContext(opts: { user: { id: string } | null; body: unknown }): APIContext {
  return {
    request: new Request("http://localhost/api/inspections/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts.body),
    }),
    cookies: {} as APIContext["cookies"],
    locals: { user: opts.user as App.Locals["user"] },
  } as APIContext;
}

describe("POST /api/inspections/sync", () => {
  let aId: string;
  let bId: string;
  let aClient: SupabaseClient<Database>;
  let bClient: SupabaseClient<Database>;

  beforeAll(async () => {
    aId = await createConfirmedUser(A_EMAIL, PASSWORD);
    bId = await createConfirmedUser(B_EMAIL, PASSWORD);
    aClient = await signInAs(A_EMAIL, PASSWORD);
    bClient = await signInAs(B_EMAIL, PASSWORD);
  });

  afterAll(async () => {
    // Cascade FK on inspections.owner_id clears each user's rows.
    await deleteUser(aId);
    await deleteUser(bId);
  });

  it("returns 401 when no session is present", async () => {
    mockClient = aClient;
    const res = await POST(makeContext({ user: null, body: { op: "put", entityId: "x", payload: {} } }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when Supabase is not configured", async () => {
    mockClient = null;
    const res = await POST(makeContext({ user: { id: aId }, body: { op: "put", entityId: "x", payload: {} } }));
    expect(res.status).toBe(503);
  });

  it("upserts a put under the session owner, ignoring a spoofed ownerId, and strips synced", async () => {
    mockClient = aClient;
    const id = crypto.randomUUID();
    const res = await POST(
      makeContext({
        user: { id: aId },
        body: {
          op: "put",
          entityId: id,
          // Spoofed ownerId (B) + a local-only synced flag the server must drop.
          payload: { id, ownerId: bId, status: "draft", name: "from client", synced: 0 },
        },
      }),
    );

    expect(res.status).toBe(200);
    const saved = (await res.json()) as Record<string, unknown>;

    // owner stamped from the session, not the spoofed client value.
    expect(saved.ownerId).toBe(aId);
    // camelCase authoritative row with a server-stamped updatedAt.
    expect(saved).toHaveProperty("updatedAt");
    expect(typeof saved.updatedAt).toBe("string");
    expect(saved.name).toBe("from client");
    // synced is local-only — never written, never returned.
    expect(saved).not.toHaveProperty("synced");

    // Confirm persistence under A's owner_id directly via A's client.
    const check = await aClient.from("inspections").select().eq("id", id).single();
    expect(check.error).toBeNull();
    expect(check.data?.owner_id).toBe(aId);
  });

  it("round-trips the S-04 session columns (globalNotes + a flag) through the snake⇄camel boundary", async () => {
    mockClient = aClient;
    const id = crypto.randomUUID();
    const res = await POST(
      makeContext({
        user: { id: aId },
        body: {
          op: "put",
          entityId: id,
          payload: { id, status: "draft", globalNotes: "inspection-level doc", turboEquipped: true, synced: 0 },
        },
      }),
    );

    expect(res.status).toBe(200);
    const saved = (await res.json()) as Record<string, unknown>;
    // The endpoint's top-level transform camelCases the new scalar columns back.
    expect(saved.globalNotes).toBe("inspection-level doc");
    expect(saved.turboEquipped).toBe(true);

    // And they persisted snake_case under A's owner_id (RLS-scoped read).
    const check = await aClient.from("inspections").select().eq("id", id).single();
    expect(check.error).toBeNull();
    expect(check.data?.global_notes).toBe("inspection-level doc");
    expect(check.data?.turbo_equipped).toBe(true);
  });

  it("delete is owner-scoped — removes the owner's row, returns 204", async () => {
    mockClient = aClient;
    const id = crypto.randomUUID();
    // Seed a row for A via the endpoint.
    await POST(
      makeContext({
        user: { id: aId },
        body: { op: "put", entityId: id, payload: { id, status: "draft", name: "to delete", synced: 0 } },
      }),
    );

    const res = await POST(makeContext({ user: { id: aId }, body: { op: "delete", entityId: id } }));
    expect(res.status).toBe(204);

    const check = await aClient.from("inspections").select().eq("id", id);
    expect(check.error).toBeNull();
    expect(check.data).toEqual([]);
  });

  it("a delete cannot reach another owner's row (RLS scopes it)", async () => {
    // Seed a row owned by B directly.
    const seed = await bClient.from("inspections").insert({ owner_id: bId, name: "B's row" }).select().single();
    if (seed.error) throw seed.error;
    const bRowId = seed.data.id;

    // A attempts to delete B's row through the endpoint — RLS matches 0 rows.
    mockClient = aClient;
    const res = await POST(makeContext({ user: { id: aId }, body: { op: "delete", entityId: bRowId } }));
    expect(res.status).toBe(204); // delete of 0 rows is not an error

    // B's row is untouched.
    const check = await bClient.from("inspections").select("id").eq("id", bRowId).single();
    expect(check.error).toBeNull();
    expect(check.data?.id).toBe(bRowId);
  });

  // --- Server-trust guard (Risk #6) -----------------------------------------
  // The browser validators block these bands; a curl/devtools bypass must not slip
  // them past the server. Each rejection is proven specifically (the DB enforces
  // none of these — no length/cross-field CHECK) AND proven to persist nothing.

  it("rejects an oversized globalNotes with 400 + the shared message and persists nothing", async () => {
    mockClient = aClient;
    const id = crypto.randomUUID();
    const res = await POST(
      makeContext({
        user: { id: aId },
        body: {
          op: "put",
          entityId: id,
          payload: { id, status: "draft", globalNotes: "x".repeat(MAX_GLOBAL_NOTES_LENGTH + 1), synced: 0 },
        },
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toBe(M.globalNotes);

    // Nothing was written — the upsert never ran.
    const check = await aClient.from("inspections").select("id").eq("id", id);
    expect(check.error).toBeNull();
    expect(check.data).toEqual([]);
  });

  it("rejects an oversized Part-1 notes with 400 + the shared message and persists nothing", async () => {
    mockClient = aClient;
    const id = crypto.randomUUID();
    const res = await POST(
      makeContext({
        user: { id: aId },
        body: {
          op: "put",
          entityId: id,
          payload: { id, status: "draft", notes: "y".repeat(MAX_PART1_NOTES_LENGTH + 1), synced: 0 },
        },
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toBe(M.notes);

    const check = await aClient.from("inspections").select("id").eq("id", id);
    expect(check.error).toBeNull();
    expect(check.data).toEqual([]);
  });

  it("rejects an Electric + Manual config (CF-1) with 400 + the shared message and persists nothing", async () => {
    mockClient = aClient;
    const id = crypto.randomUUID();
    const res = await POST(
      makeContext({
        user: { id: aId },
        body: {
          op: "put",
          entityId: id,
          payload: { id, status: "draft", fuelType: "electric", transmission: "manual", synced: 0 },
        },
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toBe(M.crossFieldElectricTransmission);

    const check = await aClient.from("inspections").select("id").eq("id", id);
    expect(check.error).toBeNull();
    expect(check.data).toEqual([]);
  });

  it("accepts a valid partial draft (electric + automatic, in-limit notes) and persists it", async () => {
    mockClient = aClient;
    // Free a slot under the 2-per-owner cap (earlier tests left A at the limit); this
    // case is about the guard accepting a valid write, not the unrelated row-count cap.
    await aClient.from("inspections").delete().eq("owner_id", aId);
    const id = crypto.randomUUID();
    const res = await POST(
      makeContext({
        user: { id: aId },
        body: {
          op: "put",
          entityId: id,
          payload: {
            id,
            status: "draft",
            globalNotes: "ok",
            fuelType: "electric",
            transmission: "automatic",
            synced: 0,
          },
        },
      }),
    );

    expect(res.status).toBe(200);
    const saved = (await res.json()) as Record<string, unknown>;
    expect(saved.globalNotes).toBe("ok");

    const check = await aClient.from("inspections").select().eq("id", id).single();
    expect(check.error).toBeNull();
    expect(check.data?.fuel_type).toBe("electric");
    expect(check.data?.transmission).toBe("automatic");
  });

  it("accepts electric with transmission absent (CF-1 fires only when both present)", async () => {
    mockClient = aClient;
    // Free a slot under the 2-per-owner cap (see above) — orthogonal to the guard.
    await aClient.from("inspections").delete().eq("owner_id", aId);
    const id = crypto.randomUUID();
    const res = await POST(
      makeContext({
        user: { id: aId },
        body: { op: "put", entityId: id, payload: { id, status: "draft", fuelType: "electric", synced: 0 } },
      }),
    );

    expect(res.status).toBe(200);

    const check = await aClient.from("inspections").select("fuel_type").eq("id", id).single();
    expect(check.error).toBeNull();
    expect(check.data?.fuel_type).toBe("electric");
  });

  it("accepts electric with transmission null (the real outbox sends every column; null is not yet-set)", async () => {
    mockClient = aClient;
    // The real outbox payload carries every DATA_FIELD as a key — `transmission` is
    // null (not absent) until the user picks one. CF-1 must treat that as a valid
    // partial draft, exactly like the omitted-key case above.
    await aClient.from("inspections").delete().eq("owner_id", aId);
    const id = crypto.randomUUID();
    const res = await POST(
      makeContext({
        user: { id: aId },
        body: {
          op: "put",
          entityId: id,
          payload: { id, status: "draft", fuelType: "electric", transmission: null, synced: 0 },
        },
      }),
    );

    expect(res.status).toBe(200);

    const check = await aClient.from("inspections").select("fuel_type, transmission").eq("id", id).single();
    expect(check.error).toBeNull();
    expect(check.data?.fuel_type).toBe("electric");
    expect(check.data?.transmission).toBeNull();
  });
});
