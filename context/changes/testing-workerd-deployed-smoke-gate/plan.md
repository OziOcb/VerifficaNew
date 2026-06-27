# Deployed workerd Smoke-Gate Implementation Plan

## Overview

Build a repeatable **deployed smoke-gate** (`npm run smoke:deployed`) that exercises the live Cloudflare Worker (`https://veriffica.veriffica.workers.dev`) the way real traffic does — POSTing to `/api/inspections/{create,sync}` and fetching the service-worker assets — with `wrangler tail` capturing runtime evidence for human review. It protects against **Risk #5**: an SSR endpoint, the service worker, or env/secret access diverging on deployed `workerd` vs `astro dev`, building clean but failing only on the live Worker.

The gate uses **positive oracles** (`201 {id}`, `200 + camelCase body field`, `204`, `200 + JS content-type`) — never merely "no 500" — because the dominant historical failure (empty secret) degrades to a quiet `503`, and a dropped SW degrades to a `404`. It runs the **real runtime** (the divergence _is_ the risk) and is a **manual / break-glass script** run by a human post-deploy, matching how the 2026-06-01 and S-02 smokes were actually done.

## Current State Analysis

- **Endpoints are clean today but cleanliness is invisible to the build** (`research.md` §A). `create.ts` and `sync.ts` reach Supabase only over `fetch`; `dexie` (the one library with no workerd global) is kept out of both import graphs. The risk is structural: a transitive SSR dep (`@supabase/ssr`, `camelcase-keys`, `snakecase-keys`, `zod`) that initializes lazily can pull a Node built-in not covered by `nodejs_compat` and throw **only when the endpoint is invoked on the deployed Worker**. `sync`'s import graph is richer than `create`'s — both must be probed.
- **Secrets are `optional: true`** (`astro.config.mjs:68-73`) → a missing/empty secret makes `createClient()` return `null` and the endpoints answer a silent `503`, not a crash (`src/lib/supabase.ts:7-9`). This is the 2026-06-01 foot-gun (`wrangler secret put` over a non-TTY pipe uploads an empty secret).
- **No post-deploy hook exists.** Production deploys are owned entirely by **Cloudflare Workers Builds** on push to `main`; `.github/workflows/ci.yml` is **PR-only** (lint + build + RLS test), no deploy step, no push trigger. `observability.enabled: true` (`wrangler.jsonc:12-14`) makes `wrangler tail` work against the live Worker.
- **Playwright harness exists but targets localhost.** `playwright.config.ts:44-52` boots `npm run build && npx wrangler dev --port 4322`; `BASE_URL` is `http://localhost:4322`. Every spec targets localhost; none targets the live URL. `auth.setup.ts` creates a confirmed user via the **service-role admin client**, signs in through the real UI (SSR middleware sets the cookie), persists `storageState`, and `auth.teardown.ts` cascade-deletes the user.
- **SW is build-only.** `/sw.js` registers only under `import.meta.env.PROD` (`Layout.astro:44`); precache globs cover static client assets only (`astro.config.mjs:35`), `navigateFallback: undefined` (`:39`).

## Desired End State

A developer (or agent, where permitted) can, after a deploy to `main` reaches the live Worker, run a single command:

```
npm run smoke:deployed
```

…which (1) starts `wrangler tail` against the live Worker, writing logs to a file; (2) runs the Playwright **deployed-smoke** project against the live URL — cheap unauthenticated HTTP probes plus an authenticated create→put→delete round-trip using an ephemeral, self-cleaning prod Supabase user; (3) stops tail and prints the log path. A green run + a clean tail log (no Node-API / `nodejs_compat` / undefined-env errors) is the parity confirmation. The §5 quality-gate row "deployed workerd smoke" is enforced (`required after §3 Phase 4`), and §6.5 cookbook documents how to add/extend it.

**Verification:** `npm run smoke:deployed` exits 0 against the current live deploy; the tail log shows every request `Ok` with no Node-API/undefined-env error; no leftover prod test user or rows remain after the run.

### Key Discoveries:

