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

// The 15 Part 1 config columns (camelCase projection of the snake_case DB
// columns). Non-indexed scalars, so no Dexie `db.version` bump is needed — the
// `Inspection` type already carries them from the regenerated DB types, and the
// sync endpoint's top-level snake⇄camel transform round-trips them for free.
const CONFIG_FIELDS = [
  "price",
  "make",
  "model",
  "year",
  "registrationNumber",
  "vin",
  "mileage",
  "fuelType",
  "transmission",
  "drive",
  "color",
  "bodyType",
  "doorCount",
  "address",
  "notes",
] as const;

// The S-04 session-screen scalar columns (FR-010 global notes + the 5 FR-014
// equipment flags). Same treatment as CONFIG_FIELDS: non-indexed camelCase
// scalars the sync endpoint round-trips for free. `importedFromEu` is the
// camelCased column name (the engine's FLAG_COLUMN_MAP binds it to the
// catalogue's `importedFromEU`); this layer only knows the column spelling.
const SESSION_FIELDS = [
  "globalNotes",
  "chargingPortEquipped",
  "evBatteryDocsAvailable",
  "turboEquipped",
  "mechanicalCompressorEquipped",
  "importedFromEu",
] as const;

// The S-05 answers map (FR-015): a jsonb column, not a scalar, carrying the
// Parts 2–5 answers keyed by opaque catalogue question IDs. It joins the
// read-merge like any other data field — a sparse `saveInspection({ id, answers })`
// persists the map while preserving every other column. Non-indexed, so no Dexie
// `db.version` bump. Its KEYS must survive the sync round-trip verbatim, which is
// why the sync endpoint excludes this field from deep key-casing (`stopPaths`).
const JSONB_FIELDS = ["answers"] as const;

// Every data column the optimistic row carries (config + session scalars + jsonb).
// The read-merge in `saveInspection` overlays only the caller-supplied subset of
// these onto the stored row.
const DATA_FIELDS = [...CONFIG_FIELDS, ...SESSION_FIELDS, ...JSONB_FIELDS] as const;

type DataField = (typeof DATA_FIELDS)[number];

// The minimal shape the caller supplies; the rest of the optimistic row is filled
// locally. `ownerId`/`createdAt` are placeholders — the server stamps the
// authoritative values and we adopt them on the way back (research Decision #1).
// The config + session data fields are optional: a save may carry some, all, or
// none — omitted fields are preserved by the read-merge, not nulled.
type SaveInput = Pick<Inspection, "id"> &
  Partial<Pick<Inspection, "status" | "name" | "ownerId" | "createdAt" | DataField>>;

/**
 * Optimistic local write + outbox enqueue, atomically. The `inspections.put` and
 * the `changeQueue.add` run in one `rw` transaction: if either throws, both roll
 * back — you never get a saved record with no outbox entry, or vice versa
 * (dexie-reference.md §2). The row lands `synced: 0` until the server confirms.
 *
 * **Read-merge** (no-data-loss guardrail): a save overlays only the data fields
 * the caller actually supplied onto the stored row, so a sparse update — e.g. the
 * session screen's `saveInspection({ id, globalNotes })` — keeps the Part 1 config
 * it never re-sent instead of nulling it. The read of the current row happens
 * inside the same `rw` transaction as the write, so the merge is atomic. A first
 * write (no existing row) defaults every omitted column to `null` as before. The
 * merged row is the outbox payload, so the upsert still carries a complete row.
 */
