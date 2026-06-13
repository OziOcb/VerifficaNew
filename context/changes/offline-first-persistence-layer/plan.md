# F-02 Offline-First Persistence Layer Implementation Plan

## Overview

F-02 lands Veriffica's local-first persistence foundation: a **client-only Dexie store**, a **hand-rolled Change Queue (outbox)**, a **single-record server sync endpoint** under RLS, and the **`@vite-pwa/astro` service-worker shell**. The acceptance bar is narrow and concrete: **one `inspections` record survives a full offline → online cycle with no loss, and the app shell loads on a real offline browser reload** (FR-023, US-03, Guardrail §No data loss on connectivity change).

This foundation is sequenced before every domain slice (S-02…S-08) so they are built local-first from day one and never need an online-first → offline retrofit.

## Current State Analysis

The codebase is a **clean slate** for this work — verified by direct read:

- **No persistence code exists**: no `src/lib/db.ts`, no `src/pages/api/inspections/`, and none of the deps (`dexie`, `dexie-react-hooks`, `type-fest`, `camelcase-keys`, `snakecase-keys`, `@vite-pwa/astro`) are in `package.json`. The recent commit `ae1e410` only amended the reference doc, not code.
- **No PWA/service worker**: confirmed absent in the roadmap baseline; `@vite-pwa/astro` is not installed and `astro.config.mjs` has no PWA integration.
- **The integration points the plan builds on all exist and match the research**:
  - `createClient(requestHeaders, cookies)` returns `null` when env is unset (`src/lib/supabase.ts:6-9`) — must null-check.
  - `context.locals.user` is populated from the cookie session by middleware (`src/middleware.ts:13`); `PROTECTED_ROUTES = ["/dashboard"]` (`src/middleware.ts:4`).
  - The established island → `POST /api/*` → server-client pattern (`src/pages/api/auth/signin.ts:4-20`).
  - `inspections` Row is a snake_case 6-column skeleton (`id, owner_id, status, name, created_at, updated_at`) (`src/db/database.types.ts:38-45`); the F-01 `set_updated_at()` trigger stamps `updated_at` server-side on every write (`supabase/migrations/20260610181920_create_inspections.sql:19-45`).
  - `@/*` → `src/*` alias (`tsconfig.json`); React 19 islands mount via `client:load` today; vitest harness + `tests/helpers/supabase.ts` present.

**All four F-02 architecture decisions are settled and binding** (see `research.md` §Decisions and roadmap F-02 §Decisions). This plan implements them; it does not re-open them.

## Desired End State

After this plan:

1. A `client:only` React island on a throwaway `/offline-demo` page can create/update one `inspections` record. The write lands in Dexie **optimistically and offline**, and an outbox entry is enqueued atomically.
2. On reconnect (`window` `online` event), the outbox drains FIFO to `POST /api/inspections/sync`; the server upserts the row under RLS, stamps `owner_id` + `updated_at`, and returns the authoritative camelCase row, which the client adopts (`synced` → 1).
3. With the network offline, **reloading the page still loads the app shell** (served by the service worker), and the locally-stored record is still present.
4. A Playwright e2e test proves the full offline-write → offline-reload → reconnect → sync → survive cycle; unit tests cover the queue/transform logic and the endpoint.

**Verification**: `npm test` (unit + endpoint) and the Playwright e2e both pass; a manual DevTools-offline reload shows the shell + record surviving.

### Key Discoveries

