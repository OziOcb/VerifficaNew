<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Domain Schema + RLS Isolation Contract

- **Plan**: context/changes/domain-schema-rls-isolation/plan.md
- **Mode**: Deep
- **Date**: 2026-06-10
- **Verdict**: SOUND (after fixes; pre-triage: SOUND with two quick fixes recommended)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

5/5 paths ✓ (plus `supabase/migrations/` and `src/db/` correctly claimed absent), 4/4 symbols ✓ (`createServerClient` at src/lib/supabase.ts:9, env schema at astro.config.mjs:17, `enable_confirmations = false` at supabase/config.toml:209, CI workflow shape), brief↔plan ✓, Progress↔Phase contract ✓ (12/12 success-criteria bullets mapped).

Deep verification highlights: blast radius of the typed-client change is clean — `createClient()` has 4 call sites (middleware + 3 auth API routes), the client is never stored in `Astro.locals` (env.d.ts types only `user`), so no hidden typing file is missed. tsconfig `include: ["**/*"]` + ESLint `projectService` already cover `tests/` and `vitest.config.ts` for type-checked lint. `.env.example` lacks `SUPABASE_SERVICE_ROLE_KEY` (plan already adds it).

## Findings

### F1 — "Affects 0 rows" assertions can false-pass

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — #3 Isolation integration test
- **Detail**: Under RLS, a cross-account update/delete is not an error — PostgREST silently matches 0 rows and returns success. supabase-js returns no affected-row count unless `.select()` is chained (or `{ count: "exact" }` passed), so a test asserting "no error" passes even with RLS disabled. The negative-control step (3.5) mitigates only if executed per-policy.
- **Fix**: Amend the Phase 3 #3 contract: update/delete assertions must chain `.select()` and assert an empty result array; cross-account select asserts empty data, not an error.
- **Decision**: FIXED — contract amended in plan.md (update/delete bullets now require `.select()`-chained empty-array assertions with rationale).

### F2 — Plan makes README and CLAUDE.md false without updating them

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — #4 .env.example + docs
- **Detail**: README.md:114 ("No database tables or migrations are required") and the CLAUDE.md auth bullet ("no app tables or migrations") become false once Phase 1 lands. Stale CLAUDE.md actively misinstructs future AI sessions.
- **Fix**: Add both doc updates to the Phase 3 #4 contract.
- **Decision**: FIXED — Phase 3 #4 now lists `CLAUDE.md` as a touched file and specifies both stale-doc fixes.

### F3 — CI boots the full Supabase stack

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — #5 CI job
- **Detail**: `npx supabase start` pulls images for Studio, imgproxy, inbucket, etc. — minutes of CI time the test never uses. `supabase status -o env` emits keys in directly consumable form.
- **Fix**: CI contract: start with `-x studio,imgproxy,inbucket,...` and source env via `npx supabase status -o env`.
- **Decision**: FIXED — CI contract now excludes unused services and uses `status -o env`.

### F4 — "Optionally add a types-in-sync check" is an undecided decision

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — #5 CI job
- **Detail**: "Optionally" left the decision to the implementer; without the check in CI, committed types drift silently after the next migration.
- **Fix**: Make `npm run db:types && git diff --exit-code src/db/database.types.ts` a required db-test step.
- **Decision**: FIXED — "optionally" dropped; check is required in the CI contract, success criteria, and Progress item 3.3.

## Triage Summary

- Fixed: F1, F2, F3, F4 (4)
- Skipped: — (0)
- Accepted: — (0)
- Dismissed: — (0)

Verdict after fixes: **SOUND** — safe to hand to /10x-implement.