export async function saveInspection(input: SaveInput): Promise<void> {
  const now = new Date().toISOString();

  await db.transaction("rw", db.inspections, db.changeQueue, async () => {
    const existing = await db.inspections.get(input.id);

    // Overlay only the caller-supplied data keys; omitted keys keep the stored
    // value (or the field default on a first write). Presence — not nullishness —
    // decides, so an explicit `null`/`false`/`""` from the caller still writes
    // through. The default is `null` for scalar columns but `{}` for the jsonb
    // `answers` map: that column is `not null default '{}'` in Postgres, and the
    // outbox always sends every DATA_FIELD as a key, so a `null` default here would
    // make a first-write save (e.g. `{ id, globalNotes }`) violate the constraint.
    const jsonbFields = JSONB_FIELDS as readonly string[];
    const data = Object.fromEntries(
      DATA_FIELDS.map((f) => {
        const fallback = jsonbFields.includes(f) ? {} : null;
        const merged = f in input ? input[f] : existing?.[f];
        return [f, merged ?? fallback];
      }),
    ) as Pick<Inspection, DataField>;

    const row: Inspection = {
      id: input.id,
      ownerId: input.ownerId ?? existing?.ownerId ?? "", // server stamps the authoritative owner_id
      status: input.status ?? existing?.status ?? "draft",
      name: input.name ?? existing?.name ?? null,
      createdAt: input.createdAt ?? existing?.createdAt ?? now,
      updatedAt: now, // optimistic ordering hint; overwritten by the server's value
      ...data,
      synced: 0,
    };

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

// Reentrancy guard: several triggers can call `flushQueue` at once (the `online`
// event, a visibility change, the retry timer). Without this, concurrent drains
// could POST the same op twice before the first reconciles its queue delete.
let flushing = false;

/**
 * Drain the outbox FIFO to the sync endpoint. Same-origin `fetch`, so the auth
 * cookie rides along automatically. On any network/server failure we `break` and
 * leave the rest queued — a later trigger retries from where we stopped,
 * preserving order. Each successful op is reconciled in its own `rw` transaction:
 * `delete` drops the local row + queue entry; `put` adopts the server's
 * authoritative camelCase row and flips `synced: 1`.
 */
export async function flushQueue(): Promise<void> {
  if (flushing) return; // a drain is already in progress
  flushing = true;
  try {
    await drainQueue();
  } finally {
    flushing = false;
  }
}

async function drainQueue(): Promise<void> {
  // Order by the monotonic `++seq` primary key, not `createdAt`: `createdAt` is a
  // `Date.now()` millisecond stamp that two rapid saves can tie on, and Dexie does
  // not guarantee a FIFO tie-break on a non-unique index. `seq` is strictly
  // increasing by construction, so FIFO holds even when timestamps collide.
  const ops = await db.changeQueue.orderBy("seq").toArray();

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

// How often the retry net re-checks for queued ops while online. Connectivity
// events are best-effort, so this bounded poll is the backstop that guarantees a
// drain even when an `online` event is dropped.
const RETRY_INTERVAL_MS = 4000;

/**
 * Wire up resilient outbox draining and return a cleanup function. Durability must
 * not hinge on a single event: `navigator.onLine` and the `online`/`offline`
 * events are best-effort, and a service-worker-controlled page loaded while
 * offline may never receive the `online` event at all. So we drain on several
 * redundant signals — any one suffices, together they guarantee the queue empties
 * once the device is back online:
 *
 *  - the `online` event (the fast path for a real reconnect),
 *  - `visibilitychange` (recover on the next time the tab is focused),
 *  - an initial attempt on mount (covers "came online before this ran"),
 *  - a bounded retry timer while ops remain queued (the backstop for a missed
 *    `online` event — e.g. an offline-loaded SW page).
 *
 * Client-only (touches `window`/`document`); call from an island effect and run
 * the returned cleanup on unmount.
 */
export function startAutoSync(): () => void {
  let stopped = false;

  const drain = () => {
    if (stopped || !navigator.onLine) return;
    void flushQueue();
  };

  const onOnline = () => {
    drain();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") drain();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);

  const timer = window.setInterval(() => {
    if (stopped || !navigator.onLine) return;
    void db.changeQueue.count().then((pending) => {
      if (pending > 0) void flushQueue();
    });
  }, RETRY_INTERVAL_MS);

  drain(); // initial attempt on mount

  return () => {
    stopped = true;
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
    window.clearInterval(timer);
  };
}
