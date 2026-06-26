---
date: 2026-06-24T14:27:00+0100
researcher: OziOcb
git_commit: e100fabf12f25a6ce24bc39ea78d1d800a280ad0
branch: main
repository: OziOcb/VerifficaNew
topic: "Offline durability at flow level — multiple offline writes survive offline → reload → reconnect; Change Queue drains FIFO (test-plan Phase 2, risk #1)"
tags: [research, codebase, offline, sync, dexie, outbox, change-queue, e2e, integration]
status: complete
last_updated: 2026-06-24
last_updated_by: OziOcb
---

# Research: Offline durability at flow level (test-plan Phase 2, risk #1)

**Date**: 2026-06-24T14:27:00+0100
**Researcher**: OziOcb
**Git Commit**: e100fabf12f25a6ce24bc39ea78d1d800a280ad0
**Branch**: main
**Repository**: OziOcb/VerifficaNew

## Research Question

Phase 2 of `context/foundation/test-plan.md`: _"Offline durability at flow level."_
Risk #1 — answers/notes written offline mid-inspection vanish or fail to sync on
reconnect (flow-level, multiple writes). Prove that several offline writes plus a
note survive offline → reload → reconnect with zero loss, and that the Change Queue
drains FIFO. Challenge the assumption that F-02's single-record round-trip already
proves the whole flow. Avoid happy-path-only (one record) and treating a final 200
as proof every op landed. Ground: Change Queue seq/FIFO under multiple ops;
partial-failure retry; what triggers the drain.

## Summary

Three findings reframe this phase, two of them load-bearing:

1. **The existing offline e2e is dead.** `tests/e2e/offline-roundtrip.spec.ts` drives
   `/offline-demo` — a throwaway page (`src/pages/offline-demo.astro` +
   `src/components/offline/OfflineDemo.tsx`) that was **deleted in S-02** (commit
   `ec0222c`, "delete throwaway offline demo"). The route 404s at HEAD, so the spec
   would fail the moment `npm run test:e2e` runs. The test-plan's intent to "extend
   the offline e2e" is really **rebuild it against the real session flow**, because the
   surface it tested no longer exists.

2. **There is no per-question "answer" store yet** (S-05 is unbuilt — test-plan §2
   scope note, and `SessionScreen.tsx:9-14`). At today's built state the only
   offline-writable domain data is **Part 1 config fields, the 5 equipment flags, and
   the 10,000-char global notes** — every one persisted through the same
   `saveInspection` → outbox path. So "several offline answers plus a note" maps,
   honestly and without inventing code, to **multiple `saveInspection` writes (config
   fields / flags) plus a global-notes write** — N queue ops draining FIFO. Do **not**
   invent an answer store to test it.

3. **`flushQueue`/`drainQueue` — the actual FIFO drain — has zero test coverage
   today.** `tests/sync.test.ts` only exercises the `saveInspection` read-merge (no
   network, no drain). `tests/db.test.ts` covers the Dexie schema + `seq`
   auto-increment in isolation. Nothing tests: multi-op FIFO drain, partial-failure
   stop-and-resume, the reentrancy guard, server-row adoption, or the `delete` branch.
   This is the cheapest, highest-signal gap and the core of Phase 2's integration layer.

Cheapest layers, per the test-plan's guidance:

- **Integration (Vitest + `fake-indexeddb`, fetch mocked):** drive `saveInspection`
  several times, then `flushQueue`, asserting every op POSTs **in FIFO order**, the
  queue empties, rows flip `synced: 1`, and a mid-drain failure leaves the **remainder
  queued in order** and resumes on the next drain. This is where "every op landed" and
  "FIFO" are proven deterministically.
- **E2E (Playwright, rebuilt):** the real session screen at
  `/inspections/{id}/session` — write Part 1 config offline, write global notes
  offline, reload offline (SW shell), reconnect, and assert **each** distinct write
  survived server-side (via an SSR re-read), not just a single final "synced" badge.

## Detailed Findings

### The offline persistence mechanism (`src/lib/sync.ts`)

`saveInspection` (`src/lib/sync.ts:101-134`) is the single write path. Per call it does,
in **one Dexie `rw` transaction** (atomic — both or neither):

- read-merge the existing row (overlay only caller-supplied `DATA_FIELDS`, preserve the
  rest — `sync.ts:104-123`), then `db.inspections.put(row)` with `synced: 0`;
- `db.changeQueue.add({ entity, entityId, op: "put", payload: row, createdAt: Date.now() })`.

So **N saves to the same inspection enqueue N ops**, each carrying the full merged
row snapshot at that moment. The server upsert is last-writer-wins; FIFO order is what
guarantees the _last_ offline edit is the one that ends up authoritative.

