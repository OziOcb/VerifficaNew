# Offline Durability at Flow Level — Implementation Plan

## Overview

Author the test-plan **Phase 2** coverage for **risk #1**: answers/notes written
offline mid-inspection must not vanish or fail to sync on reconnect, across **multiple
writes**. We prove — at the cheapest layer that gives real signal — that several offline
writes plus a note survive offline → reload → reconnect with **zero loss**, and that the
Change Queue drains **FIFO**. This challenges the assumption that F-02's single-record
round-trip already proves the whole flow.

The work is mostly test authoring, plus one small source fix: the drain currently orders
by `createdAt` (a millisecond timestamp that can tie), not by the monotonic `seq` — so
FIFO is incidental, not guaranteed. We make it guaranteed.

## Current State Analysis

From `context/changes/testing-offline-durability/research.md` (authoritative codebase
grounding):

- **The offline mechanism** (`src/lib/sync.ts`): `saveInspection` writes the optimistic
  row and enqueues an outbox op in **one atomic Dexie `rw` transaction**; N saves to the
  same inspection enqueue N ops, each carrying a full row snapshot. `drainQueue`
  (`sync.ts:159-192`) drains the queue, `break`-ing on the first network throw or
  `!res.ok` (preserving order for a later retry), adopting the server's authoritative
  camelCase row on success. `flushQueue` (`sync.ts:149-157`) wraps it with a module-level
  `flushing` reentrancy guard. `startAutoSync` (`sync.ts:216-249`) triggers drains on
  `online` / `visibilitychange` / mount / a 4 s retry timer.
- **FIFO is ordered by `createdAt`, not `seq`** (`sync.ts:160`:
  `orderBy("createdAt")`). `createdAt` is `Date.now()` (ms); two rapid programmatic saves
  can tie, and Dexie does not document a FIFO tie-break on a non-unique index. `seq`
  (`++seq`, `db.ts:39`) is the true monotonic ordinal.
- **No per-question answer store exists yet** (S-05 unbuilt — `SessionScreen.tsx:9-14`).
  The only offline-writable domain data today is **Part 1 config fields, the 5 equipment
  flags, and the 10,000-char global notes**, all via the same `saveInspection` → outbox
  path. "Several offline answers + a note" therefore maps to **multiple `saveInspection`
  writes (config) + a global-notes write** — we do not invent an answer store.
- **The actual drain has zero test coverage.** `tests/sync.test.ts` covers only the
  `saveInspection` read-merge (no network, no drain); `tests/db.test.ts` covers the schema
  - `seq` auto-increment. Nothing tests multi-op FIFO drain, partial-failure
    stop-and-resume, the reentrancy guard, server-row adoption, or the `delete` branch.
- **The existing offline e2e is dead.** `tests/e2e/offline-roundtrip.spec.ts` drives
  `/offline-demo`, a page **deleted in S-02** (commit `ec0222c`). It 404s at HEAD, so
  `npm run test:e2e` is red on that spec. It must be rebuilt against the real session flow.
- **`playwright.config.ts` is broken in two ways**: a `setup` project matches
  `/auth\.setup\.ts/` and a chromium project references `storageState:
"playwright/.auth/user.json"`, but **no `auth.setup.ts` exists**; and there are **two
  projects literally named `"chromium"`**. The real e2e oracle is the SSR re-read in
  `src/pages/inspections/[id]/session.astro:18-44` (RLS-scoped read → redirect on null).
- **Harness**: Vitest with `fake-indexeddb/auto` imported before `@/lib/db`; mock `fetch`
  at the network edge only (test-plan §6.2). Playwright runs the **built** app via
  `wrangler dev` on :4321 (SW is build-only — `lessons.md`); offline via
  `context.setOffline()`; helpers in `tests/helpers/supabase.ts` (`createConfirmedUser`,
  `deleteUser`, `signInAs`, `adminClient`).
