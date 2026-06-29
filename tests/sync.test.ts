// Register an in-memory IndexedDB before importing the store/sync layer — Dexie
// opens against the global `indexedDB`, which doesn't exist in the Node runtime.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveInspection } from "@/lib/sync";

// Exercises the `saveInspection` read-merge (no server, no network): a sparse
// save must overlay only the supplied keys and preserve everything else already
// on the row — the no-data-loss guardrail the session screen depends on.

describe("saveInspection read-merge (src/lib/sync.ts)", () => {
  beforeEach(async () => {
    await db.open();
  });

  afterEach(async () => {
    await db.inspections.clear();
    await db.changeQueue.clear();
  });

  it("a notes-only save preserves a pre-existing Part 1 config", async () => {
    const id = crypto.randomUUID();

    // First write: a full-ish Part 1 config (mirrors Part1Form's save).
    await saveInspection({
      id,
      name: "Session A",
      make: "Toyota",
      model: "Corolla",
      fuelType: "petrol",
      transmission: "manual",
      drive: "2wd",
      bodyType: "sedan",
    });

    // Sparse follow-up: the session screen sends only global notes.
    await saveInspection({ id, globalNotes: "inspection-level notes" });

    const row = await db.inspections.get(id);
    expect(row).toBeDefined();
    // The new field landed...
    expect(row?.globalNotes).toBe("inspection-level notes");
    // ...and the config the sparse save never re-sent is untouched.
    expect(row?.make).toBe("Toyota");
    expect(row?.model).toBe("Corolla");
    expect(row?.fuelType).toBe("petrol");
    expect(row?.transmission).toBe("manual");
    expect(row?.drive).toBe("2wd");
    expect(row?.bodyType).toBe("sedan");
    expect(row?.name).toBe("Session A");
    // The outbox payload is the full merged row, so the upsert still carries config.
    const ops = await db.changeQueue.orderBy("createdAt").toArray();
    const last = ops.at(-1);
    expect(last?.payload.make).toBe("Toyota");
    expect(last?.payload.globalNotes).toBe("inspection-level notes");
  });

  it("a flag toggle persists without clobbering config or notes", async () => {
    const id = crypto.randomUUID();
    await saveInspection({ id, make: "Audi", fuelType: "petrol", globalNotes: "keep me" });
    await saveInspection({ id, turboEquipped: true });

    const row = await db.inspections.get(id);
    expect(row?.turboEquipped).toBe(true);
    expect(row?.make).toBe("Audi");
    expect(row?.globalNotes).toBe("keep me");
  });

  it("a first write defaults omitted data columns to null, but the jsonb answers map to {}", async () => {
    const id = crypto.randomUUID();
    await saveInspection({ id, make: "Honda" });

    const row = await db.inspections.get(id);
    expect(row?.make).toBe("Honda");
    expect(row?.model).toBeNull();
    expect(row?.globalNotes).toBeNull();
    expect(row?.turboEquipped).toBeNull();
    // `answers` is `not null default '{}'` in Postgres and the outbox sends every
    // data field as a key, so the read-merge must default it to `{}` (never `null`)
    // or a first-write upsert would hit the not-null constraint.
    expect(row?.answers).toEqual({});
    const ops = await db.changeQueue.orderBy("createdAt").toArray();
    expect(ops.at(-1)?.payload.answers).toEqual({});
    expect(row?.synced).toBe(0);
  });

  it("an answers-only save preserves config and persists the map", async () => {
    const id = crypto.randomUUID();
    await saveInspection({ id, make: "Audi", globalNotes: "keep me" });
    const answers = { q_p2_base_car_body_corrosion_bonnet: "yes" as const };
    await saveInspection({ id, answers });

    const row = await db.inspections.get(id);
    expect(row?.answers).toEqual(answers);
    expect(row?.make).toBe("Audi");
    expect(row?.globalNotes).toBe("keep me");
  });
});