`drainQueue` (`sync.ts:159-192`) is the FIFO drain:

- `const ops = await db.changeQueue.orderBy("createdAt").toArray();` — **ordered by
  `createdAt` (numeric `Date.now()`), not by `seq`** (see Architecture Insights — this
  is a real edge to assert).
- For each op: `fetch("/api/inspections/sync", …)`. On a thrown fetch (offline) →
  `break` (`sync.ts:170-172`); on `!res.ok` → `break` (`sync.ts:174`). **Break, not
  continue** — the remainder stays queued in order and a later trigger resumes.
- On success: `put` adopts the server's authoritative camelCase row and sets
  `synced: 1`, then deletes the queue entry, in one `rw` transaction
  (`sync.ts:185-190`); `delete` drops row + queue entry (`sync.ts:176-183`).

`flushQueue` (`sync.ts:149-157`) wraps `drainQueue` with a **module-level `flushing`
reentrancy guard** (`sync.ts:139, 150-156`) so overlapping triggers can't double-POST
the same op before the first reconciles its queue delete.

`startAutoSync` (`sync.ts:216-249`) is what **triggers the drain** — deliberately
redundant so durability doesn't hinge on one signal:

- `window` `online` event (fast path),
- `document` `visibilitychange` → visible,
- an initial `drain()` on mount,
- a bounded `setInterval` every `RETRY_INTERVAL_MS = 4000` (`sync.ts:197`) that flushes
  while `changeQueue.count() > 0` — the backstop for a missed `online` event (e.g. an
  offline-loaded SW page that never fires `online`).
  Each guard early-returns unless `navigator.onLine` (`sync.ts:219-222`).

### The on-device store + Change Queue (`src/lib/db.ts`)

- `Inspection` = `CamelCasedPropertiesDeep<InspectionRow> & { synced: 0 | 1 }`
  (`db.ts:14-15`) — camelCase projection auto-tracking `npm run db:types`; `synced` is
  `0 | 1` because IndexedDB can't index booleans (`db.ts:13`).
- `ChangeOp` (`db.ts:20-27`) is hand-written (the queue has no DB table): `seq?` is the
  auto-increment FIFO ordinal, `payload` is the full camelCase row, `createdAt` is a
  numeric ordering hint.
- Schema (`db.ts:34-40`): `inspections: "id, ownerId, updatedAt, synced"`;
  `changeQueue: "++seq, entity, entityId, createdAt"`. `++seq` is the monotonic FIFO
  key; `id` is a supplied uuid so the same id works locally and in Supabase.

### The sync endpoint (`src/pages/api/inspections/sync.ts`)

The single server boundary for one queued op:

- 503 if Supabase unconfigured (`sync.ts:25`); **401 if no session** (`sync.ts:28`);
  400 on invalid JSON (`sync.ts:34`).
- `delete` → RLS-scoped delete → **204, no body** (`sync.ts:37-42`).
- `put` → strip local-only `synced`, **stamp `owner_id` from the session (never the
  client)**, `snakecaseKeys`, `upsert().select().single()`, return the authoritative
  row as `camelcaseKeys(deep)` (`sync.ts:44-59`).
- Casing converts only here (lessons.md "Field casing"); scalar columns only, no jsonb.
- Note: this endpoint does **no domain-input validation** (size / cross-field) — that's
  deliberately Phase 3's risk #6, _not_ this phase. Don't pull it in.

### Where multiple writes actually originate (the real flow)

- **`Part1Form.tsx`** mounts `startAutoSync()` (`:231`), and on submit calls one
  `saveInspection({...full config...})` then a best-effort `flushQueue()` (`:312-324`).
  One submit = one op. Field `onBlur`/`onChange` drive local form state, not per-field
  saves.
- **`SessionScreen.tsx`** mounts `startAutoSync()` (`:74`) and persists global notes via
  a **600 ms debounced** sparse `saveInspection({ id, globalNotes })` then `flushQueue()`
  (`:34, :85-102`). Each debounced settle = one op. It reads the live row via
  `useLiveQuery` (`:76`) so an unsynced offline edit is reflected without a server round
  trip, and re-hydrates the same value after an offline reload.
- The SSR page `src/pages/inspections/[id]/session.astro` reads the row under RLS
  (snake→camel at the single boundary), runs the visibility engine server-side, and
  passes only scalar fields + counts to the `client:only="react"` island. An absent row
  (RLS hid it) → redirect to `/dashboard`. **This SSR re-read is the e2e's oracle** for
  "the write actually landed on the server" after reconnect + reload.

So a realistic **multi-write offline flow** for the e2e: open a draft → Part 1, fill +
submit config offline (op 1) → back to session, type global notes offline (op 2, maybe
edit again → op 3) → reload offline (values survive via Dexie) → reconnect → assert each
of config + notes is present after an SSR reload.