- **Constraint — 2-per-owner cap**: `enforce_inspection_limit` rejects a 3rd inspection
  for an owner; the trigger also fires on the sync upsert's UPDATE path (excluded via
  `id <> new.id` — `lessons.md`). A shared e2e user must self-clean rows to avoid the cap.

## Desired End State

- `npm test` includes deterministic integration coverage that **fails** if the drain
  stops POSTing in FIFO order, double-POSTs under concurrent flush, skips an op on a
  mid-drain failure, fails to resume the remainder in order, or mis-adopts the server row.
- `src/lib/sync.ts` drains by `seq`, so FIFO holds even when `createdAt` ties; an
  integration test enqueues same-`createdAt` ops and asserts seq-correct order.
- `npm run test:e2e` is **green**: a rebuilt offline durability spec drives the real
  session flow, makes multiple offline writes, survives an offline SW-served reload,
  reconnects, and asserts **each** write landed via an SSR re-read — not a single final
  badge. The dead `/offline-demo` spec is gone.
- A narrowed Stryker run over `drainQueue` has been executed and its survivors reviewed;
  any survivor representing a user-visible durability bug has an added assertion.
- `playwright.config.ts` has a working `auth.setup.ts` + shared `storageState` and no
  duplicate/dead projects.

### Key Discoveries:

- Drain orders by `createdAt`, not `seq` (`src/lib/sync.ts:160`) — the FIFO gap.
- "Every op landed" ≠ "final 200": each op carries a full snapshot and the server
  upserts, so a green terminal badge can mask a skipped intermediate op (research
  Architecture Insights). Tests must assert **order and per-op POST**, not terminal state.
- `break`-on-failure semantics (`sync.ts:170-174`) are the intended stop-and-resume
  contract — the partial-failure test asserts this exact behavior.
- The SSR re-read at `session.astro:18-44` is the e2e's server-truth oracle.
- 2-per-owner cap (`enforce_inspection_limit`) forces e2e self-cleanup.

## What We're NOT Doing

- **Not** building or testing a per-question answer store (S-05 — unbuilt; deferred).
- **Not** adding server-side domain-input validation or testing it — that is **Phase 3 /
  risk #6** (the sync endpoint deliberately does no size/cross-field validation today).
- **Not** testing scoring/distribution (S-06) or Smart Pruning (S-07) — unbuilt, deferred.
- **Not** re-testing the `saveInspection` read-merge (already covered by `tests/sync.test.ts`).
- **Not** changing the outbox/sync architecture, the debounce, or the autosync triggers —
  only the drain's ordering key changes.
