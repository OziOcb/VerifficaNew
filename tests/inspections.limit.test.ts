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
});
