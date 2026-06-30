<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Question-Card Answering (S-05)

- **Plan**: context/changes/question-card-answering/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-06-30
- **Verdict**: APPROVED (post-fix)
- **Findings**: 0 critical · 2 warnings · 3 observations (all resolved/triaged)

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Gate (post-fix): `astro sync` 0 · `lint` 0 · `npm test` 468/468 · `npm run build` ✓.
Plan-drift sweep: all 13 planned items MATCH; every "What We're NOT Doing" guardrail
clean (no S-06 numerators lit, no answers table/Dexie store/sync entity, no per-card
URLs, no gesture lib). No XSS (all text renders as escaped React children); RLS
inheritance correct; inbound jsonb casing preserved via `stopPaths: ["answers"]`;
React-Compiler constraints respected.

## Findings

### F1 — Contextual-note save skips the 10,000-char global-notes guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/inspections/QuestionCards.tsx:177 (saveNote)
- **Detail**: `saveNote` persisted the merged global-notes document with no
  `MAX_GLOBAL_NOTES_LENGTH` check. Once the doc crossed 10,000 chars the sync-boundary
  guard (`validateSyncPayload`) returns a deterministic 400, and `flushQueue`'s
  `if (!res.ok) break;` parks that op at the head of the FIFO outbox — permanently
  blocking every later op (including all subsequent answers) from syncing on that device.
  The sibling `SessionScreen` guards this with `overLimit`; `saveNote` did not.
- **Fix**: Bail with an inline `M.globalNotes` error when
  `nextNotes.length > MAX_GLOBAL_NOTES_LENGTH`, mirroring SessionScreen's `overLimit` gate.
- **Decision**: FIXED — applied at QuestionCards.tsx (new `noteDocOverLimit` state + gate
  in `saveNote` + reset in `openNote` + inline error branch in the note dialog).

### F2 — Unplanned per-Part progress feature on the session screen

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/inspections/SessionScreen.tsx:150 (+ session-counts.ts, session.astro)
- **Detail**: Three files outside the plan's change-list landed (commit bffe6da): a
  per-Part "X of Y answered" subtitle + "Completed" badge, backed by new
  `src/lib/session-counts.ts` (`questionIdsForFlags`) and `session.astro` wiring. Benign:
  the deferred S-06 _global_ Total Score / Completion numerators stay hardcoded at 0; only
  the _per-Part_ answered tally (intersection-based, tolerant of orphaned answers) was added.
- **Fix**: Document in plan.md as an addendum so the plan stays the source of truth.
- **Decision**: DOCUMENTED — `## Addenda` section added to plan.md (per-Part progress +
  the `card-nav.ts` pure-nav extraction).

### F3 — Note blocks keyed by composed header text, not question id

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Data Safety
- **Location**: src/components/inspections/QuestionCards.tsx:216
- **Detail**: Note blocks are keyed by `${partLabel}: ${card.header}` (display text), not
  the stable `q_…` id. Two questions in one Part with identical section/subsection/label
  would collide. Verified 0 collisions across all 206 catalogue questions today.
- **Fix**: Guard the invariant rather than re-key the stored format.
- **Decision**: NO CHANGE NEEDED — the uniqueness guard already exists at
  tests/questions.test.ts:414-420 (asserts every catalogue question yields a uniquely-keyed
  header, with the note-block-collision rationale in its comment). Adding another test would
  be redundant.

### F4 — Outbound snakecaseKeys recurses into the answers map; stale comment

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Data Safety
- **Location**: src/pages/api/inspections/sync.ts:57 (+ stale comment at :48)
- **Detail**: Inbound defends with `stopPaths: ["answers"]`, but outbound `snakecaseKeys`
  had no exclusion and defaults `deep: true` — so it recursed into the answers map. Safe
  today only because `snakeCase` is idempotent on already-snake `q_…` keys; a future id with
  a capital would be mangled outbound. The "scalar columns only (no jsonb yet)" comment was stale.
- **Fix**: Add `{ shouldRecurse: (key) => key !== "answers" }` to the outbound
  `snakecaseKeys`; refresh the stale comment. NOTE: the originally-suggested
  `exclude: ["answers"]` does NOT work — empirically it only spares the top-level key while
  still snake_casing nested keys (`q_Future_Cap` → `q_future_cap`). `shouldRecurse` is the
  correct outbound twin of inbound `stopPaths`.
- **Decision**: FIXED — applied `shouldRecurse` at sync.ts; stale comment removed.

### F5 — handleAnswer replaces the whole map from a render-closure snapshot

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/components/inspections/QuestionCards.tsx:139
- **Detail**: `handleAnswer` writes `{ ...answers, [card.id]: answer }` from the render
  closure; `saveInspection`'s read-merge takes `input.answers` verbatim (top-level columns,
  not map entries). Unreachable today — advancing requires a `setNavIndex` re-render and human
  read time (≫ Dexie observer latency), first paint falls back to correct SSR `initialAnswers`.
  Only a risk if auto-advance ever becomes programmatic/batched.
- **Fix**: No action now; revisit if advance is ever automated.
- **Decision**: SKIPPED — noted for the record.
