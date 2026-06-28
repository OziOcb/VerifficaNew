# Deployed workerd Smoke-Gate — Plan Brief

> Full plan: `context/changes/testing-workerd-deployed-smoke-gate/plan.md`
> Research: `context/changes/testing-workerd-deployed-smoke-gate/research.md`

## What & Why

Build a repeatable deployed smoke (`npm run smoke:deployed`) that exercises the **live** Cloudflare Worker the way real traffic does — POSTing to `/api/inspections/{create,sync}` and fetching the SW assets — with `wrangler tail` capturing runtime evidence. It guards **Risk #5**: an SSR endpoint, the service worker, or env/secret access diverging on deployed `workerd` vs `astro dev` — building clean but failing only in production.

## Starting Point

The endpoints, the service worker, and a Playwright harness (`auth.setup.ts` + service-role user + `wrangler dev`) all exist — but every spec targets localhost; none targets the live URL. Deploys are owned by Cloudflare Workers Builds on push to `main` (no webhook, no post-deploy hook); CI is PR-only. `observability.enabled: true` already makes `wrangler tail` work against the live Worker.

## Desired End State

After a deploy reaches the live Worker, a human runs `npm run smoke:deployed`: it tails the Worker to a log file, runs cheap unauthenticated HTTP probes plus an authenticated `create → put → delete` round-trip against the live URL using an ephemeral, self-cleaning prod Supabase user, then prints the tail-log path. Green run + clean tail = parity confirmed. The §5 quality-gate row is enforced and §6.5 documents the pattern.

## Key Decisions Made

| Decision            | Choice                                           | Why (1 sentence)                                                                                   | Source |
| ------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------ |
| Execution model     | Manual `npm run smoke:deployed` script           | Smallest surface, no webhook/token plumbing; matches how 2026-06-01 + S-02 smokes were run.        | Plan   |
| Probe rungs         | Both (cheap HTTP + authenticated round-trip)     | Full Risk #5 coverage — catches the empty-secret 503 and lazy Node-API reach on invocation.        | Plan   |
| SW oracle           | Status + content-type only                       | Stable; not coupled to Workbox `__WB_MANIFEST` output format.                                      | Plan   |
| `wrangler tail`     | Evidence, human-reviewed                         | Matches lessons.md rule; avoids brittle log parsing and a Cloudflare API token.                    | Plan   |
| Test-user lifecycle | Ephemeral **prod** user, self-cleaning           | Deployed Worker uses prod secrets, so only prod exercises the real path; cascade-delete + row del. | Plan   |
| Implementation      | Playwright deployed-smoke project (env-branched) | Reuses storageState, helpers, assertion style; one harness, no duplicate auth logic.               | Plan   |

## Scope

**In scope:** Playwright config env-branch (live `baseURL`, no `webServer`); deployed-smoke spec (both rungs); ephemeral prod-user setup/teardown; `npm run smoke:deployed` wrapper with tail capture; `.env.smoke.example`; test-plan §6.5 cookbook + §5 gate registration.

**Out of scope:** Automated CI gate / push trigger / Cloudflare webhook / API token; deploy-model change (`wrangler versions`); machine-asserted tail parsing; `__WB_MANIFEST` body parsing; any endpoint/middleware/env/SW code change; Supabase staging branch.

## Architecture / Approach

One `playwright.config.ts`, branched on `SMOKE_DEPLOYED`: when set, `baseURL` → live URL, `webServer` omitted, projects point at a deployed setup (prod ephemeral user, sign-in via live UI) → deployed spec → teardown (cascade-delete). A thin `scripts/smoke-deployed.mjs` wraps the run with `wrangler tail` → log file. Positive oracles throughout (`201 {id}`, `200 + camelCase body`, `204`, `200` + JS content-type).

## Phases at a Glance

| Phase                          | What it delivers                                           | Key risk                                                       |
| ------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Harness + cheap HTTP probes | Config branch, tail-capturing script, unauthenticated rung | Config branching accidentally triggers the localhost webServer |
| 2. Authenticated round-trip    | Ephemeral prod user, create→put→delete with body oracles   | Leftover prod state if cleanup fails mid-run                   |
| 3. Docs & gate registration    | §6.5 cookbook, §5 gate enforced, lessons pointer, close    | Docs drift from the implemented script                         |

**Prerequisites:** `.env.smoke` with prod `SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`; a deploy reflecting the commit under test on the live Worker; pinned `wrangler` 4.90 (present).
**Estimated effort:** ~2 sessions across 3 phases (Phase 1 + 2 are the bulk; Phase 3 is docs).

## Open Risks & Assumptions

- The runner has prod service-role access locally — required for the authenticated rung; without it, only the Phase 1 cheap rung runs.
- Writing an ephemeral user to **prod** Supabase is accepted (created + cascade-deleted per run; no persistent state).
- Tail evidence is read by a human — the gate is disciplined, not auto-enforced.

## Success Criteria (Summary)

- `npm run smoke:deployed` exits 0 against the current live deploy, asserting positive oracles on both rungs.
- The tail log shows every request `Ok` with no Node-API / `nodejs_compat` / undefined-env error.
- No leftover prod smoke user or `inspections` rows remain after a run.
