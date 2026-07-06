# Summary Distribution, Inline Edit & Finalize (S-06) Implementation Plan

## Overview

Build the Summary page — the north-star culmination of the personalize → answer → aggregate
loop (roadmap S-06; FR-019, FR-020, FR-021, US-01). The user reaches a Summary that shows the
`Yes`/`No`/`Don't know` distribution per Part and globally (equal weighting, **no single
quality score**), edits answers inline via per-Part modals, and explicitly finalizes the
inspection to `Completed` — after which the same page renders as a closed read-only report,
reopenable only through a deliberate, confirmed action that reverts it to `Draft`.

The slice is reuse-heavy: the scoring primitive (`distribution()`), the personalization engine,
and the optimistic offline write path (`saveInspection`) already exist and are tested. The new
work is a presentational chart component, a Summary route + island, an inline-edit modal, and a
finalize/reopen state machine.

## Current State Analysis

- **Scoring exists, untested at the Summary layer.** `distribution(ids, answers)`
  (`src/lib/answers.ts:46`) returns `{ yes, no, dontKnow }` with equal weighting (FR-019), pure
  and server-safe. `session-counts.ts` provides `totalCount`, `countsForFlags`,
  `questionIdsForFlags` (personalized denominators), and `questions.ts` provides
  `sessionQuestionIds`, `selectCardDeck`, `visibleQuestionIdsByPart`, `selectVisibleQuestions`
  (ordered per-Part questions **with display text**: `section`, `subsection`, `label`).
- **Status model already in the schema.** `inspections.status` is
  `text not null default 'draft' check (status in ('draft','completed'))`
  (`supabase/migrations/20260610181920_create_inspections.sql:32`). Finalize/reopen are pure
  status writes — **no migration needed**. `SaveInput` already accepts `status`
  (`src/lib/sync.ts:93`).
- **Total Score is a hardcoded stub.** `SessionScreen.tsx:191` renders `0%` and a static
  all-zero legend — the S-04 placeholder. FR-010's "current Total Score" is unwired.
- **No Summary/report surface.** `src/pages/inspections/[id].astro:8` redirects **both** Draft
  and Completed to `/session`. No read-only report exists.
- **The answer write path is proven.** `QuestionCards.tsx:158` writes answers via
  `saveInspection({ id, answers })` → optimistic Dexie put + outbox enqueue → `flushQueue`.
  Inline edit reuses this verbatim; finalize/reopen reuse it with `{ id, status }`.
- **The catalogue-stays-server discipline.** Every island (`SessionScreen`, `QuestionCards`,
  `Part1Form`) is `client:only="react"` and never imports the 80 KB catalogue; the `.astro`
  route runs the engine server-side and passes only the derived payload. The Summary must
  follow this exactly.
- **Field-casing discipline.** The `answers` jsonb keys are opaque `q_…` catalogue IDs kept
  verbatim; the snake→camel boundary excludes them via `stopPaths: ["answers"]`
  (`session/part/[part].astro:57`). The Summary route reads answers off the RAW snake_case row.

### Key Discoveries:

- The global chart, per-Part charts, and the session-hub Total Score are the **same** shape —
  a three-way distribution — so a single `DistributionBar` presentational component serves all
  three (`src/lib/answers.ts:46` feeds it).
- Session hub and Summary both read/write the **same live Dexie row** via `useLiveQuery` +
  `saveInspection` read-merge, so an editable global-notes textarea on the Summary is one
  source of truth with the hub's textarea — not a second copy to reconcile.
- `selectCardDeck(config, flags, part)` (`questions.ts:317`) already returns ordered cards with
  `{ id, label, section, subsection }` — exactly the per-Part question list the inline-edit
  modal needs. Calling it for parts 2–5 server-side gives the whole Summary its question text.
- Orphaned-answer safety already solved: intersect answers with the live visible ID set
  (`answeredCount`, `SessionScreen.tsx:152`) so a pre-S-07 orphaned answer never inflates the
  distribution.

## Desired End State

