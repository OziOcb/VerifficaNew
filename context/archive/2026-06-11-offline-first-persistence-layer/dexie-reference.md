---
change_id: offline-first-persistence-layer
title: F-02 Dexie reference — on-device store, change queue, sync replay
status: reference
created: 2026-06-11
updated: 2026-06-11
source: Context7 /websites/dexie (High reputation, fetched 2026-06-11)
related: research.md
---

# Dexie for F-02

Implementation reference for the on-device store, Change Queue (outbox), and LWW
sync-replay pieces of F-02 (`context/foundation/roadmap.md`). Pairs with
`research.md` (architecture decisions). Code from Context7 `/websites/dexie`.

## ⚠️ Astro SSR gotcha (read first)

Dexie wraps **IndexedDB, which only exists in the browser** — there is no
`indexedDB` global in the Cloudflare Worker that runs SSR. The `db` instance must
only ever be instantiated/opened **client-side**: inside a React island
(`client:load` / `client:only`) or a `.ts` module imported only by client code.
**Never** import `db.ts` into `.astro` frontmatter or anything that runs during
SSR, or the build/render throws. For interactive surfaces touching Dexie,
`client:only="react"` is the safest directive.

## 1. On-device store — schema, versioning, typing

Modern `EntityTable` form:

```typescript
// src/lib/db.ts  — client-only
import { Dexie, type EntityTable } from "dexie";
import type { CamelCasedPropertiesDeep } from "type-fest";
import type { Database } from "@/db/database.types";

// camelCase row DERIVED from the generated snake_case types — auto-tracks
// `npm run db:types`, no per-table mapper (lessons.md "Field casing").
// `synced` is a LOCAL-ONLY outbox flag (no DB column); 0|1 since IndexedDB
// can't index booleans. `updatedAt` is the DB's ISO `timestamptz` string —
// ISO strings sort chronologically, so it indexes fine for LWW ordering.
type InspectionRow = Database["public"]["Tables"]["inspections"]["Row"];
type Inspection = CamelCasedPropertiesDeep<InspectionRow> & { synced: 0 | 1 };

// Change Queue is purely local (no DB table) — hand-written interface.
interface ChangeOp {
  seq?: number; // ++auto-increment FIFO ordinal
  entity: "inspections";
  entityId: string;
  op: "put" | "delete";
  payload: Inspection; // camelCase; converted to snake_case at the sync endpoint
  createdAt: number;
}

const db = new Dexie("veriffica") as Dexie & {
  inspections: EntityTable<Inspection, "id">;
  changeQueue: EntityTable<ChangeOp, "seq">;
};

db.version(1).stores({
  // first token = primary key; rest = indexes (camelCase property names)
  inspections: "id, ownerId, updatedAt, synced",
  changeQueue: "++seq, entity, entityId, createdAt",
});

export { db };
export type { Inspection, ChangeOp };
```

> Needs `type-fest` as a dev dependency (`npm i -D type-fest`). The snake↔camel
> conversion at runtime happens only at the sync endpoint (§3), not here — the
> Dexie store is camelCase end-to-end.

Rules:

- **First token in each `stores()` string is the primary key.** `++id` =
  auto-increment; bare `id` = you supply it (use this for **uuids** so the same id
  works locally and in Supabase). `++seq` on the queue gives a monotonic FIFO
  ordinal for free.
- Other tokens are **indexes** — only indexed fields work in `.where()`. Index
  `updatedAt` (LWW comparisons) and `synced` (find unsynced rows).
- **Booleans aren't indexable** — use `0/1`.
- **Schema changes require a new `db.version(n)`** block; Dexie migrates existing
  data. Pull the exact `.version(2).stores(...).upgrade(tx => …)` syntax via
  Context7 when a migration is actually needed — F-02's single record likely stays
  on v1.
- `db.on("populate", …)` seeds first-run data if ever needed.

Subclass form (equivalent, if preferred over the `as Dexie & {…}` cast):

```typescript
import { Dexie } from "dexie";

class MyDatabase extends Dexie {
  contacts!: Dexie.Table<IContact, number>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ contacts: "++id,first,last" });
    this.contacts = this.table("contacts");
  }
}
```

## 2. CRUD + the Change Queue (outbox)

```typescript
// optimistic local write + enqueue, atomically
async function saveInspection(data: Inspection) {
  await db.transaction("rw", db.inspections, db.changeQueue, async () => {
    data.updatedAt = Date.now();
    data.synced = 0;
    await db.inspections.put(data); // add-or-replace
    await db.changeQueue.add({
      entity: "inspections",
      entityId: data.id,
      op: "put",
      payload: data,
      createdAt: Date.now(),
    });
  });
}
```

- `add` (insert, throws on dup key) / `put` (upsert) / `update(id, partial)` /
  `delete(id)`.
- Bulk: `bulkAdd` / `bulkPut` / `bulkDelete([ids])` — use for sync replay.
- **`db.transaction("rw", tables…, fn)`** makes write + enqueue atomic — if either
  fails, the whole thing rolls back, so you never get a saved record with no queue
  entry (or vice-versa). This is the "no data loss" guardrail mechanism. Inside a
  transaction you can read your own just-written rows.

## 3. Sync replay — drain the queue on reconnect

