# Sync-endpoint Server-Trust — Plan Brief

> Full plan: `context/changes/testing-sync-endpoint-server-trust/plan.md`
> Research: `context/changes/testing-sync-endpoint-server-trust/research.md`

## What & Why

Test Plan Phase 3 (Risk #6): the sync endpoint trusts the client. `POST /api/inspections/sync` upserts the payload verbatim — no domain validation — so a caller bypassing the browser validators (curl/devtools) can persist an oversized notes document or a cross-field-invalid config (Electric + Manual). We add a targeted, app-side validation guard at the sync boundary and prove it with integration tests, so the server enforces the rules the client already does.

## Starting Point

The endpoint distrusts the client for _identity_ (it stamps `owner_id` from the session) but never for _content_. The DB catches bad enums/types (→400) but not text length, cross-field rules, or numeric ranges. The two Risk #6 cases return **200 and persist** today. The validators already exist client-side and are server-safe to reuse (`part1-config.ts`).

## Desired End State

A direct, validator-bypassing POST is rejected with **400** (and writes no row) when it carries an oversized `globalNotes`, an oversized Part-1 `notes`, or an Electric + non-Automatic config — using the same messages the client shows. Legitimate partial/draft writes still succeed (200). Behavior is locked by integration tests, and each rule has a single client+server definition.

## Key Decisions Made

| Decision             | Choice                                                           | Why (1 sentence)                                                                                         | Source   |
| -------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| Scope                | Test **+ remediate**                                             | change.md says "prove the server rejects" — which requires the server to actually reject                 | Plan     |
| Validation location  | App-side Zod/guard at the endpoint (camelCase, before snakecase) | Reuses the oracle, honors lessons.md "Field casing", workerd-friendly                                    | Plan     |
| Partial payloads     | Targeted guard on **present fields only**                        | The sync path legitimately receives drafts/partial writes; full-schema validation would reject them      | Plan     |
| Rule reuse           | Export shared predicates/constants from `part1-config.ts`        | One source per rule; avoids client/server drift                                                          | Plan     |
| Reject contract      | **400** + verbatim client messages                               | Matches the endpoint's existing 400 convention                                                           | Plan     |
| Case coverage        | 2 named cases + oversized Part-1 notes                           | Tightly scoped to Risk #6; numeric ranges deferred                                                       | Plan     |
| FR-018 500-char note | Out of scope (permanent)                                         | It's appended into `global_notes`, so it's covered by the globalNotes cap, never a separate server field | Research |

## Scope

**In scope:** shared rule extraction; an app-side sync guard (globalNotes ≤ 10k, Part-1 notes ≤ 1k, CF-1 when both fields present); integration tests proving rejection + partial-write pass-through.

**Out of scope:** DB constraints/migration; full Part-1 server validation; numeric-range guards; 422/new status code; FR-018 per-question note; the create endpoint.

## Architecture / Approach

Lift the length caps, the CF-1 predicate, and the messages out of `part1-config.ts` (and the `SessionScreen` island) into shared, server-importable exports (no behavior change). A small `validateSyncPayload(row)` runs in the endpoint's `put` branch on the camelCase row — after stripping `synced`, before `snakecaseKeys` — and returns 400 with the shared message on a present-field violation. Tests drive the real handler through the existing mock-`@/lib/supabase` RLS harness.

## Phases at a Glance

| Phase                        | What it delivers                                                                                           | Key risk                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Extract shared primitives | Caps + CF-1 predicate + messages as single-source exports; island consumes them                            | Drift / behavior change in the heavily-tested validator module |
| 2. Guard + tests             | Endpoint rejects the named cases (400 + message, no persist); tests lock it incl. partial-write regression | Over-rejecting legitimate partial/draft writes                 |

**Prerequisites:** none — all validators and the test harness already exist (S-03, S-04 done).
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- The guard must not over-reject partial/draft payloads — covered explicitly by a partial-write regression test and the present-field semantics.
- Assertions target the two cases the DB does _not_ enforce, so a 4xx proves the server guard (not a DB error) — avoids the research's "400 ambiguity."
- Validation protects only the sync path, which is the sole client-write path today (the create endpoint takes no payload).

## Success Criteria (Summary)

- A validator-bypassing oversized or Electric+Manual write is rejected (400) and persists nothing; normal and partial writes still succeed.
- `npm test` passes with the new sync cases; manual curl against `npm run dev` confirms the 400.
- Each length/cross-field rule has one definition shared by client and server.
