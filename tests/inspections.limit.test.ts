import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/database.types";
import { INSPECTION_LIMIT_ERROR } from "@/lib/inspections";
import { createConfirmedUser, deleteUser, signInAs } from "./helpers/supabase";

// Proves the 2-inspection-per-owner cap (S-02 / FR-007) is enforced by the
// BEFORE INSERT trigger, not app code. Unlike a cross-account RLS write (which
// silently matches 0 rows), the trigger RAISEs — so the over-limit insert
// surfaces as a non-null PostgREST error. We also prove a delete frees a slot.

const PASSWORD = "test-password-123";
// Unique per run so a crashed prior run's leftover user doesn't collide.
const EMAIL = `limit-user-${Date.now()}@example.com`;

describe("inspections 2-per-owner limit", () => {
  let userId: string;
  let client: SupabaseClient<Database>;

  beforeAll(async () => {
    userId = await createConfirmedUser(EMAIL, PASSWORD);
    client = await signInAs(EMAIL, PASSWORD);
  });

  afterAll(async () => {
    // Cascade FK on inspections.owner_id clears the user's rows.
    await deleteUser(userId);
  });

  it("rejects a 3rd inspection and frees a slot on delete", async () => {
    // Inspections 1 and 2 succeed.
    const first = await client.from("inspections").insert({ owner_id: userId, name: "first" }).select("id").single();
    expect(first.error).toBeNull();
    const firstId = first.data?.id;
    expect(firstId).toBeDefined();

    const second = await client.from("inspections").insert({ owner_id: userId, name: "second" }).select("id").single();
    expect(second.error).toBeNull();

    // The 3rd insert trips the trigger and surfaces as a non-null error. The
    // message MUST contain the shared sentinel — this pins the trigger's RAISE
    // text to the string `create.ts` maps to 409, so rewording the migration
    // message (which would silently downgrade the limit case to a generic 400)
    // fails CI here.
    const third = await client.from("inspections").insert({ owner_id: userId, name: "third" }).select();
    expect(third.error).not.toBeNull();
    expect(third.error?.message).toContain(INSPECTION_LIMIT_ERROR);

    // Deleting one row frees a slot, so a fresh insert succeeds again.
    const del = await client
      .from("inspections")
      .delete()
      .eq("id", firstId ?? "");
    expect(del.error).toBeNull();

    const fourth = await client.from("inspections").insert({ owner_id: userId, name: "fourth" }).select("id").single();
    expect(fourth.error).toBeNull();
  });

  it("lets an owner at the limit keep editing existing inspections (upsert UPDATE path)", async () => {
    // Regression for the BEFORE INSERT trigger firing on `INSERT ... ON CONFLICT
    // DO UPDATE`: the sync endpoint persists every edit via `.upsert()`, so a
    // BEFORE INSERT trigger that counted the row being upserted blocked ALL saves
    // once the owner was at the 2-row cap (not just genuine 3rd inserts). The fix
    // (`id <> new.id`) excludes the row itself, so an update is never rejected.
    // Reset first — test 1 leaves this owner holding its 2 allowed rows.
    await client.from("inspections").delete().eq("owner_id", userId);

    const a = await client.from("inspections").insert({ owner_id: userId, name: "a" }).select("id").single();
    expect(a.error).toBeNull();
    const b = await client.from("inspections").insert({ owner_id: userId, name: "b" }).select("id").single();
    expect(b.error).toBeNull();
    const bId = b.data?.id;
    expect(bId).toBeDefined();

    // Owner now holds the 2 allowed rows. Re-save B via upsert (same shape the
    // sync endpoint sends) — this is an UPDATE, and must NOT trip the limit.
    const edit = await client
      .from("inspections")
      .upsert({ id: bId, owner_id: userId, name: "b — edited" })
      .select("name")
      .single();
    expect(edit.error).toBeNull();
    expect(edit.data?.name).toBe("b — edited");
  });
});
