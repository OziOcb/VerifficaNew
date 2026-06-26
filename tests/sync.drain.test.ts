// Register an in-memory IndexedDB before importing the store/sync layer — Dexie
// opens against the global `indexedDB`, which doesn't exist in the Node runtime.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type Inspection } from "@/lib/db";
import { flushQueue, saveInspection } from "@/lib/sync";

// Exercises `drainQueue` (via the public `flushQueue`) at the cheapest layer that
// gives real signal: fake-indexeddb for the outbox, `fetch` mocked at the network
// edge only — never `@/lib/db` or internal `sync` functions. This proves the
// no-data-loss contract risk #1 hinges on: multi-op FIFO order, partial-failure
// stop-and-resume, the reentrancy guard, server-row adoption, and the delete branch.

// The POST body the drain sends to /api/inspections/sync.
interface PostedOp {
  op: "put" | "delete";
  entityId: string;
  payload: Record<string, unknown> & { synced?: 0 | 1 };
}

// Mock `fetch` so it echoes back the posted payload as the server's authoritative
// row (minus the local-only `synced` flag, as the real endpoint strips it), and
// records every POST body in order. `respond` lets a case override the response
// per call (e.g. a mid-drain 500, a network throw, or server-stamped fields).
function mockFetch(respond?: (call: number, op: PostedOp) => Response | Promise<Response> | "throw" | undefined) {
  const calls: PostedOp[] = [];
  const fn = vi.fn((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // The drain always sends a JSON string body; parse it back to inspect the op.
    const op = JSON.parse((init?.body as string | undefined) ?? "{}") as PostedOp;
    calls.push(op);
    const decision = respond?.(calls.length, op);
    if (decision === "throw") return Promise.reject(new Error("network down"));
    if (decision) return Promise.resolve(decision);
    if (op.op === "delete") return Promise.resolve(new Response(null, { status: 204 }));
    // Default put: echo the row back as the server would, sans `synced`.
    const { synced: _synced, ...serverRow } = op.payload;
    return Promise.resolve(Response.json(serverRow));
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

// Build a full, type-valid optimistic row by going through `saveInspection`, then
// reading it back — avoids hand-constructing every column. Clears the queue op
// `saveInspection` enqueued so callers control what gets drained.
async function buildRow(id: string, over: Partial<Inspection> = {}): Promise<Inspection> {
  await saveInspection({ id, ...over });
  const row = await db.inspections.get(id);
  if (!row) throw new Error("row not found after save");
  return row;
}

describe("drainQueue FIFO + reconciliation (src/lib/sync.ts)", () => {
  beforeEach(async () => {
    await db.open();
  });

  afterEach(async () => {
    await db.inspections.clear();
    await db.changeQueue.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("drains multiple ops in FIFO order, empties the queue, and marks all synced", async () => {
    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();
    const idC = crypto.randomUUID();

    // Three distinct inspections, each with a distinguishing field. One save each
    // → three queued ops in call order.
    await saveInspection({ id: idA, make: "Alfa" });
    await saveInspection({ id: idB, model: "Bravo" });
    await saveInspection({ id: idC, globalNotes: "Charlie" });

    const { calls, fn } = mockFetch();
    await flushQueue();

    // Assert the SEQUENCE of POST bodies, not just the count: every op was POSTed,
    // in enqueue order, each carrying its own snapshot.
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.entityId)).toEqual([idA, idB, idC]);
    expect(calls.map((c) => c.op)).toEqual(["put", "put", "put"]);

    // ...and to the right endpoint with the right verb — a wrong URL/method would
    // silently break sync without changing payload order (Stryker survivors).
    expect(fn.mock.calls[0][0]).toBe("/api/inspections/sync");
    expect(fn.mock.calls[0][1]?.method).toBe("POST");
    expect(calls[0].payload.make).toBe("Alfa");
    expect(calls[1].payload.model).toBe("Bravo");
    expect(calls[2].payload.globalNotes).toBe("Charlie");

    // Queue drained, every row reconciled.
    expect(await db.changeQueue.count()).toBe(0);
    expect((await db.inspections.get(idA))?.synced).toBe(1);
    expect((await db.inspections.get(idB))?.synced).toBe(1);
    expect((await db.inspections.get(idC))?.synced).toBe(1);
  });

  it("drains in seq order even when createdAt disagrees (the orderBy('seq') guard)", async () => {
    // Build three valid rows, then re-enqueue them by hand with createdAt values
    // that do NOT match enqueue (seq) order: two tie on 1000, and the third is
    // *lower* at 999 — modelling a coarse/non-monotonic `Date.now()`. Ordering by
    // createdAt would drain [C(999), A(1000), B(1000)]; ordering by the monotonic
    // seq drains [A, B, C]. This case goes red if the source reverts to
    // orderBy("createdAt").
    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();
    const idC = crypto.randomUUID();
    const rowA = await buildRow(idA, { make: "A" });
    const rowB = await buildRow(idB, { make: "B" });
    const rowC = await buildRow(idC, { make: "C" });
    await db.changeQueue.clear();

    // Insertion order = ascending seq = the true FIFO order.
    await db.changeQueue.add({ entity: "inspections", entityId: idA, op: "put", payload: rowA, createdAt: 1000 });
    await db.changeQueue.add({ entity: "inspections", entityId: idB, op: "put", payload: rowB, createdAt: 1000 });
    await db.changeQueue.add({ entity: "inspections", entityId: idC, op: "put", payload: rowC, createdAt: 999 });

    const { calls } = mockFetch();
    await flushQueue();

    expect(calls.map((c) => c.entityId)).toEqual([idA, idB, idC]);
    expect(await db.changeQueue.count()).toBe(0);
  });

  it("stops on a mid-drain 500 and resumes the remainder in order on the next flush", async () => {
    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();
    const idC = crypto.randomUUID();
    await saveInspection({ id: idA, make: "A" });
    await saveInspection({ id: idB, make: "B" });
    await saveInspection({ id: idC, make: "C" });

    // Call 1 succeeds; call 2 returns 500 → drain breaks before reaching op 3.
    const first = mockFetch((call) => (call === 2 ? new Response("boom", { status: 500 }) : undefined));
    await flushQueue();

    // op 1 reconciled and dequeued; ops 2 & 3 remain queued IN ORDER; op 3 never POSTed.
    expect(first.calls).toHaveLength(2);
    expect(first.calls.map((c) => c.entityId)).toEqual([idA, idB]);
    expect((await db.inspections.get(idA))?.synced).toBe(1);
    const remaining = await db.changeQueue.orderBy("seq").toArray();
    expect(remaining.map((o) => o.entityId)).toEqual([idB, idC]);
    expect((await db.inspections.get(idB))?.synced).toBe(0);
    expect((await db.inspections.get(idC))?.synced).toBe(0);

    // Flip to all-success and flush again: 2 & 3 drain in order, queue empties.
    vi.unstubAllGlobals();
    const second = mockFetch();
    await flushQueue();
    expect(second.calls.map((c) => c.entityId)).toEqual([idB, idC]);
    expect(await db.changeQueue.count()).toBe(0);
    expect((await db.inspections.get(idC))?.synced).toBe(1);
  });

  it("stops on a network throw mid-drain and resumes in order on reconnect", async () => {
    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();
    const idC = crypto.randomUUID();
    await saveInspection({ id: idA, make: "A" });
    await saveInspection({ id: idB, make: "B" });
    await saveInspection({ id: idC, make: "C" });

    // Call 1 succeeds; call 2 throws (offline) → drain breaks, leaving FIFO intact.
    const first = mockFetch((call) => (call === 2 ? "throw" : undefined));
    await flushQueue();

    expect(first.calls).toHaveLength(2);
    expect((await db.inspections.get(idA))?.synced).toBe(1);
    const remaining = await db.changeQueue.orderBy("seq").toArray();
    expect(remaining.map((o) => o.entityId)).toEqual([idB, idC]);

    vi.unstubAllGlobals();
    const second = mockFetch();
    await flushQueue();
    expect(second.calls.map((c) => c.entityId)).toEqual([idB, idC]);
    expect(await db.changeQueue.count()).toBe(0);
  });

  it("posts each op exactly once under two concurrent flushes (reentrancy guard)", async () => {
    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();
    await saveInspection({ id: idA, make: "A" });
    await saveInspection({ id: idB, make: "B" });

    // Slow the network so a second flush overlaps the first while it drains.
    const { calls } = mockFetch(async (_call, op) => {
      await new Promise((r) => setTimeout(r, 10));
      const { synced: _synced, ...serverRow } = op.payload;
      return Response.json(serverRow);
    });

    // Two overlapping drains: the module-level `flushing` guard must make the
    // second a no-op so no op is double-POSTed.
    await Promise.all([flushQueue(), flushQueue()]);

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.entityId)).toEqual([idA, idB]);
    expect(await db.changeQueue.count()).toBe(0);
  });

  it("adopts the server's authoritative row (ownerId/updatedAt) and flips synced", async () => {
    const id = crypto.randomUUID();
    await saveInspection({ id, make: "Toyota", ownerId: "optimistic-owner" });

    const serverOwner = "server-stamped-owner";
    const serverUpdatedAt = "2099-01-01T00:00:00.000Z";
    mockFetch((_call, op) => {
      const { synced: _synced, ...serverRow } = op.payload;
      return Response.json({ ...serverRow, ownerId: serverOwner, updatedAt: serverUpdatedAt });
    });
    await flushQueue();

    const row = await db.inspections.get(id);
    expect(row?.ownerId).toBe(serverOwner);
    expect(row?.updatedAt).toBe(serverUpdatedAt);
    expect(row?.make).toBe("Toyota");
    expect(row?.synced).toBe(1);
    expect(await db.changeQueue.count()).toBe(0);
  });

  it("drops both the local row and the queue entry on a delete op (204)", async () => {
    const id = crypto.randomUUID();
    const row = await buildRow(id, { make: "ToDelete" });
    await db.changeQueue.clear();
    await db.changeQueue.add({
      entity: "inspections",
      entityId: id,
      op: "delete",
      payload: row,
      createdAt: Date.now(),
    });

    mockFetch(); // delete → 204 by default
    await flushQueue();

    expect(await db.inspections.get(id)).toBeUndefined();
    expect(await db.changeQueue.count()).toBe(0);
  });
});
