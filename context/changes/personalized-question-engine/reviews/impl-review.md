<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Session Screen + Personalized Question Generation (S-04)

- **Plan**: context/changes/personalized-question-engine/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-19
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical 1 warning 2 observations

## Automated verification (run during review)

- `npm test` — ✅ 7 files, 123 tests passed
- `npm run lint` — ✅ exit 0
- `npm run build` — ✅ exit 0 (pre-existing unrelated CSS `[file:line]` warning only)

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

## Findings

### F1 — Phase 3/4 UX redesigned; plan text + criteria 3.3/4.5 describe the abandoned design

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Success Criteria
- **Location**: plan.md Phase 3 §1 / 3.3, Phase 4 §1 / 4.5 vs. src/components/inspections/Part1Form.tsx:22,210-223,416 and src/pages/inspections/[id]/session.astro:36-42
- **Detail**: Plan specified (a) `/session` gated by `isConfigUnlocked`, redirecting an invalid config to the Part 1 form, and (b) equipment toggles on `SessionScreen` with instant per-toggle recompute "without a server round-trip." Shipped instead: `/session` is the always-on landing hub (renders for any config validity; Parts 2–5 locked-in-nav; per-Part 2–5 routes redirect to Part 1 when locked); toggles live in `Part1Form` and commit with the config on Save, then a page navigate to `/session` reflects them. `SessionScreen`'s recompute path only ever _reflects_ persisted flags. Criteria 3.3 ("redirects when config invalid") and 4.5 ("counts rise instantly, no reload") are checked `[x]` but no longer match. Design is coherent/better and change.md flagged the affordance as an open unknown — but the source-of-truth plan was stale for S-05/S-07.
- **Fix A ⭐ Recommended**: Reconcile the plan as an addendum — update Phase 3 §1, Phase 4 §1, reword criteria 3.3/4.5, note the resolved affordance.
  - Strength: Restores plan as ground truth before S-05; repo updates plans via addenda mid-flight.
  - Tradeoff: Progress `[x]` marks stay, now backed by accurate criteria.
  - Confidence: HIGH — shipped behavior is clear from routes/components.
  - Blind spot: Doesn't add the missing automated route-guard test for 3.3.
- **Fix B**: Restore session-screen toggles + `isConfigUnlocked` redirect to match the original plan.
  - Strength: Honors the plan verbatim; instant on-screen recompute.
  - Tradeoff: Discards a sound shipped redesign and the change.md affordance decision.
  - Confidence: MED — undoes working, tested code for a doc match.
  - Blind spot: User-facing flow may already be validated as-is.
- **Decision**: FIXED via Fix A — plan.md Phase 3 §1, Phase 4 §1, criteria 3.3 & 4.5 reconciled + "Addendum: shipped-design divergences" section added.

### F2 — Unplanned src/lib/session-counts.ts replaces the planned client recompute mechanism

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Architecture
- **Location**: src/lib/session-counts.ts (new), src/lib/questions.ts:315-335
- **Detail**: Plan Phase 4 §1 said the island recomputes by re-filtering the group set it received. Implemented as a catalogue-free `base + Σ(flag deltas)` payload (`sessionCounts` → `countsForFlags`) — cleaner (island gets only numbers), equivalence pinned by `tests/questions.test.ts:222-253`. A genuine improvement, not in the plan.
- **Fix**: Note the base+deltas helper in the plan's Phase 4 §1 / Performance section.
- **Decision**: FIXED — covered by the plan Addendum (point 3).

### F3 — Unrelated inspection-limit trigger fix bundled onto the S-04 branch

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20260617220000_inspections_limit_excludes_self.sql, tests/inspections.limit.test.ts (commit 346e03e)
- **Detail**: A fix for the 2-per-owner BEFORE INSERT trigger (it blocked edits at the cap) rode along on this feature branch — out of S-04 scope but well-handled: correct (`id <> new.id`), tested, captured as a lessons.md rule. Benign; noted for branch hygiene.
- **Fix**: None needed — optionally call it out in the PR description as a separate fix.
- **Decision**: FIXED — documented in the plan Addendum (trailing note); user opted not to split the PR.