- The cheapest signal is pure unauthenticated HTTP: `GET /sw.js`, `GET /manifest.webmanifest`, and `POST /api/inspections/sync` with invalid JSON → `400` (`research.md` §A4, §C cheapest-signal note). No DB, no auth.
- The authenticated round-trip must hit **production** Supabase — the deployed Worker uses prod secrets, so a staging branch would not exercise the real path (`research.md` Open Q2; confirmed in planning).
- The 2-per-owner cap means a `create` makes one draft row and a `sync put` on that same `entityId` upserts it (not a new row) — within cap. A `sync delete` on it both cleans up and exercises the `204` path (`research.md` §A2).
- A current-year Part 1 config in the `put` payload guards the frozen-module-clock regression (`research.md` §3.3 / `part1-config.ts:69-78`).
- Signing in through the **live UI** exercises the edge cookie/`getUser()` round-trip — a `401` there signals the cookie leg diverged, not endpoint logic (`research.md` §A3, §3.5).
- `playwright.config.ts` already loads `.env` via `loadEnv` into `process.env`; the deployed smoke needs **prod** creds from a separate source instead.

## What We're NOT Doing

- **No automated CI gate.** No `on: push:[main]` job, no Cloudflare webhook → `repository_dispatch`, no live-URL polling, no Cloudflare API token in GitHub secrets. (Execution model (b) chosen; (a)/(c)/(d) explicitly deferred.)
- **No deploy-model change.** No `wrangler versions upload`/promote flow; Workers Builds keeps owning deploy.
- **No machine-asserted tail parsing.** Tail output is human-reviewed evidence, not a programmatic oracle (no log-pattern matching, no Cloudflare API token requirement).
- **No `__WB_MANIFEST` body parsing.** The SW oracle is status + content-type only (not coupled to Workbox output format).
- **No changes to the endpoints, middleware, env schema, or SW config.** This change is test/harness/docs only.
- **No Supabase preview/staging branch infrastructure.**

## Implementation Approach

Reuse the existing Playwright harness rather than building a standalone script: add a **deployed-smoke** Playwright project gated by an env flag (`SMOKE_DEPLOYED`). When the flag is set, `playwright.config.ts` swaps `baseURL` to the live URL and **omits `webServer`** (no local build/`wrangler dev`), and a deployed-specific setup creates the ephemeral user against **prod** Supabase and signs in through the live UI. A thin `npm run smoke:deployed` wrapper orchestrates `wrangler tail` around the Playwright run.

Build incrementally: Phase 1 lands the harness + the no-auth rung (immediate signal, no prod-user cost). Phase 2 adds the authenticated round-trip + its self-cleaning lifecycle. Phase 3 documents and registers the gate.

## Critical Implementation Details

- **Prod credential source.** `playwright.config.ts` currently loads `.env` (local Supabase) into `process.env`. The deployed smoke must instead read prod `SUPABASE_URL` / `SUPABASE_KEY` (anon) / `SUPABASE_SERVICE_ROLE_KEY` from a separate gitignored file (`.env.smoke`) when `SMOKE_DEPLOYED` is set — otherwise the ephemeral user would be created in the wrong project. Ship a committed `.env.smoke.example`; never commit real prod keys.
- **Config branching, not a second config file.** Keep one `playwright.config.ts`; branch internally on `process.env.SMOKE_DEPLOYED`. When set: `baseURL = SMOKE_URL ?? "https://veriffica.veriffica.workers.dev"`, `webServer: undefined`, and the project list points at the deployed setup/teardown. This avoids the localhost `webServer` (build + `wrangler dev`) firing during a deployed run.
- **Tail lifecycle ordering.** Start `wrangler tail` _before_ the Playwright run so the smoke's requests are captured, and stop it after. `wrangler tail` is interactive/long-running — launch it backgrounded to a log file and kill it on exit (including on failure) so a failed smoke still leaves a readable tail log.
- **Cleanup must be resilient.** Persist the created user's id/email to a sidecar before any probe (mirror `auth.setup.ts:31`) so teardown can cascade-delete even if a probe fails mid-run. The `sync delete` op is the primary row cleanup; the teardown user-delete is the backstop.