From the session hub a user opens **View Summary** at any time and sees: a global
`Yes`/`No`/`Don't know` distribution bar on top, a per-Part bar for each of Parts 2–5, and an
editable global-notes textarea. Tapping a Part's bar opens a modal listing that Part's
questions grouped by section (collapsible), read-only by default; an **Edit** button reveals
per-question three-way toggles that save instantly and move the charts live. A **Finalize**
button sets the inspection to `Completed`; the page then renders read-only (notes locked, no
Edit button, charts static), and the dashboard opens that inspection directly as this read-only
report. A **Reopen for editing** button, behind a confirm dialog, reverts it to `Draft` and
requires re-finalization.

Verify: unit tests for the aggregation glue pass; one Playwright e2e drives
answer → Summary → finalize → read-only → reopen → re-finalize; the session hub shows a live
distribution with **no headline quality %**; `npm run lint` and `npm run build` pass.

## What We're NOT Doing

- **No Smart Pruning on config change** — that is S-07 (FR-016). The Summary intersects answers
  with the current visible set so orphaned answers don't inflate counts, but it does **not**
  delete them or warn on config change.
- **No offline-survival hardening beyond the existing path** — that is S-08. Finalize/reopen and
  inline edits ride the already-proven `saveInspection` outbox; no new sync work.
- **No weighting, no single quality score, no buy/don't-buy verdict, no deal-breakers** — PRD
  Non-Goals / Business Logic. Equal weighting only; the "Total Score" is a distribution.
- **No new DB migration** — `status` already exists; answers already persist.
- **No PDF/export/share of the report** — PRD Non-Goals.
- **No edit of global notes from within the per-Part answer modal** — notes are edited in the
  Summary's own textarea (or the session hub); the modal is answers-only.

## Implementation Approach

Build bottom-up so each phase is independently verifiable. Phase 1 wires the real distribution
into the existing session hub and extracts the shared `DistributionBar`, delivering the FR-019
"no quality score" fix and de-risking the chart component before it has three consumers. Phase 2
stands up the Summary route + island (charts + read-only modals + editable notes) reusing that
component and the server-side engine pattern. Phase 3 adds inline answer editing inside the
modal on the proven optimistic write path. Phase 4 layers the finalize/reopen state machine and
read-only enforcement on top, and proves the whole loop with one e2e.

All scoring/aggregation stays in pure, server-safe helpers (`@/lib/answers`,
`@/lib/session-counts`) so it unit-tests directly and the catalogue never reaches the browser.

## Critical Implementation Details

- **Catalogue-server discipline (load-bearing):** the Summary `.astro` route runs
  `@/lib/questions` server-side and passes only the per-Part ordered question metadata
  (`{ id, label, section, subsection }`), the count/ID payloads, and the raw answers map to the
  `client:only` island. The island must never import `@/lib/questions`' catalogue functions —
  only its erased-at-build types and the catalogue-free `@/lib/session-counts` /`@/lib/answers`
  helpers (mirrors `SessionScreen`).
- **Answers are read off the RAW snake_case row**, not the camelized projection: forcing the
  deep camel transform over the `answers` jsonb `Json` type triggers ts2589
  (`session.astro:59-62`). Reuse that exact pattern.
- **Read-only mode is derived from `status`, live.** The island must read `status` from the
  live Dexie row (falling back to the SSR prop) so an optimistic finalize/reopen flips the mode
  without a server round-trip and survives an offline reload — the `SessionScreen` live-row
  pattern (`SessionScreen.tsx:100`, `137`).
- **`[id].astro` dispatch order:** it must dispatch by status _before_ the current unconditional
  redirect to `/session`. A Completed row → `/inspections/[id]/summary`; Draft → `/session`.
  RLS/not-found (`!row`) still falls through to `/dashboard`.

## Phase 1: Live Total Score on the session hub

### Overview

Replace the hardcoded `0%` Total Score stub with the real three-way distribution, extract a
reusable `DistributionBar`, and add the "View Summary" entry point. Delivers FR-019's "no single
quality score" everywhere and de-risks the shared chart before Phase 2 depends on it.

### Changes Required:

#### 1. Shared distribution chart component

**File**: `src/components/inspections/DistributionBar.tsx` (new)

**Intent**: A presentational, catalogue-free component that renders a `{ yes, no, dontKnow }`
tally (plus the answered/total denominator) as a CSS/SVG stacked horizontal bar with a legend —
the single visual used by the session-hub Total Score, the Summary global chart, and each
per-Part chart. Shows counts and each slice's share of _answered_; renders an explicit empty
state when nothing is answered or a Part has zero visible questions. **No combined headline %.**

