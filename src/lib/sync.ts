// CLIENT-ONLY — imports the Dexie store (`@/lib/db`), so the SSR import discipline
// applies transitively: never import this module from `.astro` frontmatter or any
// server module. Mount the consuming island with `client:only="react"`.
//
// This is the no-data-loss mechanism: `saveInspection` writes optimistically and
// enqueues an outbox op atomically (both or neither); `flushQueue` drains the outbox
// FIFO on reconnect and adopts the server's authoritative camelCase row.
import { db, type Inspection } from "@/lib/db";

// Marker for the user the on-device store was last used by. Lives in localStorage
// (one synchronous string) rather than a Dexie table, to keep the data schema
// purely about data — see `resetLocalStoreOnUserChange`.
const LAST_OWNER_KEY = "veriffica:lastOwnerId";

/**
 * Wipe the local store + outbox when the signed-in user changes. The Dexie store
 * is keyed per browser ORIGIN, not per user — so a different account logging in on
 * the same browser would otherwise see the previous user's cached rows. Call this
 * on load with the authenticated user id (from `Astro.locals.user`): if it differs
 * from the last owner the store served, clear everything before any read.
 *
 * RLS already protects the server (the other user could never sync/read these
 * rows); this guards only the local optimistic cache. Dropping unsynced rows on a
 * user switch is correct — they belong to the previous session and can never sync
 * under the new one.
 */
export async function resetLocalStoreOnUserChange(userId: string): Promise<void> {
  if (localStorage.getItem(LAST_OWNER_KEY) === userId) return;
  await db.transaction("rw", db.inspections, db.changeQueue, async () => {
    await db.inspections.clear();
    await db.changeQueue.clear();
  });
  localStorage.setItem(LAST_OWNER_KEY, userId);
}

// The minimal shape the caller supplies; the rest of the optimistic row is filled
// locally. `ownerId`/`createdAt` are placeholders — the server stamps the
// authoritative values and we adopt them on the way back (research Decision #1).
type SaveInput = Pick<Inspection, "id"> & Partial<Pick<Inspection, "status" | "name" | "ownerId" | "createdAt">>;

/**
 * Optimistic local write + outbox enqueue, atomically. The `inspections.put` and
 * the `changeQueue.add` run in one `rw` transaction: if either throws, both roll
 * back — you never get a saved record with no outbox entry, or vice versa
 * (dexie-reference.md §2). The row lands `synced: 0` until the server confirms.
 */
export async function saveInspection(input: SaveInput): Promise<void> {
  const now = new Date().toISOString();
  const row: Inspection = {
    id: input.id,
    ownerId: input.ownerId ?? "", // server stamps the authoritative owner_id
    status: input.status ?? "draft",
    name: input.name ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: now, // optimistic ordering hint; overwritten by the server's value
    synced: 0,
  };

  await db.transaction("rw", db.inspections, db.changeQueue, async () => {
    await db.inspections.put(row);
    await db.changeQueue.add({
      entity: "inspections",
      entityId: row.id,
      op: "put",
      payload: row,
      createdAt: Date.now(), // numeric FIFO ordering hint (distinct from the row's ISO createdAt)
    });
  });
}

/**
 * Drain the outbox FIFO to the sync endpoint. Same-origin `fetch`, so the auth
 * cookie rides along automatically. On any network/server failure we `break` and
 * leave the rest queued — the next `online` event retries from where we stopped,
 * preserving order. Each successful op is reconciled in its own `rw` transaction:
 * `delete` drops the local row + queue entry; `put` adopts the server's
 * authoritative camelCase row and flips `synced: 1`.
 */
export async function flushQueue(): Promise<void> {
  const ops = await db.changeQueue.orderBy("createdAt").toArray();

  for (const op of ops) {
    let res: Response;
    try {
      res = await fetch("/api/inspections/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: op.op, entityId: op.entityId, payload: op.payload }),
      });
    } catch {
      break; // offline / network blip — stop draining, retry on the next online event
    }

    if (!res.ok) break; // transient server error — preserve FIFO order, retry later

    if (op.op === "delete") {
      // 204, no body. Drop the local row and the queue entry together.
      await db.transaction("rw", db.inspections, db.changeQueue, async () => {
        await db.inspections.delete(op.entityId);
        if (op.seq !== undefined) await db.changeQueue.delete(op.seq);
      });
      continue;
    }

    // put: adopt the authoritative row (server-stamped owner_id + updated_at).
    const saved = (await res.json()) as Omit<Inspection, "synced">;
    await db.transaction("rw", db.inspections, db.changeQueue, async () => {
      await db.inspections.update(op.entityId, { ...saved, synced: 1 });
      if (op.seq !== undefined) await db.changeQueue.delete(op.seq);
    });
  }
}
