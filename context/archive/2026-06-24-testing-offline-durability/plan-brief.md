# Offline Durability at Flow Level — Plan Brief

> Full plan: `context/changes/testing-offline-durability/plan.md`
> Research: `context/changes/testing-offline-durability/research.md`

## What & Why

Test-plan **Phase 2 / risk #1**: answers and notes written offline mid-inspection must
not vanish or fail to sync on reconnect, across **multiple writes**. We prove — at the
cheapest layer with real signal — that several offline writes plus a note survive
offline → reload → reconnect with **zero loss** and that the Change Queue drains **FIFO**.
This directly challenges the assumption that F-02's single-record round-trip already
proves the whole flow.

## Starting Point

The offline outbox (`src/lib/sync.ts`) works: `saveInspection` atomically writes the row
and enqueues an op; `drainQueue` drains on reconnect. But the actual drain has **zero test
coverage**, the drain orders by `createdAt` (a millisecond that can tie) rather than the
monotonic `seq`, and the only offline e2e (`offline-roundtrip.spec.ts`) is **dead** — it
drives `/offline-demo`, a page deleted in S-02.

## Desired End State

`npm test` deterministically fails if the drain breaks FIFO order, double-POSTs, skips an
op on a mid-drain failure, or mis-adopts the server row. The drain orders by `seq`, so FIFO
is guaranteed. `npm run test:e2e` is green: a rebuilt spec drives the real session flow,
makes multiple offline writes, survives an offline service-worker-served reload, reconnects,
and confirms **each** write landed via an SSR re-read — not a single final badge.

## Key Decisions Made

| Decision                          | Choice                                                           | Why (1 sentence)                                                         | Source   |
| --------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ | -------- |
| "Several offline answers" mapping | Multiple config writes + a global note                           | No per-question answer store exists yet (S-05 unbuilt); don't invent one | Research |
| FIFO ordering gap                 | Fix `drainQueue` to order by `seq`                               | `createdAt` ties on same-ms writes leave FIFO incidental, not guaranteed | Plan     |
| Integration vs e2e split          | Integration carries the proof; e2e proves the offline-reload leg | Deterministic FIFO/partial-failure proof is cheap and stable in Vitest   | Plan     |
| Dormant delete branch             | Cover cheaply in integration                                     | ~5 lines guards a real branch against future regressions                 | Plan     |
| Playwright auth                   | Adopt `auth.setup.ts` + shared `storageState`                    | Fixes a broken config and speeds the suite                               | Plan     |
| Shared e2e user vs 2-cap          | Setup creates user; each spec self-cleans rows                   | The 2-per-owner cap would otherwise block later specs                    | Plan     |
| Mutation testing                  | Narrowed Stryker over `drainQueue`, review survivors             | Risk-critical module; catches weak (count-not-order) assertions          | Plan     |

## Scope

**In scope:** integration tests for the full drain contract; a one-line `src/lib/sync.ts`
FIFO fix; rebuilt offline e2e on the real session flow; Playwright shared-auth infra +
config cleanup; narrowed Stryker run.

**Out of scope:** per-question answer store (S-05); server-side input validation (Phase 3 /
risk #6); scoring (S-06) / Smart Pruning (S-07); deployed smoke gate (Phase 4 / risk #5);
re-testing the `saveInspection` read-merge.

## Architecture / Approach

Three phases, cheapest-and-most-deterministic first. **Phase 1** fixes the drain ordering
and proves the whole drain contract in-memory (Vitest + fake-indexeddb, `fetch` mocked):
multi-op FIFO incl. a same-ms tie, partial-failure stop-and-resume, reentrancy, server-row
adoption, delete branch — then Stryker checks the assertions bite. **Phase 2** builds clean
e2e auth infra (`auth.setup.ts` → shared `storageState`, remove broken/duplicate projects,
migrate `seed.spec.ts`). **Phase 3** rebuilds the offline spec on that infra, proving the
one thing integration can't: the real browser + service-worker offline-reload leg, with each
write verified server-side via the SSR re-read (`session.astro`).

## Phases at a Glance

| Phase                           | What it delivers                                                     | Key risk                                                            |
| ------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1. Drain FIFO fix + integration | `seq`-ordered drain + full drain-contract tests + Stryker review     | Same-ms tie test must be a true regression guard for the fix        |
| 2. E2e shared-auth infra        | `auth.setup.ts` + `storageState`, clean config, migrated `seed.spec` | Shared user vs 2-per-owner cap → disciplined row cleanup            |
| 3. Rebuilt offline e2e          | Multi-write offline durability spec; dead spec removed               | SW-control/offline-reload timing flakiness; per-write SSR assertion |

**Prerequisites:** local Supabase running (`npx supabase start`); the e2e builds + serves
via `wrangler dev` (SW is build-only).
**Estimated effort:** ~2–3 sessions across the three phases.

## Open Risks & Assumptions

- Adopting shared `storageState` interacts with the 2-per-owner cap — every spec must
  delete its rows; global teardown deletes the user as a backstop.
- The offline-reload leg depends on SW timing in `wrangler dev`; mirror the old spec's
  proven SW-control sequence to limit flakiness.
- The `seq` fix is behavior-preserving in normal operation (seq and createdAt already rise
  together); the only change is guaranteed order under ties.

## Success Criteria (Summary)

- `npm test` fails on any FIFO / partial-failure / double-send / adoption regression.
- `npm run test:e2e` proves multiple offline writes survive an offline SW reload and each
  lands server-side on reconnect — green twice in a row with no residue.
- Stryker survivors over `drainQueue` reviewed; the test-plan Phase 2 e2e gate is satisfied.