**Contract**: Props `{ yes: number; no: number; dontKnow: number; total: number }` (`total` =
visible-question denominator). Uses the Caffeine status hues already established in
`QuestionCards.tsx:45` (emerald / red / blue, light+dark tuned). Theme-aware via existing
tokens. Pure — no Dexie/catalogue import, so it renders on any island.

#### 2. Wire the live distribution into the session hub

**File**: `src/components/inspections/SessionScreen.tsx`

**Intent**: Compute the global distribution from the live answers intersected with the live
visible ID set (across Parts 2–5), and render it through `DistributionBar` in place of the
static `0%`/all-zero block (`SessionScreen.tsx:186-198`). The completion card's `N of M` stays.

**Contract**: Reuse `distribution()` from `@/lib/answers` over the flattened live visible IDs
(`liveIds.part2…part5`, already computed at `SessionScreen.tsx:151`) and the live `answers` map
(`:150`). Denominator = `totalVisible` (`:144`). No new props from the route.

#### 3. "View Summary" entry point

**File**: `src/components/inspections/SessionScreen.tsx`

**Intent**: Add a link/button to `/inspections/${id}/session` → `/inspections/${id}/summary` so
the user can reach the Summary at any time (PRD "Summary reach rate"). Visible whenever the
config is unlocked (Parts 2–5 exist to summarize).

**Contract**: An anchor to `/inspections/${inspection.id}/summary`, styled with the existing
`PRIMARY_BTN`/anchor patterns in the file. Gated on `unlocked`.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking + type-checked lint pass: `npm run lint`
- [ ] Production build passes: `npm run build`
- [ ] Unit test: the session-hub global distribution equals `distribution()` over the flattened
      visible IDs for a representative config+answers fixture (`tests/` addition)

#### Manual Verification:

- [ ] The session hub shows real Yes/No/Don't-know counts + per-slice % of answered, with **no**
      combined quality %, and updates as answers change on another tab/card
- [ ] The Total Score block reads sensibly at 0 answered (empty state) and at full completion
- [ ] "View Summary" navigates to `/inspections/[id]/summary` (404/placeholder acceptable until
      Phase 2)

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation before proceeding.

---

## Phase 2: Summary route + charts + read-only per-Part modals

### Overview

Stand up the Summary page: SSR route running the engine server-side, and a `SummaryScreen`
island rendering the global chart, per-Part charts, an editable global-notes textarea, and a
read-only, section-grouped, collapsible per-Part question/answer modal opened by tapping a
Part's chart. Wire `[id].astro` to open Completed inspections here.

### Changes Required:

#### 1. Summary SSR route

**File**: `src/pages/inspections/[id]/summary.astro` (new)

**Intent**: SSR-load the inspection under RLS (same template as `session.astro`), run the
FR-014 engine server-side, and pass the per-Part ordered question metadata + count/ID payloads +
raw answers + scalar fields to the `SummaryScreen` island. Absent row (RLS) → `/dashboard`.

**Contract**: Selects the same column set as `session.astro:26`. Computes, for each of Parts
2–5, the ordered visible cards via `selectCardDeck(config, activeFlags, part)` →
`{ id, label, section, subsection }[]`. Passes `sessionCounts`, `sessionQuestionIds`,
`relevantToggles`, `initialAnswers` (read off the raw snake_case `row`, per the ts2589 note),
`status`, `globalNotes`, and the flag columns. Catalogue never crosses to the island.

#### 2. Summary island

**File**: `src/components/inspections/SummaryScreen.tsx` (new)