- **Not** wiring the deployed workerd smoke gate (that is Phase 4 / risk #5).

## Implementation Approach

Three phases, ordered cheapest-and-most-deterministic first:

1. **Source fix + integration layer** carries the proof. Switching the drain to `seq`
   makes FIFO guaranteed; then exhaustive integration tests (Vitest + fake-indexeddb,
   `fetch` mocked) deterministically prove multi-op FIFO, partial-failure stop-and-resume,
   reentrancy, server-row adoption, and the delete branch. Stryker over `drainQueue`
   verifies the assertions actually bite.
2. **E2e infrastructure** is rebuilt once, cleanly: a real `auth.setup.ts` produces a
   shared signed-in session via `storageState`, the broken/duplicate projects are removed,
   and `seed.spec.ts` is migrated onto the shared state.
3. **The offline e2e is rebuilt** on that infrastructure to prove the one thing
   integration can't: the real browser + service-worker offline-reload leg, with multiple
   writes each verified to have landed server-side via an SSR re-read.

## Critical Implementation Details

- **Timing & lifecycle (e2e):** the SW only exists in the **built** app served by
  `wrangler dev` (never `astro dev`) — `playwright.config.ts` already does this. The
  offline reload must first let the SW take control (`navigator.serviceWorker.ready` +
  a reload so the navigation is cached) before going offline, mirroring the old spec's
  steps 2–4.
- **State sequencing (integration):** to assert FIFO under ties, enqueue ops with an
  identical `createdAt` (inject via `saveInspection` is hard since it stamps `Date.now()`
  internally — enqueue directly via `db.changeQueue.add` with equal `createdAt` but
  natural ascending `seq`, then drain and assert POST order follows `seq`).
- **2-per-owner cap (e2e):** the shared user persists across specs; every spec must delete
  the inspections it creates (the delete confirm dialog, as in `seed.spec.ts`) so a later
  spec is never blocked by the cap. Global teardown deletes the user as a backstop.

---

## Phase 1: Drain FIFO fix + integration coverage

### Overview

Make FIFO guaranteed (order by `seq`) and add the integration tests that prove the whole
drain contract deterministically. This phase carries the bulk of risk #1's proof.

### Changes Required:

#### 1. Order the drain by the monotonic `seq`

**File**: `src/lib/sync.ts`

**Intent**: The drain must dequeue in true FIFO order even when two ops share a
`createdAt` millisecond. Switch the ordering key from the millisecond timestamp to the
auto-increment `seq` so order is guaranteed by construction, not by timestamp luck.

**Contract**: In `drainQueue`, change `db.changeQueue.orderBy("createdAt")`
(`sync.ts:160`) to `db.changeQueue.orderBy("seq")`. `seq` is already the table's primary
key (`++seq`, `db.ts:39`), so no schema change. Update the adjacent comment that calls
`createdAt` the FIFO key. Leave `createdAt` on the `ChangeOp` (still a useful ordering
hint / debugging field); do not remove the index.

#### 2. Integration tests for the drain contract

**File**: `tests/sync.drain.test.ts` (new — sibling of `tests/sync.test.ts`)

**Intent**: Exhaustively prove the drain at the cheapest layer: multi-op FIFO (incl. a
same-`createdAt` tie), partial-failure stop-and-resume, the reentrancy guard, server-row
adoption, and the delete branch. Mock `fetch` only (network edge); never mock `@/lib/db`
or internal `sync` functions.

**Contract**: New Vitest suite. `import "fake-indexeddb/auto"` before `@/lib/db`;
`beforeEach db.open()`, `afterEach` clear both tables and restore mocks. Cases:

- **Multi-op FIFO drain**: `saveInspection` three times (distinct field sets), `flushQueue`
  with `fetch` mocked to echo a server row; assert `fetch` was called **3 times in payload
  order**, the `changeQueue` is empty, and all `inspections` rows are `synced: 1`. Assert
  on the **sequence of POST bodies** (entityId/field order), not just call count.
- **FIFO under `createdAt` tie**: enqueue ops directly via `db.changeQueue.add` with an
  identical `createdAt` and ascending natural `seq`; drain; assert POST order follows
  `seq`. (This is the test that would have failed before the Phase 1 source fix.)
- **Partial-failure stop-and-resume**: mock `fetch` to succeed on call 1 and return a 500
  on call 2; `flushQueue`; assert op 1 reconciled (`synced: 1`, dequeued) while ops 2 & 3
  **remain queued in order** and op 3 was **never POSTed**. Then flip the mock to success
  and `flushQueue` again; assert 2 & 3 drain in order and the queue empties.
- **Network-throw stop-and-resume**: same shape but `fetch` rejects (offline) on call 2;
  assert identical stop-and-resume.
- **Reentrancy guard**: start two `flushQueue()` calls concurrently against a slow `fetch`
  mock; assert each op is POSTed **exactly once** (no double-send) and the queue empties.
- **Server-row adoption**: mock `fetch` to return a row with a server-stamped `ownerId` /
  `updatedAt` differing from the optimistic values; assert the stored row adopts the
  server values and flips `synced: 1`.
- **Delete branch**: enqueue an `op: "delete"` directly; mock `fetch` → 204; drain; assert
  the local row **and** the queue entry are dropped.

### Success Criteria:

#### Automated Verification:

- Type checking + lint pass: `npm run lint`
- Unit/integration suite passes: `npm test`
- The new drain suite fails if the source fix is reverted (FIFO-tie case goes red) —
  verify by temporarily reverting `orderBy("seq")` locally.

#### Manual Verification:

- Narrowed Stryker run executed over the drain logic:
  `npx stryker run --mutate "src/lib/sync.ts:159-192"`; survivors reviewed one-by-one per
  `CLAUDE.md`; an assertion added only where a survivor represents a real durability bug
  (do not chase 100%). Record which survivors were accepted and why.

**Implementation Note**: After automated verification passes and the Stryker review is
done, pause for confirmation before Phase 2.

---

## Phase 2: E2e shared-auth infrastructure

### Overview

Give the e2e suite a working, shared authenticated session and remove the broken/duplicate
Playwright projects, so Phase 3's rebuild stands on solid infra.

### Changes Required:

#### 1. Auth setup project

**File**: `tests/e2e/auth.setup.ts` (new)

**Intent**: Produce one shared signed-in session for the chromium project: create a fresh
confirmed user, sign in through the real UI (sets the `@supabase/ssr` cookie), and persist
`storageState` so specs start authenticated instead of re-signing-in.

**Contract**: A Playwright `setup` test (matched by the existing `/auth\.setup\.ts/`
`testMatch`). Uses `createConfirmedUser` from `tests/helpers/supabase.ts`; signs in via the
same UI steps as `seed.spec.ts` (email + exact-match Password + Sign in → wait for `/`);
`page.context().storageState({ path: "playwright/.auth/user.json" })`. Persist the created
user's email/id for teardown (e.g. write a small JSON sidecar under `playwright/.auth/`, or
derive a deterministic-but-unique email the teardown can reconstruct).