## Phase 1: Harness + Cheap HTTP Probes

### Overview

Stand up the deployed-smoke harness (config branching + `npm run smoke:deployed` wrapper with tail capture) and the unauthenticated rung. This rung needs no Supabase user, so it delivers an immediate workerd-init + dropped-SW signal on its own.

### Changes Required:

#### 1. Playwright config — deployed-smoke branch

**File**: `playwright.config.ts`

**Intent**: When `SMOKE_DEPLOYED` is set, target the live Worker instead of localhost and skip the local web server, so the same harness can smoke the deployed runtime.

**Contract**: Branch on `process.env.SMOKE_DEPLOYED`. When set: `baseURL = process.env.SMOKE_URL ?? "https://veriffica.veriffica.workers.dev"`; `webServer` is omitted; the `projects` array uses the deployed setup/teardown + a `deployed` test project (`testMatch` the new spec). When unset: behavior is unchanged (existing localhost e2e). Load prod creds from `.env.smoke` (via `loadEnv`/dotenv) only in the `SMOKE_DEPLOYED` branch.

#### 2. Prod credential template

**File**: `.env.smoke.example` (new), `.gitignore`

**Intent**: Document the prod creds the deployed smoke needs without committing secrets.

**Contract**: `.env.smoke.example` lists `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and optional `SMOKE_URL`. Add `.env.smoke` to `.gitignore`.

#### 3. Deployed-smoke spec — unauthenticated probes

**File**: `tests/e2e/deployed-smoke.spec.ts` (new)

**Intent**: Assert the cheapest workerd-init signals with positive oracles, no auth, no DB.

**Contract**: Using Playwright's `request` fixture against `baseURL`:

- `GET /sw.js` → `200`, `content-type` is JavaScript.
- `GET /manifest.webmanifest` → `200`.
- `GET /` → `200`.
- `POST /api/inspections/sync` with a non-JSON body → `400` ("Invalid JSON body").
- `POST /api/inspections/sync` (or `/create`) unauthenticated → `401`.

#### 4. Smoke orchestration script + npm script

**File**: `scripts/smoke-deployed.mjs` (new), `package.json`

**Intent**: One command that captures `wrangler tail` evidence around the Playwright deployed run.

**Contract**: `npm run smoke:deployed` runs `node scripts/smoke-deployed.mjs`. The script: starts `npx wrangler tail` backgrounded to a timestamped log file under a scratch/`smoke-logs/` path; runs `SMOKE_DEPLOYED=1 npx playwright test --project deployed` (and its setup); stops tail on exit (success or failure); prints the tail log path and a one-line "review tail for Node-API/undefined-env errors" reminder. Propagate the Playwright exit code.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type checking passes (via lint's type-checked rules / `npx astro sync` clean)
- `npm run smoke:deployed` runs the unauthenticated probes against the live Worker and exits 0
- A tail log file is produced at the printed path and is non-empty

#### Manual Verification:

- Tail log shows the smoke's requests as `Ok` with no `nodejs_compat` / Node-API / undefined-env errors
- `GET /sw.js` returns real JS (Workbox SW), not the 404 page
- Running without `SMOKE_DEPLOYED` still runs the existing localhost e2e unchanged (no regression)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the deployed run + tail review were successful before proceeding.

---

## Phase 2: Authenticated Round-Trip Rung

### Overview

Add the strong rung: an ephemeral, self-cleaning prod Supabase user drives a full `create → put → delete` round-trip with positive body oracles, exercising the SSR dep graph, the secret path, the edge cookie leg, and the frozen-module-clock guard.

### Changes Required:

#### 1. Deployed auth setup/teardown

**File**: `tests/e2e/deployed-auth.setup.ts` (new), `tests/e2e/deployed-auth.teardown.ts` (new)

**Intent**: Create a confirmed user against **prod** Supabase, sign in through the live UI (exercising the edge cookie/`getUser()` leg), persist `storageState`, and cascade-delete the user afterward.

**Contract**: Mirror `auth.setup.ts` / `auth.teardown.ts` but resolve Supabase env from the prod source (`.env.smoke`) and `page.goto` the live `/auth/signin`. Persist user id/email to a sidecar before any probe so teardown can delete even on mid-run failure. Reuse `tests/helpers/supabase.ts` (`createConfirmedUser` + admin delete) pointed at prod creds.

#### 2. Authenticated round-trip in the deployed spec

**File**: `tests/e2e/deployed-smoke.spec.ts`

**Intent**: Drive the real client→server sync path on the live Worker with positive oracles and clean up the row.

**Contract**: Using the authenticated `storageState` context:

- `POST /api/inspections/create` → `201` with body `{ id }` (non-empty).
- `POST /api/inspections/sync` `{ op: "put", entityId: id, payload }` where `payload` carries a **current-year** Part 1 config → `200` with a **camelCase** body field reflecting the authoritative row (guards the casing transform AND the module-clock regression — a current-year value must not be rejected as an invalid year).
- `POST /api/inspections/sync` `{ op: "delete", entityId: id }` → `204` (cleans the row and exercises the delete path).

#### 3. Wire the authenticated project into the deployed run

**File**: `playwright.config.ts`

**Intent**: Make the `deployed` project depend on the deployed setup and trigger the teardown.

**Contract**: In the `SMOKE_DEPLOYED` branch, add `deployed-setup` (with `teardown: "deployed-teardown"`) and `deployed-teardown` projects; the `deployed` project gets `dependencies: ["deployed-setup"]` and `storageState` from the deployed auth file. Unauthenticated probes from Phase 1 may stay in the same spec but must use a fresh `request` context (no auth) for the `401` assertion.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- `npm run smoke:deployed` runs both rungs against the live Worker and exits 0
- The `create → put → delete` round-trip asserts `201 {id}`, `200 + camelCase body`, `204`

#### Manual Verification:

- After the run, the prod Supabase project has **no** leftover smoke user and **no** leftover `inspections` rows (verify via dashboard or admin query)
- Tail log shows the authenticated requests `Ok` with no Node-API/undefined-env errors
- The current-year config `put` is accepted (not rejected as invalid year), confirming no module-clock regression

**Implementation Note**: After this phase and automated verification, pause for manual confirmation (especially the no-leftover-prod-state check) before proceeding.

---

## Phase 3: Docs & Gate Registration

### Overview

Document the new gate so it's repeatable and register it as required, then close the change.

### Changes Required:

#### 1. Cookbook — Adding a deployed smoke-test

**File**: `context/foundation/test-plan.md` (§6.5)

**Intent**: Replace the "TBD — see §3 Phase 4" placeholder with the concrete pattern.

**Contract**: §6.5 documents: command (`npm run smoke:deployed`), prerequisites (`.env.smoke` with prod creds + service-role; run after a deploy reaches the live Worker), the two rungs and their positive oracles, the ephemeral self-cleaning user lifecycle, and the tail-evidence review step. Reference `tests/e2e/deployed-smoke.spec.ts` and `lessons.md` "Verify Cloudflare Workers runtime parity."

#### 2. Quality-gate status

**File**: `context/foundation/test-plan.md` (§5 table + §3 status)

**Intent**: Flip the deployed-smoke gate from planned to enforced and mark Phase 4 status.

**Contract**: The §5 row "deployed workerd smoke … required after §3 Phase 4" remains; update the §3 phase-status table row 4 to reflect implementation (`implementing`/`complete` per the status legend).

#### 3. Lessons pointer

**File**: `context/foundation/lessons.md`

**Intent**: Point the existing parity lesson at the now-existing repeatable gate.

**Contract**: Add a one-line reference under the "Verify Cloudflare Workers runtime parity" lesson noting `npm run smoke:deployed` is the repeatable realization of the rule. (Append-only; do not rewrite the lesson.)

#### 4. Close the change

**File**: `context/changes/testing-workerd-deployed-smoke-gate/change.md`, `context/foundation/roadmap.md` (if it tracks this phase)

**Intent**: Mark the change implemented.

**Contract**: Set `change.md` `status` and `updated`. (Archival is a separate `/10x-archive` step — not done here.)

### Success Criteria:

#### Automated Verification:

- Markdown lint/format passes (Prettier via lint-staged on commit)
- §6.5 no longer contains "TBD — see §3 Phase 4"

#### Manual Verification:

- A reader can follow §6.5 to run the smoke from scratch (creds setup → run → read tail)
- The §5/§3 status accurately reflects the gate being enforced

**Implementation Note**: Docs phase — agent self-verifies §6.5 reconciles against the implemented script (per lessons.md "Self-verify anything you can").

---

## Testing Strategy

### Unit Tests:

- None. This change adds a deployed smoke harness, not unit logic.

### Integration Tests:

- The deployed smoke spec _is_ the test artifact; it runs against the live Worker, not a mock (mocking workerd away is banned — the runtime divergence is the risk).

### Manual Testing Steps:

1. Populate `.env.smoke` from `.env.smoke.example` with **prod** Supabase URL, anon key, and service-role key.
2. Ensure the live Worker reflects the commit under test (deploy reached prod via Workers Builds).
3. Run `npm run smoke:deployed`; confirm exit 0.
4. Open the printed tail log; confirm all requests `Ok`, no Node-API/`nodejs_compat`/undefined-env errors.
5. In the prod Supabase dashboard, confirm no leftover smoke user / `inspections` rows.
6. Run the normal e2e (`npm run test:e2e`) to confirm no localhost regression.

## Performance Considerations

Negligible — a handful of HTTP requests against the live Worker per run. The run is manual/on-demand, not in the hot path. Tail adds one long-lived connection for the run's duration only.

## Migration Notes

None. No schema, data, or deploy-pipeline changes. The ephemeral prod user is created and deleted within each run; no persistent state is added to production.

## References

- Related research: `context/changes/testing-workerd-deployed-smoke-gate/research.md`
- Parity foot-guns + proven smoke shape: `context/archive/2026-06-01-deployment/deployment-plan.md:179-204,262-284`
- Lesson: `context/foundation/lessons.md:5-21` (runtime parity), `:47-66` (SW build-only)
- Harness to mirror: `tests/e2e/auth.setup.ts`, `tests/e2e/auth.teardown.ts`, `playwright.config.ts:44-52`
- Endpoints under test: `src/pages/api/inspections/create.ts:17-39`, `src/pages/api/inspections/sync.ts:18-67`
- Runtime config enabling tail: `wrangler.jsonc:12-14`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Harness + Cheap HTTP Probes

#### Automated

- [ ] 1.1 Lint passes: `npm run lint`
- [ ] 1.2 Type checking passes (astro sync clean / type-checked lint)
- [ ] 1.3 `npm run smoke:deployed` runs unauthenticated probes against the live Worker and exits 0
- [ ] 1.4 A non-empty tail log file is produced at the printed path

#### Manual

- [ ] 1.5 Tail log shows requests `Ok`, no Node-API/`nodejs_compat`/undefined-env errors
- [ ] 1.6 `GET /sw.js` returns real Workbox JS, not the 404 page
- [ ] 1.7 Running without `SMOKE_DEPLOYED` still runs the existing localhost e2e unchanged

### Phase 2: Authenticated Round-Trip Rung

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 `npm run smoke:deployed` runs both rungs against the live Worker and exits 0
- [ ] 2.3 Round-trip asserts `201 {id}`, `200 + camelCase body`, `204`

#### Manual

- [ ] 2.4 No leftover prod smoke user or `inspections` rows after the run
- [ ] 2.5 Tail log shows authenticated requests `Ok`, no Node-API/undefined-env errors
- [ ] 2.6 Current-year config `put` accepted (no module-clock regression)

### Phase 3: Docs & Gate Registration

#### Automated

- [ ] 3.1 Markdown lint/format passes
- [ ] 3.2 §6.5 no longer contains "TBD — see §3 Phase 4"

#### Manual

- [ ] 3.3 A reader can follow §6.5 to run the smoke from scratch
- [ ] 3.4 §5/§3 status accurately reflects the gate being enforced
