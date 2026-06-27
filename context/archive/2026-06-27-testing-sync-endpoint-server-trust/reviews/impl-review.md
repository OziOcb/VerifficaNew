<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Sync-endpoint Server-Trust

- **Plan**: context/changes/testing-sync-endpoint-server-trust/plan.md
- **Scope**: Phases 1–2 of 2
- **Date**: 2026-06-27
- **Verdict**: APPROVED (one warning, fixed during triage)
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension           | Verdict              |
| ------------------- | -------------------- |
| Plan Adherence      | PASS                 |
| Scope Discipline    | PASS                 |
| Safety & Quality    | WARNING (F1 — fixed) |
| Architecture        | PASS                 |
| Pattern Consistency | PASS                 |
| Success Criteria    | PASS                 |

Success criteria: `npm run lint` ✅ and `npm run build` ✅ re-run green; `npm test` ✅
413/413 (incl. the 12-case sync integration file under real local Supabase/RLS,
including the F1 regression test).

## Findings

### F1 — CF-1 guard rejects a cleared (null) transmission on an electric draft

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/sync-payload-validation.ts:36-47 (predicate docstring: src/lib/part1-config.ts:48-53)
- **Detail**: The CF-1 branch gated on `fuelType !== undefined && transmission !== undefined`,
  then called `isElectricTransmissionValid`, which returns `false` (violation) for
  `transmission: null` as well as `undefined`. Because `null !== undefined`, a payload of
  `{ fuelType:"electric", transmission:null }` passed the guard and was rejected with 400 —
  contradicting the plan's present-field intent ("an absent field is never a violation …
  keeps partial/draft saves working") and the predicate's own docstring. The real outbox
  (src/lib/sync.ts:110-130) builds payloads from all `DATA_FIELDS`, so `transmission` is
  always a present key (null when unset, never absent) — the production-realistic shape is
  `null`, which the original `undefined`-only test never exercised. Not reachable as a live
  regression today (Part1Form.handleSave gates sync on full `validatePart1` success), but
  latent for any future draft-save path or the curl/devtools bypass this guard targets.
- **Fix**: Gate CF-1 on both fields being concrete strings (`typeof === "string"`), so
  null/undefined both skip; align the `isElectricTransmissionValid` docstring with its real
  contract; add a regression test for `{ fuelType:"electric", transmission:null }` → 200.
  - Strength: Restores the plan's "absent is never a violation" guarantee for the realistic
    null shape, keeps the Risk #6 electric+manual rejection, and matches the null-safe
    `typeof === "string"` style the globalNotes/notes branches already use.
  - Tradeoff: None material — strictly loosens an over-strict edge; ~4-line change + 1 test.
  - Confidence: HIGH — predicate behavior verified directly; outbox-sends-all-keys verified.
  - Blind spot: Whether product intent wants a bypass caller's electric+null rejected anyway;
    plan text says partial saves should pass, so allow.
- **Decision**: FIXED (Fix now) — commit 87ef6e1
