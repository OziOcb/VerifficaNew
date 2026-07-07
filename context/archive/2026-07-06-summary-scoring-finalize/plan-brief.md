# Summary Distribution, Inline Edit & Finalize (S-06) — Plan Brief

> Full plan: `context/changes/summary-scoring-finalize/plan.md`

## What & Why

Build the Summary page — the north-star culmination of the personalize → answer → aggregate
loop. The user reaches a Summary showing the `Yes`/`No`/`Don't know` distribution per Part and
globally (equal weighting, **no single quality score**), edits answers inline, and explicitly
finalizes the inspection to `Completed` as a closed read-only report. Reaching a finalized
Summary proves the whole product hypothesis works end-to-end (FR-019, FR-020, FR-021, US-01).

## Starting Point

The scoring primitive (`distribution()`), the personalization engine, and the optimistic offline
write path (`saveInspection`) already exist and are tested. Today `SessionScreen` renders a
hardcoded `0%` Total Score stub, `[id].astro` redirects both Draft and Completed to `/session`,
and no Summary/report surface exists. The `status` column (`draft`/`completed`) is already in the
schema — finalize/reopen are pure status writes, no migration.

## Desired End State

From the session hub the user opens **View Summary** any time: a global distribution bar on top,
a per-Part bar for each of Parts 2–5, and an editable global-notes textarea. Tapping a Part's bar
opens a section-grouped, collapsible, read-only question/answer modal; an **Edit** button reveals
per-question three-way toggles that save instantly and move the charts live. **Finalize** sets
`Completed`; the page renders read-only (notes locked, no Edit button), and the dashboard opens
that inspection directly as this report. **Reopen for editing**, behind a confirm dialog, reverts
to `Draft` and requires re-finalization.

## Key Decisions Made

| Decision                 | Choice                                                          | Why (1 sentence)                                                              | Source |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------ |
| "Total Score" display    | Three-way distribution, no headline %                           | Honors FR-019's "no single quality score" + liability-bounding intent.        | Plan   |
| Chart rendering          | Hand-rolled CSS/SVG stacked bars (shared `DistributionBar`)     | Zero new deps, offline-friendly, theme-aware, matches minimal styling.        | Plan   |
| Inline-edit affordance   | Per-Part modal via chart click; Edit toggles, instant save      | Chart-first Summary; reuses the card answer control + optimistic path.        | Plan   |
| Read-only report routing | Summary page doubles as report; `[id].astro` dispatch           | Single source of truth; dashboard "Resume" on Completed lands on it free.     | Plan   |
| Reach & finalize gating  | Summary always reachable; finalize allowed anytime              | Matches "Summary reach rate" metric; "Don't know" means no one is stuck.      | Plan   |
| Global notes on Summary  | Editable textarea (same live Dexie row as the hub)              | One source of truth via `useLiveQuery` + read-merge; locks when Completed.    | Plan   |
| Reopen flow              | No inline Edit while Completed; Reopen button → confirm → Draft | Exactly FR-021's deliberate, confirmed, re-finalization-required bar.         | Plan   |
| Testing                  | Unit (aggregation edges) + one e2e finalize/reopen round-trip   | Proves the new state machine + north-star path without re-testing primitives. | Plan   |

## Scope

**In scope:** live Total Score on the session hub; Summary route + per-Part & global charts;
editable global notes; read-only per-Part modals + inline answer editing; finalize/reopen state
machine; read-only report routing; unit + one e2e test.

**Out of scope:** Smart Pruning on config change (S-07); offline-survival hardening (S-08);
weighting / quality score / verdict / deal-breakers (PRD Non-Goals); any DB migration; PDF/export.

## Architecture / Approach

Bottom-up, four independently verifiable phases. A single catalogue-free `DistributionBar`
component serves the session-hub Total Score, the Summary global chart, and each per-Part chart.
The Summary `.astro` route runs the engine server-side (catalogue never ships) and passes per-Part
ordered question metadata + count/ID payloads + raw answers to a `client:only` `SummaryScreen`
island. All aggregation stays in pure `@/lib/answers` / `@/lib/session-counts` helpers; all writes
(answers, notes, status) ride the existing optimistic `saveInspection` → outbox path. Read-only
mode derives live from `status` on the Dexie row.

## Phases at a Glance

| Phase                              | What it delivers                                               | Key risk                                                  |
| ---------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| 1. Live Total Score on session hub | Real distribution replaces `0%` stub; shared `DistributionBar` | Getting the "no headline %" presentation right per FR-019 |
| 2. Summary route + charts + modals | `/summary` page, charts, editable notes, read-only modals      | Catalogue-server discipline; ts2589 on the answers jsonb  |
| 3. Inline answer editing           | Edit mode + instant-save toggles; live chart updates           | Live-row recompute correctness; edit-mode reset on close  |
| 4. Finalize + reopen state machine | Finalize → read-only report → confirmed reopen; e2e            | Status-driven read-only enforcement across every control  |

**Prerequisites:** S-05 (question-card-answering) implemented — present. Local Supabase for the
e2e leg.
**Estimated effort:** ~3–4 sessions across 4 phases (reuse-heavy; most logic already exists).

## Open Risks & Assumptions

- Assumes orphaned answers (pre-S-07) are handled by intersecting with the visible set — the
  Summary excludes them from counts but does not prune them (that's S-07).
- The e2e leg runs the build + `wrangler dev` SW path (slower CI); acceptable for the north star.
- Read-only enforcement must gate **every** editable control off one live-`status` flag — a missed
  control would let a Completed report be edited without reopening.

## Success Criteria (Summary)

- The user reaches a Summary showing per-Part + global Yes/No/Don't-know distributions with no
  single quality score, and can finalize to a read-only report.
- Inline answer edits and global-notes edits persist optimistically (offline-safe) and update the
  charts within the <200 ms perceived-update budget.
- Finalize → read-only → confirmed reopen → re-finalize works end-to-end (proven by the e2e).
