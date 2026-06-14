<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: S-02 Dashboard + Inspection Lifecycle

- **Plan**: context/changes/inspection-dashboard-lifecycle/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-14
- **Verdict**: NEEDS ATTENTION (no blockers; all findings low-likelihood hardening notes)
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Success criteria re-verified at review time: `npm test` (15 passed), `npm run lint` (clean), `npm run build` (complete). All manual Progress items (4.3–4.6) carry observable evidence (hosted trigger check, `wrangler tail` round-trip, production e2e).

## Findings

### F1 — Limit trigger count is not concurrency-safe (TOCTOU)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data safety)
- **Location**: supabase/migrations/20260613204306_inspections_two_limit.sql:20
- **Detail**: `select count(*) ... >= 2` in a BEFORE INSERT trigger is read-then-insert with no lock. Two concurrent inserts for one owner can both see count=1 and succeed → 3 rows. Blast radius is one extra draft (never cross-owner); the client `busy` flag (DashboardBoard.tsx:77) makes the double-click path unlikely.
- **Fix A ⭐**: Record as a known limitation (lesson), leave code as-is.
- **Fix B**: Harden with a row-lock / partial-unique / exclusion constraint.
- **Decision**: ACCEPTED-AS-RULE — lesson "Count-based limits in DB triggers are not concurrency-safe" appended to lessons.md; code intentionally unchanged (Fix A).

### F2 — Delete of a foreign/nonexistent id reports success

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/pages/api/inspections/sync.ts:39-41, src/lib/inspections.ts:46-53
- **Detail**: An RLS-blocked delete returns no error, so the endpoint returns 204 and `deleteInspection()` returns true even when nothing was deleted. Not exploitable in S-02 (id always comes from the user's own SSR list), but "delete succeeded" is reported untruthfully for any other id.
- **Fix**: In sync.ts delete branch, `.select()` / check deleted count → 404 on zero rows; map to `false`. (Touches the shared F-02 sync boundary / offline outbox.)
- **Decision**: SKIPPED (deferred) — revisit when delete is exposed beyond owner-only tiles.

### F3 — 409 limit mapping via brittle message string match

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/pages/api/inspections/create.ts:32
- **Detail**: `error.message.includes("inspection_limit_reached")` works today, but rewording the trigger's `raise` text would silently downgrade the limit case to a generic 400 (no limit pop-up), with no test to catch it.
- **Fix**: Pin the contract with a shared constant + CI test.
- **Decision**: FIXED — extracted `INSPECTION_LIMIT_ERROR` to src/lib/inspections.ts; create.ts imports it; tests/inspections.limit.test.ts asserts the DB error contains it (a reworded migration message now fails CI). Verified: 15 tests pass, lint clean.

### F4 — SSR dashboard read swallows the query error

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/pages/dashboard.astro:20-24
- **Detail**: Destructures only `{ data }`; a transient Supabase error yields data=null → renders the empty-state CTA, indistinguishable from a genuinely empty account.
- **Fix**: Optional — also read `error` and log / show a notice.
- **Decision**: SKIPPED — acceptable for an RLS-scoped read.

### F5 — Unplanned but justified scope edits

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js, package.json/lock, astro.config.mjs
- **Detail**: Three edits outside the planned file list, all enabling planned work: eslint.config.js disables `no-misused-promises` for `.astro` (unblocks the data-dependent `Astro.redirect` in `[id].astro`); radix-ui ^1.5.0 added (required by shadcn dialog/alert-dialog); astro.config.mjs comment refreshed. All benign and already committed.
- **Fix**: None needed — acknowledge for the record.
- **Decision**: ACCEPTED-AS-RULE — lesson "Type-checked ESLint rules can crash on `.astro` frontmatter" appended to lessons.md; no code change.