> ⚠️ **Push through a server endpoint, NOT a browser Supabase client.** This
> codebase has **no browser-side Supabase client** and exposes **no anon/public
> key** — `SUPABASE_KEY` is a server-only secret (`astro.config.mjs`), the only
> client is the SSR cookie-based `createServerClient` (`src/lib/supabase.ts`), and
> the session lives in HTTP cookies. So the queue is drained by `fetch`-POSTing
> each op to a **new Astro server endpoint** that mirrors `/api/auth/*`. The
> same-origin `fetch` carries the auth cookie automatically, and the endpoint
> reuses the server client so RLS + the server-only secret keep working. See the
> compatibility review in `research.md` (Incompatibility #1).

Client side (in the Dexie/`client:only` island):

```typescript
async function flushQueue() {
  const ops = await db.changeQueue.orderBy("createdAt").toArray(); // FIFO
  for (const op of ops) {
    const res = await fetch("/api/inspections/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(op), // cookie sent automatically (same-origin)
    });
    if (!res.ok) break; // stop on failure; retry on next online event
    if (op.op === "delete") {
      // 204 No Content — no body to parse; just drop the local row + queue entry.
      await db.transaction("rw", db.inspections, db.changeQueue, async () => {
        await db.inspections.delete(op.entityId);
        await db.changeQueue.delete(op.seq);
      });
      continue;
    }
    // server returns the authoritative row (camelCase, incl. server-stamped updatedAt)
    const saved = await res.json();
    await db.transaction("rw", db.inspections, db.changeQueue, async () => {
      await db.inspections.update(op.entityId, { ...saved, synced: 1 });
      await db.changeQueue.delete(op.seq);
    });
  }
}
```

Server side — new endpoint, same pattern as `src/pages/api/auth/signin.ts`. This
is the **single boundary** that converts casing and re-establishes server
authority — it strips the local-only `synced` flag, stamps `owner_id` from the
cookie session (never trusts the client), converts camelCase→snake_case on the way
in and snake_case→camelCase on the way out, and handles both `put` and `delete`:

```typescript
// src/pages/api/inspections/sync.ts
import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import snakecaseKeys from "snakecase-keys";
import camelcaseKeys from "camelcase-keys";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase not configured", { status: 503 });

  const user = context.locals.user; // cookie session, set by src/middleware.ts
  if (!user) return new Response("Unauthorized", { status: 401 });

  const op = await context.request.json();

  if (op.op === "delete") {
    // RLS scopes the delete to the owner; no body to return.
    const { error } = await supabase.from("inspections").delete().eq("id", op.entityId);
    if (error) return new Response(error.message, { status: 400 });
    return new Response(null, { status: 204 });
  }

  // Strip the local-only `synced` flag (no DB column). Server stamps owner_id —
  // RLS `with check (owner_id = auth.uid())` rejects anything else on insert.
  const { synced: _synced, ...row } = op.payload;
  const payload = snakecaseKeys({ ...row, ownerId: user.id }); // camel → snake at the boundary

  const { data, error } = await supabase.from("inspections").upsert(payload).select().single();

  if (error) return new Response(error.message, { status: 400 });
  return Response.json(camelcaseKeys(data, { deep: true })); // snake → camel; authoritative row back
};
```

- **Query API (client):** `.where("synced").equals(0)`, `.orderBy("createdAt")`,
  `.between(...)`, `.filter(fn)`, `.toArray()`, `.each(fn)`, `.first()`. Only
  indexed fields work in `.where()`/`.orderBy()`; arbitrary predicates go through
  `.filter()` (full scan).
- Wire `flushQueue()` to `window.addEventListener("online", …)`.
- **LWW authority:** the F-01 `set_updated_at()` trigger stamps `updated_at`
  server-side on every write, so the server is the LWW authority — the client
  adopts the returned row rather than pushing its own `updatedAt` (research.md,
  Interaction #2 / Decision #1).
- **Casing:** the store and the `fetch` payload are **camelCase** end-to-end. The
  sync endpoint is the **single boundary** that converts to/from snake_case (via
  the key transformer), stamps `owner_id`, and strips the local-only `synced`
  flag. Do **not** snake_case anything client-side (research.md Decision #3 —
  supersedes the earlier Interaction #3 snake_case-payload suggestion).

## 4. React 19 reactivity — `useLiveQuery`

```bash
npm i dexie dexie-react-hooks
```

```tsx
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";

export function InspectionList() {
  const items = useLiveQuery(() => db.inspections.orderBy("updatedAt").toArray());
  if (!items) return <div>Loading…</div>; // undefined = first run
  return (
    <ul>
      {items.map((i) => (
        <li key={i.id}>{i.id}</li>
      ))}
    </ul>
  );
}
```

- `useLiveQuery(queryFn, deps?)` re-renders automatically whenever the underlying
  tables change — an offline write (or a sync flipping `synced`) updates the UI
  with no manual state. Pass a deps array when the query depends on props
  (e.g. `[ownerId]`), like `useEffect`.
- Returns `undefined` until the first result resolves — that's the loading state.

## Mapping to F-02 resolutions (see research.md)

- **LWW**: the local `updatedAt` index orders the outbox; the **server** is the
  LWW authority (the F-01 `set_updated_at()` trigger stamps `updated_at` on every
  write), so the client adopts the row returned by `/api/inspections/sync` (§3).
- **Notes granularity fix**: model per-question notes as separate rows in a `notes`
  table keyed by `[inspectionId+questionId]` (compound index) rather than one blob
  — independent edits never collide.
- **Multi-tab guard**: Dexie does not do leader election — that stays a
  `navigator.locks` / `BroadcastChannel` wrapper around `flushQueue()` (or
  `@tanstack/offline-transactions`).
