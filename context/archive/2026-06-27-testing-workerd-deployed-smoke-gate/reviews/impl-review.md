<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Deployed workerd Smoke-Gate

- **Plan**: context/changes/testing-workerd-deployed-smoke-gate/plan.md
- **Scope**: Phases 1–3 of 3 (all complete)
- **Date**: 2026-06-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 4 warnings · 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Lint + `astro sync` pass clean. `npm run smoke:deployed` not re-run during review (needs `.env.smoke` prod creds + creates/deletes a real prod user against the live Worker); Progress boxes are SHA-stamped and the spec/script support every asserted oracle.

## Findings

### F1 — `wrangler tail` can orphan: killed via the npx wrapper, not the real child

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: scripts/smoke-deployed.mjs:35-46
- **Detail**: `spawn("npx", ["wrangler","tail",…])` then `tail.kill("SIGINT")` signals the npx wrapper, not the underlying wrangler grandchild. npx signal forwarding to grandchildren is unreliable and children aren't detached, so a live tail connection to prod can survive after the orchestrator exits.
- **Fix A ⭐ Recommended**: spawn `detached: true`, kill the group via `process.kill(-tail.pid, "SIGINT")`.
  - Strength: Reaps the wrangler grandchild regardless of npx forwarding.
  - Tradeoff: Group-kill is Unix-only (fine on this macOS setup).
  - Confidence: HIGH — standard pattern.
  - Blind spot: None significant on macOS.
- **Fix B**: spawn `node_modules/.bin/wrangler` directly so `kill()` targets the real process.
  - Strength: Simplest; no group semantics.
  - Tradeoff: Relies on resolving the binary path.
  - Confidence: MED.
  - Blind spot: Exact .bin entry name unverified.
- **Decision**: FIXED via Fix A (detached + group-kill)

### F2 — .gitignore uses exact filenames, not a glob — prod creds can leak

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Security)
- **Location**: .gitignore:22-24
- **Detail**: Ignores only `.env`, `.env.production`, `.env.smoke`. `git check-ignore` confirms `.env.local` and `.env.smoke.local` are NOT ignored, yet `loadEnv("smoke", …)` (playwright.config.ts:15) reads both (and `.env.smoke.local` overrides `.env.smoke`). Real prod/service-role keys placed in either can be committed silently.
- **Fix**: Replace the three exact entries with `.env*` plus `!.env.example` and `!.env.smoke.example`.
- **Decision**: FIXED (.env* glob + allowlist)

### F3 — No assertion the smoke run targets PROD; partial .env.smoke silently uses LOCAL creds

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Data safety)
- **Location**: tests/e2e/deployed-auth.setup.ts (env resolution) · playwright.config.ts:11-15
- **Detail**: `loadEnv` loads local `.env` first then overlays `.env.smoke`; a missing/partial `.env.smoke` silently uses LOCAL Supabase creds while tests still POST to the LIVE Worker. `requireEnv` only checks presence, not that the URL is non-localhost. No real-user risk (deletion scoped to minted ephemeral id) but undercuts the safety model.
- **Fix**: In deployed-auth.setup.ts, assert `SUPABASE_URL` is not localhost/127.0.0.1 when `SMOKE_DEPLOYED` is set; fail fast otherwise.
  - Strength: Cheap fail-fast closing the "wrong project" gap.
  - Tradeoff: One extra guard; negligible.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED (non-localhost SUPABASE_URL guard)

### F4 — Planned "non-JSON → 400" probe dropped from spec, but §6.5 docs still claim it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: tests/e2e/deployed-smoke.spec.ts (probe absent) · context/foundation/test-plan.md:185 (stale claim)
- **Detail**: Plan Phase 1 specified unauthenticated POST /sync non-JSON → 400. Absent from spec — correctly, since sync.ts:29 returns 401 (auth) before the JSON parse at :31-36, making an unauthenticated 400 unreachable. But §6.5:185 still lists it in the unauthenticated rung (documents impossible behavior), and the 400 path now has zero coverage.
- **Fix A ⭐ Recommended**: move the 400 probe into the AUTHENTICATED rung; correct §6.5 to place it there.
  - Strength: Restores planned coverage of the real 400 path AND makes docs true.
  - Tradeoff: One more authed probe; trivial.
  - Confidence: HIGH — matches sync.ts:29-36 flow.
  - Blind spot: None significant.
- **Fix B**: just delete the stale 400 line from §6.5.
  - Strength: Cheapest; docs stop lying.
  - Tradeoff: Permanently drops the malformed-body coverage the plan wanted.
  - Confidence: HIGH.
  - Blind spot: Loses regression guard on the parse branch.
- **Decision**: FIXED via Fix A (authed 400 probe + §6.5 corrected)

### F5 — Child spawns lack 'error' handlers; signal paths don't flush the log

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: scripts/smoke-deployed.mjs:35, :64, :50-57
- **Detail**: Neither spawn registers `.on("error")` — a failed spawn becomes an uncaught exception and the playwright close promise never resolves (stopTail skipped). SIGINT/SIGTERM handlers call `process.exit` without `logStream.end()`, so the last tail lines can be lost from the evidence log.
- **Fix**: Add `.on("error", …)` to both spawns (resolve the playwright promise on error so stopTail runs); call `logStream.end()` in the signal handlers.
- **Decision**: FIXED (spawn error handlers + signal-path log flush)

### F6 — Stale wording: §5 gate row + local-only requireEnv hint

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/test-plan.md:140 (§5 row) · tests/helpers/supabase.ts:15
- **Detail**: Plan Phase 3 said flip the gate "to enforced", but the §5 row still reads "required after §3 Phase 4" (conditional) though the condition is now met. Separately, requireEnv's hint "Is local Supabase running (npx supabase start)?" is wrong during a deployed smoke (fix is "populate .env.smoke").
- **Fix**: Reword the §5 row to read as enforced; make the requireEnv hint mode-neutral.
- **Decision**: FIXED requireEnv hint; §5 row left to match table convention
