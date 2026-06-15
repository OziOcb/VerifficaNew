<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Part 1 Config Form, Validation & Parts 2–5 Unlock

- **Plan**: context/changes/part-1-config-validation/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-06-15
- **Verdict**: NEEDS ATTENTION (resolved — see Triage outcomes)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated criteria re-run at review time: `npx astro sync` ✅ · `npm test` 82/82 ✅ · `npm run lint` ✅ (exit 0).

## Findings

### F1 — Price bound mismatch: Zod accepts 100× what the DB column holds

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260615120000_inspections_part1_config.sql:19 ↔ src/lib/part1-config.ts:110
- **Detail**: Column is `price numeric(10,2)` (max 99,999,999.99); Zod accepted `price <= 10_000_000_000` and tests/part1-config.test.ts:187 asserted the 10B value is accepted. A price between ~100M and 10B passed Zod, wrote optimistically to Dexie, the form showed success/unlock, then the Postgres upsert failed with numeric overflow. drainQueue (src/lib/sync.ts:140) does `if (!res.ok) break`, leaving the op in the outbox retrying forever — a silent local↔server divergence.
- **Fix A ⭐ Recommended**: Tighten the Zod max to 99,999,999.99 and update the test.
  - Strength: No second migration; ~100M ceiling is far beyond any vehicle price.
  - Tradeoff: Rules doc's stated 10B bound must be reconciled down too.
  - Confidence: HIGH — one-line schema change + test values; column precision is harder to change post-deploy.
  - Blind spot: None significant.
- **Fix B**: Widen the column to numeric(13,2) to match 10B.
  - Strength: Honors the spec bound; no app-code change.
  - Tradeoff: New migration to hosted Supabase before deploy; blast radius for a bound nobody hits.
  - Confidence: MED.
  - Blind spot: Whether 10B was intentional product intent.
- **Decision**: FIXED via Fix A — Zod bound → 99_999_999.99 (part1-config.ts:110 + comment), test accept boundary → "99999999.99" (test:187), reject boundary → "100000000" (test:158), rules doc §4 price row reconciled. 65 validation tests pass.

### F2 — handleSave has no catch: a failed local save gives the user no feedback

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/inspections/Part1Form.tsx:271-287
- **Detail**: The `try/finally` reset `saving` but had no `catch`. `saveInspection` writes to Dexie and can reject (IndexedDB quota, blocked/private browsing). The rejection was swallowed by `void handleSave()`, the button reset with no error shown — indistinguishable from never clicking. `setJustSaved(true)` was correctly inside the try (no false "Saved."). The sibling auth islands have a `ServerError` component to reuse.
- **Fix**: Add a `catch` that sets a visible save-error state, mirroring the auth `ServerError` pattern.
- **Decision**: FIXED — imported `ServerError`, added `saveError` state, cleared on save start, `catch` sets "Could not save on this device. Please try again.", rendered under the Save button. Lint exit 0.

### F3 — Dependency name variance: umbrella `radix-ui` vs `@radix-ui/react-select`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: package.json (radix-ui ^1.5.0) · src/components/ui/select.tsx
- **Detail**: Plan said add `@radix-ui/react-select`; impl uses the umbrella `radix-ui` package. Functionally equivalent and installed.
- **Fix**: Switch to scoped `@radix-ui/react-select` for tighter tree-shaking (optional).
- **Decision**: SKIPPED — umbrella package works; not worth lockfile churn.

## Notes

- All 13 planned items implemented and matching intent. The two plan-flagged cross-cutting risks are correctly handled: `isConfigUnlocked` runs the full schema incl. CF-1 (part1-config.ts:186); `created_at`/`status` are passed through on save (Part1Form.tsx:277-278).
- The `idea/veriffica-part-1-validation-rules.md` edit (137 lines, mostly cosmetic) is a PRD-driven reconciliation moving the spec to agree with shipped code (year/registration → optional per FR-013; year ≤ current year; doorCount 0–7) — consistent with the prd-overrides-spec-docs memory, not scope creep.