#### 2. Global teardown deletes the shared user

**File**: `playwright.config.ts` (+ a teardown spec, e.g. `tests/e2e/auth.teardown.ts`)

**Intent**: Delete the shared user after the run (cascade clears any leftover rows) so no
test residue persists between runs.

**Contract**: Wire a teardown via the setup project's `teardown` option (Playwright project
dependency teardown) that reads the persisted user id and calls `deleteUser`. Keep
`adminClient`/service-role usage confined to `tests/helpers/supabase.ts`.

#### 3. Fix the Playwright project config

**File**: `playwright.config.ts`

**Intent**: Remove the duplicate `"chromium"` project and make the real chromium project
depend on `setup` and consume the shared `storageState`.

**Contract**: One `setup` project (`testMatch: /auth\.setup\.ts/`, with `teardown`
pointing at the teardown project) and one `chromium` project (`use: { ...devices["Desktop
Chrome"], storageState: "playwright/.auth/user.json" }`, `dependencies: ["setup"]`). Delete
the second, bare `"chromium"` entry. Ensure `playwright/.auth/` is git-ignored.

#### 4. Migrate `seed.spec.ts` onto shared auth

**File**: `tests/e2e/seed.spec.ts`

**Intent**: Stop the per-spec inline sign-in now that the session is shared; keep the
spec's own row cleanup so it never leaves the shared user near the 2-cap.

**Contract**: Remove the `beforeAll createConfirmedUser` + inline sign-in + `afterAll
deleteUser`; rely on `storageState` (the spec starts authenticated). Keep the
create → reload → delete flow and ensure the created row is deleted at the end.

### Success Criteria:

#### Automated Verification:

- Lint/type pass: `npm run lint`
- `npm run test:e2e` runs the `setup` project, then `seed.spec.ts` passes using shared
  auth, then teardown deletes the user (no orphaned user remains — verify via
  `adminClient` listing or a second run starting clean).

#### Manual Verification:

- After a full `npm run test:e2e`, confirm `playwright/.auth/user.json` is produced and
  git-ignored, and that no test user/inspection rows are left in local Supabase.
- Re-running `npm run test:e2e` twice in a row stays green (no cap/residue flake).

**Implementation Note**: Pause for confirmation before Phase 3.

---

## Phase 3: Rebuilt offline durability e2e

