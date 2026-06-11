import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/database.types";
import { createConfirmedUser, deleteUser, signInAs } from "./helpers/supabase";

// Proves the data-isolation guardrail at the client boundary: with RLS on and
// each request carrying the user's JWT, account A can never see or mutate
// account B's rows. Covers all four commands (select/insert/update/delete).
//
// Key subtlety: under RLS a cross-account write is NOT an error — PostgREST
// matches 0 rows and returns success. So we assert on the RETURNED rows
// (.select()-chained, empty array), never on error absence, which would
// false-pass.

const PASSWORD = "test-password-123";
// Unique per run so a crashed prior run's leftover users don't collide.
const SUFFIX = Date.now();
const A_EMAIL = `rls-user-a-${SUFFIX}@example.com`;
const B_EMAIL = `rls-user-b-${SUFFIX}@example.com`;

describe("inspections RLS isolation", () => {
  let aId: string;
  let bId: string;
  let aClient: SupabaseClient<Database>;
  let bClient: SupabaseClient<Database>;
  let aRowId: string;
  let bRowId: string;

  beforeAll(async () => {
    aId = await createConfirmedUser(A_EMAIL, PASSWORD);
    bId = await createConfirmedUser(B_EMAIL, PASSWORD);
    aClient = await signInAs(A_EMAIL, PASSWORD);
    bClient = await signInAs(B_EMAIL, PASSWORD);

    const a = await aClient.from("inspections").insert({ owner_id: aId, name: "A's inspection" }).select().single();
    if (a.error) throw a.error;
    aRowId = a.data.id;

    const b = await bClient.from("inspections").insert({ owner_id: bId, name: "B's inspection" }).select().single();
    if (b.error) throw b.error;
    bRowId = b.data.id;
  });

  afterAll(async () => {
    // Cascade FK on inspections.owner_id clears each user's rows.
    await deleteUser(aId);
    await deleteUser(bId);
  });

  it("A's select returns only A's own row", async () => {
    const { data, error } = await aClient.from("inspections").select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(aRowId);
  });

  it("A cannot see B's row by id — RLS hides it (empty, not 403)", async () => {
    const { data, error } = await aClient.from("inspections").select().eq("id", bRowId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("A's update targeting B's row affects 0 rows", async () => {
    const { data, error } = await aClient.from("inspections").update({ name: "hacked" }).eq("id", bRowId).select();
    expect(error).toBeNull(); // a cross-account write is NOT an error...
    expect(data).toEqual([]); // ...it simply matches 0 rows under RLS

    // B's row is untouched, confirmed from B's own client.
    const check = await bClient.from("inspections").select("name").eq("id", bRowId).single();
    expect(check.error).toBeNull();
    expect(check.data?.name).toBe("B's inspection");
  });

  it("A's delete targeting B's row affects 0 rows", async () => {
    const { data, error } = await aClient.from("inspections").delete().eq("id", bRowId).select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // B's row still exists.
    const check = await bClient.from("inspections").select("id").eq("id", bRowId).single();
    expect(check.error).toBeNull();
    expect(check.data?.id).toBe(bRowId);
  });

  it("A can insert a row for itself", async () => {
    const { data, error } = await aClient
      .from("inspections")
      .insert({ owner_id: aId, name: "A's second" })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data?.owner_id).toBe(aId);

    // Clean up so A's row count stays predictable.
    if (data) {
      const cleanup = await aClient.from("inspections").delete().eq("id", data.id);
      expect(cleanup.error).toBeNull();
    }
  });

  it("A cannot insert a row owned by B — with check rejects it", async () => {
    const { data, error } = await aClient.from("inspections").insert({ owner_id: bId, name: "spoofed" }).select();
    expect(error).not.toBeNull(); // with-check policy violation is a real error
    expect(data).toBeNull();
  });
});
