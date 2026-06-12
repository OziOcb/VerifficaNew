// Register an in-memory IndexedDB before importing the store — Dexie opens against
// the global `indexedDB`, which doesn't exist in the Node test runtime otherwise.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, type Inspection } from "@/lib/db";

// Verifies the on-device store contract in isolation (no UI, no server): the
// schema opens, the camelCase + `synced` shape round-trips, the `synced` index is
// queryable, and the changeQueue auto-increments `seq` FIFO.

function makeInspection(overrides: Partial<Inspection> = {}): Inspection {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
    status: "draft",
    name: "Test inspection",
    createdAt: now,
    updatedAt: now,
    synced: 0,
    ...overrides,
  };
}

describe("Dexie store (src/lib/db.ts)", () => {
  beforeEach(async () => {
    await db.open();
  });

  afterEach(async () => {
    await db.inspections.clear();
    await db.changeQueue.clear();
  });

  it("round-trips an inspection preserving the camelCase shape + synced flag", async () => {
    const row = makeInspection();
    await db.inspections.put(row);

    const got = await db.inspections.get(row.id);
    expect(got).toEqual(row);
    // camelCase keys are present (proves the CamelCasedPropertiesDeep derivation).
    expect(got).toHaveProperty("ownerId");
    expect(got).toHaveProperty("updatedAt");
    expect(got).toHaveProperty("createdAt");
    expect(got?.synced).toBe(0);
  });

  it("queries unsynced rows via the synced index", async () => {
    const unsynced = makeInspection({ synced: 0 });
    const synced = makeInspection({ synced: 1 });
    await db.inspections.bulkPut([unsynced, synced]);

    const pending = await db.inspections.where("synced").equals(0).toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(unsynced.id);
  });

  it("auto-increments changeQueue seq in FIFO order", async () => {
    const entityId = crypto.randomUUID();
    const seq1 = await db.changeQueue.add({
      entity: "inspections",
      entityId,
      op: "put",
      payload: makeInspection({ id: entityId }),
      createdAt: Date.now(),
    });
    const seq2 = await db.changeQueue.add({
      entity: "inspections",
      entityId,
      op: "put",
      payload: makeInspection({ id: entityId }),
      createdAt: Date.now() + 1,
    });

    expect(seq2).toBeGreaterThan(seq1);

    const ordered = await db.changeQueue.orderBy("createdAt").toArray();
    expect(ordered.map((op) => op.seq)).toEqual([seq1, seq2]);
  });
});