- **No browser Supabase client / no client-exposed key** — `SUPABASE_KEY` is a server-only secret (`astro.config.mjs:19`); the only client is the SSR cookie-based `createServerClient` (`src/lib/supabase.ts`). Sync **must** go through a server endpoint, never a direct browser→Supabase call (research §Incompatibility #1).
- **Server is the LWW authority** — F-01's `set_updated_at()` trigger clobbers any client-sent `updated_at`; the client's local `updatedAt` is only an optimistic ordering hint and is overwritten by the server's returned value (research Decision #1).
- **Dexie is client-only** — IndexedDB has no global in workerd SSR. `src/lib/db.ts` must never be imported by `.astro` frontmatter or any server module (`dexie-reference.md` §SSR gotcha). `client:only="react"` is the safe directive.
- **Casing**: camelCase everywhere in app code; snake_case confined to Postgres + the single sync endpoint, via one generic transformer — never a per-table mapper (`lessons.md` "Field casing"; research Decision #3).
- **Booleans aren't indexable in IndexedDB** — `synced` is `0 | 1` (`dexie-reference.md` §1).

## What We're NOT Doing

- **Multi-tab leader election / Web Locks guard** — deferred to S-08. F-02 is single-device/single-record; concurrent multi-tab replay is acceptable here (research; user decision).
- **`@tanstack/offline-transactions`** — not adopting; hand-rolled outbox matches the scope cap and the learning goal.
- **CRDTs / HLC / monotonic LWW clock** — out of scope; plain server-authoritative timestamp LWW is adequate for single-writer (research §Net resolution).
- **Per-question `notes` table / notes granularity** — no notes entity exists until S-05; not built here.
- **Full installable PWA** (icon set, install prompt, `manifest` polish) — F-02 ships only the SW + offline app-shell + a minimal manifest. Installability is a later concern (user decision).
- **Batch / multi-entity sync** — the endpoint takes one queued op at a time (research Decision #2).
- **Pushing the `inspections` migration to hosted Supabase** — that's S-02's explicit deploy step (roadmap S-02 §Deploy note); F-02 round-trips against the local Supabase.
- **Camel-casing the database** — Postgres stays snake_case (`lessons.md`).

## Implementation Approach

Assemble proven, stack-compatible parts rather than build from zero (research §Risk). Four phases, each ending in a verifiable state:

1. **Store first** — the Dexie schema + derived types are the contract everything else depends on; build and unit-test them in isolation (`fake-indexeddb`).
2. **Server boundary next** — the sync endpoint is the single place casing converts and server authority is re-established; build and test it independently of the client.
3. **Client wiring** — optimistic write + atomic enqueue + FIFO replay + the `useLiveQuery` island on a throwaway demo page.
4. **SW shell + capstone e2e** — the service worker makes the offline _reload_ work; the Playwright e2e validates the whole round-trip including a real offline reload.

> **Library-API note**: per `research.md`, exact current API for `@vite-pwa/astro`, Dexie, `type-fest`, and `camelcase-keys`/`snakecase-keys` is pulled via **Context7 at implement time** — not from training data. This plan fixes intent and contracts; the implementer fetches current syntax.

## Critical Implementation Details

- **Import discipline (load-bearing)**: `src/lib/db.ts` and anything importing it must never enter an SSR path. Mount the demo island with `client:only="react"`, and keep all Dexie access inside client modules. A stray import into `.astro` frontmatter throws at build/render on workerd.
- **Atomicity is the no-data-loss mechanism**: the optimistic write to `inspections` and the `changeQueue.add` must happen in one `db.transaction("rw", …)`. If either fails, both roll back — you never get a saved record with no outbox entry, or vice versa (`dexie-reference.md` §2).
- **Never trust client `owner_id`**: the endpoint stamps `owner_id` from `context.locals.user.id` and lets RLS `with check (owner_id = auth.uid())` enforce it. The client payload's `ownerId`, if any, is overwritten (research Decision #2c).
- **Workerd parity (`lessons.md`)**: the new sync endpoint runs on workerd and reuses the proven `@supabase/ssr` server client — keep Node-only deps out of it; the SW is a browser artifact and never touches the Worker. Smoke-test the deployed endpoint with `npx wrangler tail` before calling deploy done.

---

## Phase 1: Dependencies + Dexie store & derived types

### Overview

Add the runtime/dev dependencies and build the client-only Dexie store (`src/lib/db.ts`) with the camelCase-derived `Inspection` type, the `ChangeOp` outbox interface, and the v1 schema. Unit-test the store and queue behavior with `fake-indexeddb`.

### Changes Required

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add the persistence + test deps so the rest of the plan compiles. Pull current versions via Context7 at install time.

**Contract**: Runtime — `dexie`, `dexie-react-hooks`. Dev — `type-fest`, `fake-indexeddb`. (`camelcase-keys`/`snakecase-keys` land in Phase 2; `@vite-pwa/astro` and Playwright in Phase 4.) Install with `npm i …` / `npm i -D …`; commit the lockfile.

#### 2. Client-only Dexie store

**File**: `src/lib/db.ts` (new, client-only)

**Intent**: Define the on-device store: an `inspections` table whose row type is the camelCase projection of the generated snake_case DB Row plus a local-only `synced` flag, and a purely-local `changeQueue` outbox. This is the contract Phases 2–4 build on.

**Contract**:

- `type Inspection = CamelCasedPropertiesDeep<Database["public"]["Tables"]["inspections"]["Row"]> & { synced: 0 | 1 }` — auto-tracks `npm run db:types`, no hand-written interface (research Decision #3; supersedes `dexie-reference.md` §1's earlier hand-written form).
- `interface ChangeOp { seq?: number; entity: "inspections"; entityId: string; op: "put" | "delete"; payload: Inspection; createdAt: number }`.
- Schema `db.version(1).stores({ inspections: "id, ownerId, updatedAt, synced", changeQueue: "++seq, entity, entityId, createdAt" })` — first token = primary key (`id` is a supplied uuid so the same id works locally and in Supabase; `++seq` = FIFO ordinal). `synced` indexed as `0 | 1` (booleans aren't indexable).
- `export { db }; export type { Inspection, ChangeOp };`
- Must be import-disciplined to client code only (Critical Implementation Details).

#### 3. Store/queue unit tests

**File**: `tests/db.test.ts` (new), using `fake-indexeddb`

**Intent**: Verify the store opens, the schema indexes exist, and round-tripping a row preserves the camelCase shape + `synced` flag — independent of any UI or server.

**Contract**: Register `fake-indexeddb` (e.g. `import "fake-indexeddb/auto"`) before importing `db`. Assert: put/get an `Inspection`, `where("synced").equals(0)` returns unsynced rows, `changeQueue` auto-increments `seq`. Follows the existing `tests/*.test.ts` + `vitest.config.ts` pattern.

### Success Criteria

#### Automated Verification

- [ ] Deps install cleanly and lockfile updates: `npm install`
- [ ] Type checking passes: `npx astro sync && npm run lint`
- [ ] Store/queue unit tests pass: `npm test`

#### Manual Verification

- [ ] `Inspection` type resolves to camelCase keys (`ownerId`, `updatedAt`, `createdAt`) in the editor — confirming the `CamelCasedPropertiesDeep` derivation tracks the generated types.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Sync server endpoint + casing boundary

### Overview

Build `POST /api/inspections/sync` — the single boundary that re-establishes server authority and converts casing. It mirrors `/api/auth/*`: server client + cookie auth, 401 guard, strip the local-only `synced` flag, stamp `owner_id` from the session, camel↔snake conversion, and handle both `put` (upsert → authoritative row) and `delete` (204).

### Changes Required

#### 1. Casing dependencies

**File**: `package.json`

**Intent**: Add the generic key-case transformer libraries used only at this boundary.

**Contract**: Runtime — `camelcase-keys`, `snakecase-keys`. One generic transformer for all tables, never per-table (`lessons.md`).

#### 2. Sync endpoint

**File**: `src/pages/api/inspections/sync.ts` (new)

**Intent**: The single server boundary for syncing one queued op to `inspections` under RLS. Implements the five responsibilities from research Decision #2.

**Contract**: `export const POST: APIRoute`. Behavior:

- `createClient(context.request.headers, context.cookies)`; if `null` → 503 (env unset, mirrors auth endpoints).
- `context.locals.user` absent → 401.
- Parse `op` from the JSON body (`{ op, entityId, payload }`).
- `op === "delete"`: `supabase.from("inspections").delete().eq("id", op.entityId)` (RLS scopes to owner) → 204 on success, 400 on error.
- `op === "put"`: strip `synced` from `payload`; `snakecaseKeys({ ...row, ownerId: user.id })` (camel→snake, owner_id stamped server-side); `supabase.from("inspections").upsert(payload).select().single()`; on success return `Response.json(camelcaseKeys(data, { deep: true }))` (snake→camel authoritative row); 400 on error.
- Scope the transform to top-level keys (scalar columns here; no jsonb yet) per `lessons.md`.

#### 3. Endpoint test

**File**: `tests/inspections.sync.test.ts` (new)

**Intent**: Verify the endpoint upserts under RLS, stamps `owner_id` from the session (ignoring a spoofed client `ownerId`), strips `synced`, round-trips casing, and that `delete` is owner-scoped — reusing the `tests/helpers/supabase.ts` harness that `tests/inspections.rls.test.ts` uses.

**Contract**: Assert: a `put` with a foreign/absent `ownerId` persists under the _authenticated_ owner; the returned row is camelCase and carries the server-stamped `updatedAt`; `synced` is never written to the DB; a `delete` removes only the owner's row. Unauthenticated request → 401.

### Success Criteria

#### Automated Verification

- [ ] Type checking + lint pass: `npx astro sync && npm run lint`
- [ ] Endpoint + RLS tests pass: `npm test`

#### Manual Verification

- [ ] `curl`/Thunder a `put` op to `/api/inspections/sync` while signed in (cookie) returns the camelCase authoritative row with a server `updatedAt`; an unauthenticated request returns 401.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Client outbox, sync replay & demo island

### Overview

Wire the client side: an atomic optimistic write + enqueue, a FIFO queue-drain that POSTs each op and adopts the server's authoritative row, `online`-event wiring, and a `useLiveQuery` React island mounted on a throwaway `/offline-demo` page to drive and observe the round-trip.

### Changes Required

#### 1. Client write + outbox + replay helpers

**File**: `src/lib/sync.ts` (new, client-only) — or co-located in `db.ts`

**Intent**: Provide `saveInspection` (optimistic local write + outbox enqueue, atomically) and `flushQueue` (drain the outbox FIFO on reconnect, adopting the server row). These are the no-data-loss mechanism.

**Contract**:

- `saveInspection(data)`: inside one `db.transaction("rw", db.inspections, db.changeQueue, …)` — set `updatedAt`/`synced = 0`, `inspections.put(data)`, `changeQueue.add({ entity, entityId, op: "put", payload, createdAt })`.
- `flushQueue()`: `changeQueue.orderBy("createdAt").toArray()` (FIFO); for each op `fetch("/api/inspections/sync", { method: "POST", headers, body: JSON.stringify(op) })` (same-origin → cookie sent automatically); on `!res.ok` → `break` (retry next online event); on `delete` → 204, drop local row + queue entry in a tx; on `put` → adopt `await res.json()` via `inspections.update(entityId, { ...saved, synced: 1 })` + delete queue entry, in a tx.
- Wire `window.addEventListener("online", flushQueue)` (and an initial flush on mount if `navigator.onLine`).

> **Implemented as `startAutoSync` (addendum):** the wiring shipped richer than this single listener — `startAutoSync()` drains on **four redundant signals** (`online` event, `visibilitychange`, an initial mount drain, and a bounded 4s retry poll while ops remain queued), behind a `flushing` reentrancy guard, and returns a cleanup. The retry poll is the backstop for a dropped `online` event on an offline-loaded SW page. Also added beyond the original contract: `resetLocalStoreOnUserChange(userId)` wipes the per-origin Dexie store on a shared-device user switch (see `change.md` §Follow-ups).

#### 2. Demo island

**File**: `src/components/offline/OfflineDemo.tsx` (new)

**Intent**: A minimal React island that lists `inspections` live and exposes a "save/update record" action — enough to drive and observe the offline → online round-trip. Throwaway; removed when S-02's real dashboard lands.

**Contract**: `useLiveQuery(() => db.inspections.orderBy("updatedAt").toArray())` (returns `undefined` while loading); a button calling `saveInspection` with a generated uuid + minimal fields (`status`, `name`); render each row's `id`/`status`/`synced`. No SSR import of `db`.

#### 3. Demo page

**File**: `src/pages/offline-demo.astro` (new)

**Intent**: Host the island with `client:only="react"` so Dexie never touches SSR. Temporary verification surface.

**Contract**: Mount `<OfflineDemo client:only="react" />`. Not added to `PROTECTED_ROUTES` (it's a demo); reachable while signed in so the sync endpoint has a session.

### Success Criteria

#### Automated Verification

- [ ] Build succeeds (no SSR `indexedDB` access): `npm run build`
- [ ] Type checking + lint pass: `npx astro sync && npm run lint`
- [ ] Existing unit tests still pass: `npm test`

#### Manual Verification

- [ ] On `/offline-demo` while online, saving a record shows it via `useLiveQuery` and it flips to `synced: 1` after the POST.
- [ ] With DevTools "Offline" on, saving still updates the list (optimistic, `synced: 0`); toggling back online drains the queue and flips to `synced: 1` with the server `updatedAt`.
- [ ] No console error about `indexedDB` during SSR/build.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: PWA service-worker shell + offline round-trip e2e

### Overview

Add the `@vite-pwa/astro` service worker so the app shell loads on a real offline reload, excluding auth routes from caching. Then add the capstone Playwright e2e proving the full offline-write → offline-reload → reconnect → sync → survive cycle.

### Changes Required

#### 1. PWA integration

**File**: `astro.config.mjs`, `package.json`

**Intent**: Register `@vite-pwa/astro` with a Workbox config that precaches the static app shell from `dist/client` and serves a navigation fallback offline, while never caching authenticated routes. Minimal manifest only (no full installability).

**Contract**:

- Add dev dep `@vite-pwa/astro`; add it to `integrations` in `astro.config.mjs`.
- Serve offline navigations via a **`NetworkFirst` runtime cache** of visited SSR pages, NOT a static `navigateFallback` shell: SSR emits no static app-shell HTML, so set `navigateFallback: undefined` (a fallback to `/` would point at a non-precached URL and break the SW at startup). Precache only the static client assets (`globPatterns: **/*.{js,css,svg,png,ico,webmanifest}`); the cached SSR document rehydrates the island, which reads Dexie offline. (Implemented at `astro.config.mjs` — supersedes the original `navigateFallback` precache plan, discovered at implement time.)
- **Exclude auth + protected routes from the page cache**: the `NetworkFirst` `urlPattern` matches `request.mode === "navigate"` only and excludes `/api`, `/auth`, and `/dashboard`, so the SW never serves a stale authenticated shell or caches an auth route (research Decision #4). API POSTs (incl. `/api/inspections/sync` and `/api/auth/*`) are non-navigations and never match the rule.
- Minimal `manifest` (name/start_url/display) — no icon set or install prompt.
- Pull current `@vite-pwa/astro` SSR config syntax via Context7 at implement time.

#### 2. Offline round-trip e2e

**File**: `tests/e2e/offline-roundtrip.spec.ts` (new) + Playwright config

**Intent**: Automate the F-02 acceptance bar end-to-end against a built+previewed app (SW only runs in build, not dev): write offline, reload offline (shell loads from SW), reconnect, confirm the record syncs and survives.

**Contract**: Add Playwright dev dep + config; pull current API via Context7. Steps: sign in → go to `/offline-demo` → set context offline → save a record (assert it appears, `synced: 0`) → **reload while offline** (assert the shell still renders the island — proves SW app-shell fallback) → set online → assert the record reaches `synced: 1` and persists. Add an `npm run` script for the e2e (e.g. `test:e2e`) so CI/local can invoke it. Note: SW requires `npm run build && npm run preview` (or equivalent), not `astro dev`.

#### 3. Cleanup note

**Intent**: Record that `/offline-demo` + `OfflineDemo.tsx` are throwaway, to be removed when S-02's dashboard subsumes them.

**Contract**: A short note in the demo page/component comment and in `change.md` so S-02 picks it up.

### Success Criteria

#### Automated Verification

- [ ] Production build emits a service worker + precache manifest: `npm run build`
- [ ] Type checking + lint pass: `npx astro sync && npm run lint`
- [ ] Unit + endpoint tests pass: `npm test`
- [ ] Offline round-trip e2e passes: `npm run test:e2e`

#### Manual Verification

- [ ] In a built+previewed app, with the network set offline in DevTools, **reloading `/offline-demo` still loads the app shell** (not the browser's offline error page).
- [ ] A record saved offline is still present after the offline reload, and syncs (`synced: 1`) on reconnect.
- [ ] Signing out/in still works — the SW did not cache `/api/auth/*` or a stale authenticated shell.
- [ ] Deployed endpoint smoke-tested with `npx wrangler tail` (workerd parity, `lessons.md`) — no Node-API runtime error from the sync route.

**Implementation Note**: After automated + manual verification passes, F-02 is complete; update `change.md` status and the roadmap F-02 status.

---

## Testing Strategy

### Unit Tests

- **Store/queue** (`tests/db.test.ts`, `fake-indexeddb`): schema/indexes, put/get round-trip preserving camelCase + `synced`, `where("synced").equals(0)`, `changeQueue` FIFO `++seq`.
- **Sync endpoint** (`tests/inspections.sync.test.ts`, `tests/helpers/supabase.ts`): owner_id stamped from session (ignores spoofed client value), `synced` stripped, casing round-trip, delete owner-scoped, 401 unauthenticated, 503 unconfigured.

### Integration / e2e Tests

- **Offline round-trip** (`tests/e2e/offline-roundtrip.spec.ts`, Playwright, against built+previewed app): offline write → offline reload (SW shell) → reconnect → sync → survive. This is the F-02 no-data-loss guardrail check.

### Manual Testing Steps

1. `npm run build && npm run preview`; sign in; open `/offline-demo`.
2. DevTools → Network → Offline. Save a record; confirm it appears `synced: 0`.
3. Reload while offline; confirm the app shell + record still render.
4. Go online; confirm the record flips to `synced: 1` with a server `updatedAt`.
5. Sign out and back in; confirm auth still works (no stale cached shell).

## Performance Considerations

Negligible at F-02 scope (one record). Indexed Dexie fields (`updatedAt`, `synced`) keep the live query and outbox scans cheap. The SW precache covers only the static shell, not server-rendered authenticated pages.

## Migration Notes

No DB migration in F-02 — it round-trips against F-01's existing `inspections` table on the local Supabase. Pushing that migration to hosted Supabase is **S-02's** job (roadmap S-02 §Deploy note). `synced` is a local-only Dexie flag with no DB column.

## References

- Research / decisions: `context/changes/offline-first-persistence-layer/research.md`
- Dexie API reference (binding contracts): `context/changes/offline-first-persistence-layer/dexie-reference.md`
- Unknowns & risks: `context/changes/offline-first-persistence-layer/research-of-unknowns-and-risks.md`
- Field-casing rule: `context/foundation/lessons.md`
- Pattern to mirror (island → server endpoint): `src/pages/api/auth/signin.ts`, `src/components/auth/SignInForm.tsx`
- RLS test pattern: `tests/inspections.rls.test.ts`, `tests/helpers/supabase.ts`
- F-01 trigger + schema: `supabase/migrations/20260610181920_create_inspections.sql:19-45`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Dependencies + Dexie store & derived types

#### Automated

- [x] 1.1 Deps install cleanly and lockfile updates: `npm install` — 496d3bd
- [x] 1.2 Type checking passes: `npx astro sync && npm run lint` — 496d3bd
- [x] 1.3 Store/queue unit tests pass: `npm test` — 496d3bd

#### Manual

- [x] 1.4 `Inspection` type resolves to camelCase keys in the editor (CamelCasedPropertiesDeep tracks generated types) — 496d3bd

### Phase 2: Sync server endpoint + casing boundary

#### Automated

- [x] 2.1 Type checking + lint pass: `npx astro sync && npm run lint` — 14f5afb
- [x] 2.2 Endpoint + RLS tests pass: `npm test` — 14f5afb

#### Manual

- [x] 2.3 Authenticated `put` returns camelCase authoritative row with server `updatedAt`; unauthenticated returns 401 — 14f5afb

### Phase 3: Client outbox, sync replay & demo island

#### Automated

- [x] 3.1 Build succeeds (no SSR indexedDB access): `npm run build` — 1585687
- [x] 3.2 Type checking + lint pass: `npx astro sync && npm run lint` — 1585687
- [x] 3.3 Existing unit tests still pass: `npm test` — 1585687

#### Manual

- [x] 3.4 Online save shows via useLiveQuery and flips to `synced: 1` — 1585687
- [x] 3.5 Offline save is optimistic (`synced: 0`); reconnect drains queue to `synced: 1` with server `updatedAt` — 1585687
- [x] 3.6 No SSR/build `indexedDB` console error — 1585687

### Phase 4: PWA service-worker shell + offline round-trip e2e

#### Automated

- [x] 4.1 Production build emits service worker + precache manifest: `npm run build` — 083946a
- [x] 4.2 Type checking + lint pass: `npx astro sync && npm run lint` — 083946a
- [x] 4.3 Unit + endpoint tests pass: `npm test` — 083946a
- [x] 4.4 Offline round-trip e2e passes: `npm run test:e2e` — 083946a

#### Manual

- [x] 4.5 Offline reload of `/offline-demo` loads the app shell (not the browser offline page) — 083946a
- [x] 4.6 Record saved offline survives the reload and syncs on reconnect — 083946a
- [x] 4.7 Sign out/in still works (SW did not cache auth routes / stale shell) — 083946a
- [ ] 4.8 Deployed sync endpoint smoke-tested with `wrangler tail` (workerd parity)