### Overview

Replace the dead single-record spec with a multi-write offline durability spec on the real
session flow — proving the browser + service-worker offline-reload leg and that **each**
write landed server-side.

### Changes Required:

#### 1. Remove the dead spec

**File**: `tests/e2e/offline-roundtrip.spec.ts` (delete)

**Intent**: It targets the deleted `/offline-demo` route and can never pass. The rebuilt
spec supersedes it.

**Contract**: Delete the file.

#### 2. Offline durability spec (multi-write)

**File**: `tests/e2e/offline-durability.spec.ts` (new)

**Intent**: Prove risk #1 end-to-end at the real flow: several offline writes plus a note
survive an offline SW-served reload and a reconnect, with **zero loss**, each verified to
have landed on the server. Mirrors the old spec's SW-control + offline-reload mechanics but
on `/inspections/{id}/session` with multiple distinct writes.

**Contract**: A Playwright spec using shared auth (no inline sign-in). Flow:

1. Create a draft inspection (via `/dashboard` "Start new inspection", as in
   `seed.spec.ts`), landing on `/inspections/{id}/session`.
2. Let the SW take control: navigate the session route, `navigator.serviceWorker.ready`,
   reload, poll `navigator.serviceWorker.controller` truthy (mirrors the old spec).
3. **Go offline** (`context.setOffline(true)`), then make **multiple writes** that enqueue
   distinct ops: open Part 1, fill a few config fields + submit (op 1: config); back on the
   session screen, type **global notes** (op 2; let the 600 ms debounce settle); edit the
   notes again (op 3) — giving ≥3 queued ops. Assert the on-screen save/sync status reflects
   "pending/unsynced" while offline.
