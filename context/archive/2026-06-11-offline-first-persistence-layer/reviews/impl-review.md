<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: F-02 Offline-First Persistence Layer

- **Plan**: context/changes/offline-first-persistence-layer/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-06-13
- **Verdict**: APPROVED (clean build + green e2e; both warnings are doc/scope-alignment, not defects)
- **Findings**: 0 critical · 2 warnings · 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated criteria re-run live during this review:

- `npx astro sync && npm run lint` — PASS (no errors)
- `npm test` — PASS (14/14)
- `npm run build` — PASS (sw.js + manifest.webmanifest + workbox-\*.js emitted; precacheAndRoute present)
- `npm run test:e2e` — PASS (1/1)
- 4.8 deployed wrangler-tail smoke-test — DEFERRED to S-02 (documented in change.md + roadmap)

## Findings

### F1 — SW offline strategy diverges from the planned mechanism

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: astro.config.mjs:29-61
- **Detail**: Phase 4 specified a static app-shell navigateFallback precaching from dist/client (Workbox navigateFallback/navigateFallbackDenylist). Implementation uses `navigateFallback: undefined` + a NetworkFirst runtimeCaching rule caching visited SSR navigations (excluding /api, /auth, /dashboard). Justified, e2e-proven adaptation (SSR has no static shell HTML), but plan + roadmap F-02 §Decisions still describe the old mechanism that S-08 will read as ground truth.
- **Fix**: Update the plan's Phase 4 contract + roadmap F-02 note to describe the NetworkFirst-runtime-cache approach (with the "SSR has no static shell" rationale).
  - Strength: Keeps source of truth aligned with shipped code before S-08 consumes it.
  - Tradeoff: Doc-only edit; no code change.
  - Confidence: HIGH — divergence confirmed by reading both files.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix now) — plan Phase 4 contract updated to describe the NetworkFirst runtime-cache approach.

### F2 — Outbox resilience + user-switch reset added beyond the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/sync.ts:27-34, 151-184
- **Detail**: Plan Phase 3 specified `window.addEventListener("online", flushQueue)` + initial flush. Implementation ships `startAutoSync` (online + visibilitychange + initial drain + 4s setInterval retry poll) plus `resetLocalStoreOnUserChange` (shared-device cache wipe). Additions are sound and safety-motivated; reset is documented in change.md §Follow-ups, but the auto-sync resilience additions are undocumented and the 4s poll calls `changeQueue.count()` indefinitely even when the queue is empty.
- **Fix**: Add a one-line plan/change.md addendum noting startAutoSync's redundant drain triggers; optionally gate the 4s poll to run only while ops remain (or widen the interval) to avoid an idle forever-poll.
  - Strength: Records discovered scope and trims a small idle cost; low risk.
  - Tradeoff: Minor; the poll is the documented backstop for a dropped `online` event on an offline-loaded SW page.
  - Confidence: HIGH — behavior read directly from sync.ts.
  - Blind spot: Haven't measured real battery impact of the 4s poll.
- **Decision**: FIXED (Doc addendum only) — Phase 3 contract now documents startAutoSync's four drain signals + resetLocalStoreOnUserChange. 4s poll left as-is (documented backstop).

### F3 — Sync endpoint doesn't guard JSON body parsing

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/inspections/sync.ts:30
- **Detail**: `await context.request.json()` is not wrapped in try/catch; a malformed body throws as an unhandled 500 rather than a clean 400. Consistent with existing auth endpoints (signin.ts doesn't guard formData either), so not a pattern violation — a minor robustness note. Own client always sends valid JSON, so no data-loss exposure.
- **Fix**: Wrap the parse in try/catch and return 400 on failure (only if hardening beyond the repo's current norm is desired).
- **Decision**: FIXED (Fix now) — request.json() wrapped in try/catch, returns 400 on malformed body. Lint + 14 unit tests re-verified green.