### Existing test coverage (baseline + gaps)

| File                                  | Covers                                                                                                        | Gap for Phase 2                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `tests/db.test.ts`                    | Dexie schema opens; camelCase + `synced` round-trip; `synced` index; `changeQueue` `seq` auto-increments FIFO | schema-only; never drains the queue                                                                                |
| `tests/sync.test.ts`                  | `saveInspection` **read-merge** (sparse save preserves config/notes; first-write nulls)                       | **no `flushQueue`/`drainQueue` at all** — no FIFO drain, no partial-failure, no reentrancy, no server-row adoption |
| `tests/e2e/offline-roundtrip.spec.ts` | F-02 single-record offline write → offline reload (SW shell) → reconnect → one "synced" badge                 | **DEAD** (targets deleted `/offline-demo`); single record; asserts one final status, not per-op landing            |
| `tests/e2e/seed.spec.ts`              | created row persists across reload via SSR read; delete flow                                                  | not offline; good template for sign-in + SSR-read oracle                                                           |

The integration gap (row 2) is the cheapest, highest-signal target; the e2e (row 3)
must be rebuilt, not extended.

### Test harness facts (for the plan)

- **Vitest** (`npm test`): `fake-indexeddb/auto` imported **before** `@/lib/db` so Dexie
  opens against an in-memory IDB (`tests/db.test.ts:3`, `tests/sync.test.ts:3`). Mock
  `fetch` (vi) at the network edge per test-plan §6.2 mocking policy ("only mock at the
  network/DB edge; never internal modules"). `beforeEach db.open()`, `afterEach` clear
  both tables.
- **Playwright** (`npm run test:e2e`): `playwright.config.ts` runs against the **built
  app served by `wrangler dev` on :4321** (SW is build-only — lessons.md). `fullyParallel:
false`, `workers: 1`, `timeout: 90s`, `webServer.timeout: 180s`. Helpers in
  `tests/helpers/supabase.ts`: `createConfirmedUser`, `deleteUser`, `signInAs`,
  `adminClient` (service-role). Offline control via Playwright `context.setOffline()`.
  Requires local Supabase (`npx supabase start`).
- **Config wart:** `playwright.config.ts` declares a `setup` project matching
  `/auth\.setup\.ts/` and a chromium project with `storageState:
"playwright/.auth/user.json"`, but **no `auth.setup.ts` exists** and the existing
  specs sign in inline per test. There are also two projects literally named `"chromium"`.
  Decide in planning whether to lean on inline sign-in (as today) or actually add the
  setup project; don't silently inherit a broken `storageState` dependency.

## Code References

- `src/lib/sync.ts:101-134` — `saveInspection`: atomic optimistic put + outbox enqueue, read-merge
- `src/lib/sync.ts:159-192` — `drainQueue`: FIFO drain, **break-on-failure** (preserve order), server-row adoption, delete branch
- `src/lib/sync.ts:149-157, 139` — `flushQueue` + module-level `flushing` reentrancy guard
- `src/lib/sync.ts:216-249, 197` — `startAutoSync`: online/visibility/mount/4000ms-timer triggers; `navigator.onLine` gating
- `src/lib/sync.ts:160` — `orderBy("createdAt")` — drain orders by numeric `createdAt`, not `seq`
- `src/lib/db.ts:20-40` — `ChangeOp` shape + `++seq` / `createdAt` indexes
- `src/pages/api/inspections/sync.ts:23-59` — sync endpoint: 401 gate, owner_id stamp, upsert, 204 delete; no domain validation
- `src/components/inspections/SessionScreen.tsx:74, 85-102, 34` — debounced global-notes save + autosync mount
- `src/components/inspections/Part1Form.tsx:231, 312-324` — config submit save + autosync mount
- `src/pages/inspections/[id]/session.astro:18-44` — SSR RLS re-read (the e2e oracle) + redirect-on-null
- `tests/sync.test.ts:1-81` — read-merge coverage (no drain) — extend here for the integration drain tests
- `tests/db.test.ts:82-108` — `seq` FIFO auto-increment (schema-level)
- `tests/e2e/offline-roundtrip.spec.ts:27-62` — dead single-record e2e (targets deleted `/offline-demo`)
- `tests/e2e/seed.spec.ts` — sign-in + SSR-read-after-reload template to mirror
- `playwright.config.ts` — built-app-via-wrangler webServer; stale `auth.setup.ts`/`storageState` projects

## Architecture Insights

- **Outbox/Change Queue (offline-first), not snapshot sync.** Every edit is a discrete
  queued op carrying a full row snapshot; durability = atomic enqueue + ordered drain +
  server-authoritative adopt. Last-writer-wins on the server, so **FIFO is what makes
  the last offline edit authoritative**.
- **"Every op landed" ≠ "final 200."** Because each op carries a full snapshot and the
  server upserts, a single final "synced" badge can be green even if an _intermediate_
  op was skipped — the last snapshot would still carry the merged data. The test must
  assert **order and per-op POST**, not just the terminal state. This is exactly the
  anti-pattern the test-plan flags.
- **FIFO ordering edge — `createdAt` ties.** `drainQueue` orders by `createdAt`
  (`Date.now()` ms), while `seq` is the true monotonic ordinal. Two saves in the same
  millisecond (plausible for rapid programmatic writes, e.g. config submit + an
  immediate flag toggle) get equal `createdAt`; Dexie's tie-break on a non-unique index
  is not a documented FIFO guarantee. Worth an explicit integration assertion (enqueue
  ops with equal `createdAt` and confirm `seq`-correct order), and a candidate for a
  Stryker mutant on the `orderBy` key. If it can't be guaranteed, that's a finding to
  surface, not paper over.
- **Reentrancy is real in the live app:** `SessionScreen`/`Part1Form` call `flushQueue()`
  directly after a save _and_ run `startAutoSync` triggers — concurrent drains are
  expected, so the guard matters and deserves a test.
- **The `delete` outbox branch is currently dormant:** `deleteInspection`
  (`src/lib/inspections.ts:54-61`) deletes inline (synchronous fetch), not via the
  outbox; nothing enqueues `op: "delete"`. The branch in `drainQueue` is reachable only
  if a future path enqueues a delete. Cover it for completeness if cheap, but it is not
  a live risk for #1.
- **SW is build-only** (lessons.md): the offline-reload leg of the e2e only works
  against `wrangler dev` on the built app — which `playwright.config.ts` already does.
- **Field casing single boundary** (lessons.md): app camelCase, DB snake_case, convert
  only in the sync endpoint — relevant when asserting the adopted server row's shape.

## Historical Context (from prior changes)

- `context/archive/2026-06-11-offline-first-persistence-layer/` — F-02, the origin of
  this whole layer. `plan.md` / `research.md` document the atomic-enqueue and outbox
  design decisions ("research Decision #1/#2" referenced in code comments). The
  `dexie-reference.md` there is the cited authority for the SSR gotcha and the `rw`
  transaction atomicity guarantee. The single-record e2e being replaced was F-02's
  capstone.
- `git ec0222c` (S-02 dashboard) deleted the `/offline-demo` page/island the e2e still
  points at — the direct cause of the dead spec.
- `context/archive/2026-06-22-testing-visibility-engine-hardening/` — Phase 1, the
  immediately prior rollout phase; precedent for the reconciliation/oracle test style
  and Stryker-narrowing discipline.
- `context/foundation/lessons.md` — three load-bearing entries: SW build-only (e2e must
  use `wrangler dev`), field-casing single boundary (shape of adopted row), and the
  upsert-fires-INSERT-triggers note (the 2-per-owner trigger fires on the sync upsert's
  UPDATE path — relevant if a multi-write test ever crosses the 2-inspection cap).

## Related Research

- `context/archive/2026-06-11-offline-first-persistence-layer/research.md` — original
  offline-first design exploration.
- `context/foundation/test-plan.md` §2 (risk #1 response guidance), §6.2/§6.3 (cookbook),
  §3 Phase 2 row.

## Open Questions

1. **FIFO under `createdAt` ties** — is `orderBy("createdAt")` a reliable FIFO drain when
   timestamps collide, or should the drain order by `seq`? Decide whether to assert the
   current behavior, or treat a tie failure as a code finding to fix in this change.
2. **E2E scope of "multiple writes"** — minimum viable is config-submit (op1) + two notes
   edits (op2/op3). Is driving the real Part 1 form + session textarea worth the e2e cost,
   or does the integration test carry the multi-op/FIFO/partial-failure proof while the
   e2e proves only the offline-reload-survives + reconnect-each-landed leg with 2 writes?
   (Test-plan says both layers; planning should set the exact division so they don't
   overlap wastefully.)
3. **`playwright.config.ts` cleanup** — adopt the unused `auth.setup.ts`/`storageState`
   pattern (faster, shared session) or keep inline sign-in and delete the dead projects?
   In or out of scope for this change?
4. **Partial-failure trigger** — to simulate "op #2 fails," mock `fetch` to return a 500
   on the second call. Confirm the desired behavior is _stop-and-resume in order_ (current
   `break`), and assert ops #2/#3 stay queued and drain on the next `flushQueue`.
5. **Confirm `npm run test:e2e` is currently red** (dead `/offline-demo`) before
   rebuilding, so the phase starts from a known baseline.
