<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Offline Durability at Flow Level

- **Plan**: context/changes/testing-offline-durability/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-06-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verification run live in this review

- `npx vitest run tests/sync.drain.test.ts` → 7/7 pass
- `npm run lint` → clean (0 errors)
- Regression guard (criterion 1.3): reverting `orderBy("seq")` reds exactly the FIFO-tie case (1 failed, 6 passed); source restored clean. The seq fix genuinely bites.
- Full `npm run test:e2e` not re-run here (needs build + wrangler dev + local Supabase). Spec content verified statically; phases marked done with commit shas.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — E2e "per-write" proof partly rests on the integration suite, not the e2e alone

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria / Plan Adherence
- **Location**: tests/e2e/offline-durability.spec.ts:89-135
- **Detail**: Op1 and op2 both write the same field (`globalNotes`: NOTE_ONE → NOTE_FINAL); op2 overwrites op1 server-side, so NOTE_ONE's landing is proven only at enqueue (queue depth), not via SSR. The config op IS independently SSR-verified, and `tests/sync.drain.test.ts` proves per-op FIFO POST order separately. Cross-layer proof is sound; the e2e name slightly oversells what this one file proves in isolation.
- **Fix**: Add a one-line clarifying comment in the spec noting per-op landing is proven by the integration suite, not this e2e.
  - Strength: No churn; the cross-layer proof already exists and the live regression check confirms the seq fix bites.
  - Tradeoff: Same-field last-write-wins makes independent server-verification of NOTE_ONE impossible by construction.
  - Confidence: HIGH — verified the assertion set and integration coverage directly.
  - Blind spot: Full e2e wasn't re-run in this review.
- **Decision**: FIXED — clarifying comment added at tests/e2e/offline-durability.spec.ts (step 5–6 block).

### F2 — "On-screen status pending/unsynced" asserted via Dexie, not DOM

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/e2e/offline-durability.spec.ts:18-44 (queueCount)
- **Detail**: Plan step 3 said "assert on-screen status shows pending/unsynced." The session screen has no pending indicator (optimistic save shows "Saved."), so the spec reads `changeQueue` depth directly. Documented in-code — justified adaptation to UI reality.
- **Decision**: SKIPPED — accepted as documented adaptation.

### F3 — queueCount() opens an unversioned IndexedDB connection

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: tests/e2e/offline-durability.spec.ts:23-44
- **Detail**: `queueCount()` calls `indexedDB.open("veriffica")` with no version; if invoked before the island opens Dexie it would create an empty v0 DB and throw on the changeQueue store. Every current call site is gated behind a visible session element, so safe today — implicit ordering dependency to watch if call sites move.
- **Decision**: SKIPPED — non-issue at current call sites.

### F4 — 2-per-owner cap edge if a 3rd shared-user spec is added

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (test residue)
- **Location**: tests/e2e/seed.spec.ts + tests/e2e/offline-durability.spec.ts
- **Detail**: Both specs share one user (storageState) and run serially, each self-cleaning, so steady-state peak is 1 row. Safe with 2 specs. A failed mid-run row plus a 3rd shared-user spec creating a row could trip `enforce_inspection_limit`. Worth a note for future spec additions.
- **Decision**: SKIPPED — future-proofing note; no action now.