4. **Reload while offline**: assert the session shell is served from the SW cache (heading
   visible, not the browser offline page) and the locally-saved values **survive** (notes
   text + config reflected via the island's `useLiveQuery` rehydration).
5. **Reconnect** (`context.setOffline(false)`): the autosync drains the outbox.
6. **Per-write server-truth assertion (the anti-pattern guard)**: reload the page so the
   SSR re-read (`session.astro`) renders from the DB, and assert **each** write is present —
   the global notes value **and** the Part 1 config (e.g. the make/model and the per-Part
   counts that the config drives). This proves every op landed, not just a terminal badge.
7. **Cleanup**: delete the inspection (delete confirm dialog, as in `seed.spec.ts`) so the
   shared user stays under the 2-cap.

### Success Criteria:

#### Automated Verification:

- Lint/type pass: `npm run lint`
- `npm run test:e2e` is green end-to-end (setup → seed → offline-durability → teardown).
- The spec fails if offline writes are lost: verify by a local sanity check (e.g.
  temporarily skip the reconnect/drain and confirm the per-write SSR assertions go red).

#### Manual Verification:

- Observe (headed run, `--headed`) that the offline reload serves the app shell from the SW
  (not Chrome's offline error page) and the notes/config persist visually.
- Confirm no orphaned inspection rows remain for the shared user after the run.
- Update `context/foundation/test-plan.md` §6.3 cookbook "Multi-write offline pattern TBD"
  and the §3 Phase 2 status, and add a §6.6 per-phase note capturing anything surprising.

**Implementation Note**: Final phase — after automated + manual verification, the test-plan
Phase 2 gate ("e2e offline round-trip required after Phase 2") is satisfied.

---

## Testing Strategy

### Unit / Integration Tests (Phase 1):

- Multi-op FIFO drain with assertion on **POST order** (not just count).
- FIFO under `createdAt` tie (regression guard for the `seq` fix).
- Partial-failure (500) and network-throw stop-and-resume, with order preserved and the
  un-reached op never POSTed; resume drains the remainder in order.
- Reentrancy guard: concurrent `flushQueue` → each op POSTed exactly once.
- Server-row adoption: stored row adopts server `ownerId`/`updatedAt`, flips `synced: 1`.
- Delete branch: 204 → row + queue entry dropped.

### E2E Tests (Phase 3):

- Multi-write offline → offline SW reload (survives) → reconnect → **per-write** SSR
  re-read confirms each op landed. Self-cleans rows.

### Mutation (Phase 1):

- `npx stryker run --mutate "src/lib/sync.ts:159-192"`; review survivors one-by-one;
  add assertions only for user-visible/business-relevant survivors; do not chase 100%.

### Manual Testing Steps:

1. Revert `orderBy("seq")` locally → the FIFO-tie integration case must go red.
2. `npm run test:e2e --headed` → watch the offline reload serve the SW shell and the
   notes/config persist.
3. Run `npm run test:e2e` twice consecutively → stays green (no residue/cap flake).
4. After runs, confirm local Supabase has no leftover test users/inspections.

## Performance Considerations

Integration tests are in-memory (fake-indexeddb) and fast. The e2e adds one spec; shared
`storageState` removes per-spec re-sign-in, partially offsetting the cost. Keep the e2e to
2–3 writes — enough to prove multi-op without slowing the suite.

## Migration Notes

- `playwright/.auth/` (storageState + any user sidecar) must be git-ignored.
- The shared e2e user is created and deleted within a run; specs self-clean rows to respect
  the 2-per-owner cap (`enforce_inspection_limit`).

## References

- Research: `context/changes/testing-offline-durability/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (risk #1), §3 Phase 2, §6.2/§6.3
- Drain/order: `src/lib/sync.ts:159-192` (`orderBy("createdAt")` → `seq`)
- Reentrancy guard: `src/lib/sync.ts:139,149-157`
- E2e oracle (SSR re-read): `src/pages/inspections/[id]/session.astro:18-44`
- Reference specs: `tests/e2e/seed.spec.ts` (sign-in + SSR-read + delete), old
  `tests/e2e/offline-roundtrip.spec.ts` (SW-control + offline-reload mechanics)
- Lessons: SW build-only; field-casing single boundary; upsert fires INSERT triggers
  (`context/foundation/lessons.md`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Drain FIFO fix + integration coverage

#### Automated

- [x] 1.1 Type checking + lint pass (`npm run lint`) — f1b57d3
- [x] 1.2 Unit/integration suite passes (`npm test`) — f1b57d3
- [x] 1.3 New drain suite fails when `orderBy("seq")` is reverted (FIFO-tie case red) — f1b57d3

#### Manual

- [x] 1.4 Narrowed Stryker run over `src/lib/sync.ts:159-192`; survivors reviewed one-by-one; assertions added only for real durability bugs; accepted survivors recorded — f1b57d3

### Phase 2: E2e shared-auth infrastructure

#### Automated

- [x] 2.1 Lint/type pass (`npm run lint`) — a02e0fe
- [x] 2.2 `npm run test:e2e` runs setup → `seed.spec.ts` (shared auth) → teardown; no orphaned user remains — a02e0fe

#### Manual

- [x] 2.3 `playwright/.auth/user.json` produced and git-ignored; no leftover users/rows in local Supabase — a02e0fe
- [x] 2.4 `npm run test:e2e` run twice consecutively stays green (no cap/residue flake) — a02e0fe

### Phase 3: Rebuilt offline durability e2e

#### Automated

- [x] 3.1 Lint/type pass (`npm run lint`) — d24c47f
- [x] 3.2 `npm run test:e2e` green end-to-end (setup → seed → offline-durability → teardown) — d24c47f
- [x] 3.3 Spec fails when reconnect/drain is skipped (per-write SSR assertions go red) — d24c47f

#### Manual

- [x] 3.4 Headed run: offline reload serves the SW shell (not Chrome's offline page); notes/config persist visually — d24c47f
- [x] 3.5 No orphaned inspection rows remain for the shared user after the run — d24c47f
- [x] 3.6 `context/foundation/test-plan.md` updated: §6.3 multi-write pattern, §3 Phase 2 status, §6.6 per-phase note — d24c47f