**Intent**: `client:only="react"` island rendering, top-to-bottom: the global `DistributionBar`
(across all Parts), a per-Part `DistributionBar` for each of Parts 2–5 (each tappable), and the
editable global-notes textarea (reusing SessionScreen's debounced `saveInspection({id,
globalNotes})` pattern). Live counts/answers/flags derive from the live Dexie row with SSR
fallback, exactly like `SessionScreen`.

**Contract**: Props mirror `SessionScreen`'s (`counts`, `questionIds`, `initialAnswers`,
`flagBindings`, `globalNotes`, flag columns, `status`, `unlocked`) plus a per-Part ordered
`cards` map (`Record<PartId, {id,label,section,subsection}[]>`). Per-Part distribution =
`distribution(liveIds[part], answers)`; global = `distribution(allVisibleIds, answers)`. Notes
textarea + debounced persist copied from `SessionScreen.tsx:109-126` (single shared live row).

#### 3. Per-Part question/answer modal (read-only)

**File**: `src/components/inspections/SummaryScreen.tsx` (same file or a colocated subcomponent)

**Intent**: Tapping a Part's chart opens a `Dialog` listing that Part's questions grouped by
`section` (each group a collapsible block), showing each question's `label` and its current
answer (Yes/No/Don't know or "Not answered"), read-only. Closing resets any transient state.

**Contract**: Uses the existing `@/components/ui/dialog`. Groups the passed-in ordered `cards`
for that Part by `section` preserving catalogue order; collapsible via local state. Answer value
read from the live `answers` map by card `id` (verbatim key). Read-only in this phase (Edit
arrives in Phase 3).

#### 4. Dispatch Completed inspections to the report

**File**: `src/pages/inspections/[id].astro`

**Intent**: Before the current unconditional redirect to `/session`, load the row's `status`
under RLS and dispatch: Completed → `/summary`, Draft (or unknown) → `/session`. Absent row →
`/dashboard`.

**Contract**: Add a minimal RLS-scoped `select id,status` (or fold into a `maybeSingle`), then
branch the redirect. Keep it a thin dispatcher — no rendering.

### Success Criteria:

#### Automated Verification:

- [ ] Type-checked lint passes: `npm run lint`
- [ ] Production build passes: `npm run build`
- [ ] Unit test: per-Part and global distributions computed by the Summary glue match
      `distribution()` over the corresponding visible ID sets (incl. an orphaned-answer fixture
      that must be excluded)

#### Manual Verification:

- [ ] `/inspections/[id]/summary` shows the global chart on top, a chart per Part, and the
      editable notes textarea; charts reflect current answers
- [ ] Tapping a Part chart opens the modal with that Part's questions grouped by section,
      collapsible, read-only, showing each answer
- [ ] Editing the notes textarea persists (survives reload; reflects on the session hub too)
- [ ] A Completed inspection opened from the dashboard lands on `/summary`; a Draft lands on
      `/session`
- [ ] Charts render correctly for a Part with zero visible questions and for a fully-unanswered
      inspection

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Inline answer editing in the per-Part modal

### Overview

Add the FR-020 inline-edit affordance: inside the per-Part modal an **Edit** button (draft only)
reveals per-question three-way toggles; tapping a toggle saves immediately via the optimistic
path; the global + per-Part charts and Total Score update live; closing the modal resets edit
mode to read-only.

### Changes Required:

#### 1. Edit mode + per-question answer toggles

**File**: `src/components/inspections/SummaryScreen.tsx` (the per-Part modal)

**Intent**: Add an `Edit` button in the modal (rendered only when the inspection is Draft). In
edit mode each question row shows the same three-way segmented control as the cards; tapping
writes `saveInspection({ id, answers: { ...answers, [cardId]: value } })` then `flushQueue`,
identical to `QuestionCards.handleAnswer` (`QuestionCards.tsx:154`). No Save button. Because
`answers` derives from the live Dexie row, all charts recompute immediately.

**Contract**: Reuse the `ANSWER_OPTIONS` control styling from `QuestionCards.tsx:45`. Edit mode
is local dialog state initialized `false`; opening/closing the dialog resets it to `false`.
Save-failure surfaces inline (mirror `QuestionCards` `saveError`). Toggling an already-selected
answer may either no-op or re-affirm — pick no-op; do not clear an answer (there is no
"unanswer" in the domain).

### Success Criteria:

#### Automated Verification:

- [ ] Type-checked lint passes: `npm run lint`
- [ ] Production build passes: `npm run build`
- [ ] Unit test: applying an inline edit to the answers map yields the expected recomputed
      per-Part + global distribution (pure-function level)

#### Manual Verification:

- [ ] In a Draft Summary, the modal's Edit button reveals per-question toggles; tapping one saves
      with no Save button and the charts/Total Score move immediately
- [ ] Closing and reopening the modal returns it to read-only
- [ ] An edit made offline reflects in the charts without a round-trip and syncs on reconnect
- [ ] A failed local save surfaces an inline error and does not silently drop the change

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Finalize + reopen state machine

### Overview

Layer the FR-021 lifecycle: a Finalize button sets `Completed` (optimistic); the report then
renders read-only (notes locked, no modal Edit button, no Finalize); a Reopen button behind a
confirm dialog reverts to `Draft` and requires re-finalization. Prove the whole loop with one
Playwright e2e.

### Changes Required:

#### 1. Finalize action (Draft → Completed)

**File**: `src/components/inspections/SummaryScreen.tsx`

**Intent**: A **Finalize inspection** button (shown only in Draft) writes
`saveInspection({ id, status: 'completed' })` then `flushQueue`. Enabled at any answered-count
(finalize-anytime, per decision); the read-only mode derives from the live `status`, so the UI
flips without a reload.

**Contract**: Reuses the optimistic status write (`SaveInput.status` already supported,
`sync.ts:93`). No confirm dialog on finalize (it is reversible via Reopen). Failure surfaces
inline.

#### 2. Read-only report enforcement (Completed)

**File**: `src/components/inspections/SummaryScreen.tsx`

**Intent**: When live `status === 'completed'`, render the report read-only: the global-notes
textarea becomes read-only/disabled, the per-Part modal shows no Edit button, and Finalize is
replaced by the Reopen control. Charts unchanged (static).

**Contract**: A single `readOnly = liveStatus === 'completed'` flag gates the notes `readonly`
attribute, the modal Edit button, and the Finalize/Reopen swap. Derived from the live row
(`useLiveQuery`) with SSR fallback.

#### 3. Reopen action (Completed → Draft, confirmed)

**File**: `src/components/inspections/SummaryScreen.tsx`

**Intent**: A **Reopen for editing** button (shown only in Completed) opens an `AlertDialog`
confirming the inspection will return to Draft; confirming writes
`saveInspection({ id, status: 'draft' })` then `flushQueue`, re-enabling inline editing + the
Finalize button (re-finalization required).

**Contract**: Reuse `@/components/ui/alert-dialog` (the destructive-confirm pattern from
`DashboardBoard.tsx:233`). Copy makes the Draft reversion explicit.

#### 4. End-to-end round-trip test

**File**: `tests/e2e/summary-finalize.spec.ts` (new; follows the build+wrangler SW pattern)

**Intent**: One Playwright spec driving the north-star acceptance path: answer questions →
open Summary (distribution visible) → Finalize → report is read-only (no Edit, notes locked) →
dashboard opens it as the read-only report → Reopen (confirm) → back to Draft/editable →
re-finalize.

**Contract**: Runs against the built app via the existing `npm run test:e2e` harness
(build + `wrangler dev`, needs local Supabase). Asserts status-driven UI states, not internals.

### Success Criteria:

#### Automated Verification:

- [ ] Type-checked lint passes: `npm run lint`
- [ ] Production build passes: `npm run build`
- [ ] Unit tests pass: `npm test`
- [ ] E2E finalize/reopen round-trip passes: `npm run test:e2e`

#### Manual Verification:

- [ ] Finalize flips the page to a read-only report with no reload (notes locked, no modal Edit,
      no Finalize button)
- [ ] The dashboard opens the Completed inspection directly as the read-only report
- [ ] Reopen requires an explicit confirm, reverts to Draft, re-enables editing, and requires
      re-finalization
- [ ] Finalize then reopen works offline (optimistic) and reconciles on reconnect

**Implementation Note**: Final phase — confirm the full loop end-to-end before closing.

---

## Testing Strategy

### Unit Tests:

- Per-Part + global distribution glue equals `distribution()` over the correct visible ID sets.
- Orphaned answers (answers for now-hidden questions) are excluded from every distribution.
- Inline-edit answer-map update recomputes distributions correctly (pure level).
- Empty cases: zero-visible-question Part, fully-unanswered inspection.

### Integration / E2E Tests:

- One Playwright spec: answer → Summary → finalize → read-only report → dashboard opens report
  → reopen (confirm) → re-finalize.

### Manual Testing Steps:

1. Answer some questions in a Part, open Summary, confirm global + per-Part charts match.
2. Open a Part modal, verify read-only grouping; hit Edit, retoggle an answer, watch charts move.
3. Edit global notes on the Summary; confirm it reflects on the session hub and survives reload.
4. Finalize; confirm read-only report (notes locked, no Edit, no Finalize). Reload — still report.
5. From the dashboard, open the Completed tile — lands on the read-only report.
6. Reopen (confirm) → Draft → edit an answer → re-finalize.
7. Repeat 3–6 with DevTools offline to confirm optimistic behavior + reconnect sync.

## Performance Considerations

Distributions are O(visible questions) over a small catalogue, recomputed in-island on the live
row — well within the <200 ms perceived-update NFR. No new network calls beyond the existing
optimistic `saveInspection` writes. The 80 KB catalogue stays server-side; the Summary island
ships only the small per-Part metadata payload.

## Migration Notes

None. `status` already exists (`draft`/`completed`) and answers already persist; no schema or
data migration.

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-06 (north star)
- PRD: FR-019, FR-020, FR-021, US-01; Business Logic (equal weighting, no verdict)
- Scoring primitive: `src/lib/answers.ts:46` (`distribution`)
- Denominators: `src/lib/session-counts.ts`
- Optimistic write path: `src/lib/sync.ts:109` (`saveInspection`)
- Answer-write reference: `src/components/inspections/QuestionCards.tsx:154`
- Session-hub live-row pattern: `src/components/inspections/SessionScreen.tsx:100,137,150`
- Field-casing / ts2589 note: `src/pages/inspections/[id]/session.astro:59-62`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Live Total Score on the session hub

#### Automated

- [ ] 1.1 Type-checked lint passes: `npm run lint`
- [ ] 1.2 Production build passes: `npm run build`
- [ ] 1.3 Unit test: session-hub global distribution matches `distribution()` over flattened visible IDs

#### Manual

- [ ] 1.4 Session hub shows real Yes/No/Don't-know counts + per-slice %, no combined quality %, updates live
- [ ] 1.5 Total Score block reads sensibly at 0 answered and at full completion
- [ ] 1.6 "View Summary" navigates to `/inspections/[id]/summary`

### Phase 2: Summary route + charts + read-only per-Part modals

#### Automated

- [ ] 2.1 Type-checked lint passes: `npm run lint`
- [ ] 2.2 Production build passes: `npm run build`
- [ ] 2.3 Unit test: per-Part + global distributions match `distribution()` (incl. orphaned-answer exclusion)

#### Manual

- [ ] 2.4 Summary shows global chart on top, per-Part charts, editable notes textarea
- [ ] 2.5 Tapping a Part chart opens a section-grouped, collapsible, read-only modal with answers
- [ ] 2.6 Notes edit persists (survives reload; reflects on the session hub)
- [ ] 2.7 Completed opens on `/summary`, Draft on `/session` (dashboard dispatch)
- [ ] 2.8 Charts render correctly for a zero-question Part and a fully-unanswered inspection

### Phase 3: Inline answer editing in the per-Part modal

#### Automated

- [ ] 3.1 Type-checked lint passes: `npm run lint`
- [ ] 3.2 Production build passes: `npm run build`
- [ ] 3.3 Unit test: inline edit recomputes per-Part + global distributions correctly

#### Manual

- [ ] 3.4 Modal Edit button reveals per-question toggles; tapping saves with no Save button; charts move live
- [ ] 3.5 Closing/reopening the modal returns it to read-only
- [ ] 3.6 Offline edit reflects in charts without a round-trip and syncs on reconnect
- [ ] 3.7 Failed local save surfaces an inline error and doesn't drop the change

### Phase 4: Finalize + reopen state machine

#### Automated

- [ ] 4.1 Type-checked lint passes: `npm run lint`
- [ ] 4.2 Production build passes: `npm run build`
- [ ] 4.3 Unit tests pass: `npm test`
- [ ] 4.4 E2E finalize/reopen round-trip passes: `npm run test:e2e`

#### Manual

- [ ] 4.5 Finalize flips to read-only report with no reload (notes locked, no modal Edit, no Finalize)
- [ ] 4.6 Dashboard opens the Completed inspection as the read-only report
- [ ] 4.7 Reopen requires explicit confirm, reverts to Draft, re-enables editing, requires re-finalization
- [ ] 4.8 Finalize then reopen works offline and reconciles on reconnect
