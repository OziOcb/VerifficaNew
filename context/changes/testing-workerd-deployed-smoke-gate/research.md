---
date: 2026-06-27T21:33:31+0100
researcher: OziOcb
git_commit: 8103132
branch: chore/open-workerd-smoke-gate-change
repository: veriffica-z-ai-2
topic: "Phase 4 — deployed workerd smoke-gate for SSR endpoints + service worker"
tags: [research, codebase, workerd, cloudflare, smoke-gate, sync-endpoint, service-worker, ci]
status: complete
last_updated: 2026-06-27
last_updated_by: OziOcb
---

# Research: Deployed workerd smoke-gate (test-plan Phase 4)

**Date**: 2026-06-27T21:33:31+0100
**Researcher**: OziOcb
**Git Commit**: 8103132
**Branch**: chore/open-workerd-smoke-gate-change
**Repository**: veriffica-z-ai-2

## Research Question

Ground, in the live codebase, what a repeatable **deployed `wrangler tail` smoke-gate** must exercise to protect against Risk #5: an SSR endpoint (`/api/inspections/{create,sync}`), the service worker, or env/secret access **diverging on the deployed Cloudflare `workerd` runtime vs `astro dev`** → silent production breakage. The gate must exercise the real runtime (the divergence _is_ the risk), not mock it away. Cover three angles: (a) the divergence surface, (b) how a gate wires into the Cloudflare-Workers-Builds pipeline, (c) the concrete parity failures already hit on this project.

**Scope decisions (confirmed with user):** weight all three angles; keep the gate's _execution model_ an **open survey** — research grounds the realistic options with tradeoffs; the choice belongs to `/10x-plan`.

## Summary

1. **The endpoints are clean today, but cleanliness is invisible to the build.** Both `create.ts` and `sync.ts` reach Supabase only over `fetch`, and the one library with no workerd global (`dexie`) is deliberately kept out of both import graphs. The risk is structural, not a known bug: a _transitive_ SSR dep (`@supabase/ssr`, `camelcase-keys`, `snakecase-keys`, `zod`) that initializes lazily can pull a Node built-in not covered by `nodejs_compat` and throw **only when the endpoint is invoked on the deployed Worker** — never during `astro build` or `astro dev`. So the gate must actually **POST to both endpoints** (their import graphs differ — `sync` pulls the casing libs + zod, `create` does not).

2. **The most likely silent failure is an empty/missing secret, and it fails _quietly_ as a `503` — not a crash.** `SUPABASE_URL`/`SUPABASE_KEY` are declared `optional: true` in the `env.schema` (`astro.config.mjs:68-73`), so a missing/empty secret makes `createClient()` return `null` and the endpoints answer `503`, with no exception. This is exactly the foot-gun the 2026-06-01 deployment hit (`wrangler secret put` over a non-TTY pipe uploads an _empty_ secret; `wrangler.jsonc` `vars` don't forward to `astro:env/server`). The gate must therefore assert a **positive 2xx with a real body field**, not merely "no 500".

3. **The pipeline has no post-deploy hook today.** Production deploys are owned entirely by **Cloudflare Workers Builds** on push to `main`; `.github/workflows/ci.yml` is a **PR-only** gate (lint + build + RLS test) with **no deploy step and no push trigger**. `observability.enabled: true` (`wrangler.jsonc:12-14`) means `wrangler tail` works against the live Worker. The Playwright harness already builds + boots the app via `wrangler dev` locally — but every existing spec targets `localhost`, none targets the live URL. Wiring a gate "between merge and prod" is therefore **net-new plumbing**, and the realistic execution models are surveyed in §Gate Execution Models.

## Detailed Findings

### A. The divergence surface (what the gate must catch)

#### A1. `/api/inspections/create` — server-authoritative draft create

- `POST`, **no request body** read; `201 → { id }` (`src/pages/api/inspections/create.ts:39`). Error ladder: `503` not-configured (`:19`), `401` unauth (`:22`), `409 inspection_limit_reached` from the 2-per-owner trigger (`:33-34`), `400` generic DB error (`:36`).
- Reads **no env directly**; secrets only via `createClient` (`:18`). Supabase call: `insert({ owner_id, status:"draft", name }).select("id").single()` (`:25-29`); `owner_id` from `context.locals.user.id` (session), `name` built from `new Date().toISOString()` **inside the handler** (`:24`) — so the workerd frozen-module-clock issue does not apply here.
- Imports (`:1-3`): `@/lib/inspections` (only `type-fest` + DB types — deliberately Dexie-free, `src/lib/inspections.ts:1-5`) and `@/lib/supabase`. **Clean import graph.**

#### A2. `/api/inspections/sync` — single sync boundary (`put`/`delete`)

- `POST`, body `SyncOp = { op:"put"|"delete", entityId, payload? }` (`src/pages/api/inspections/sync.ts:18-22`). Responses: `delete → 204` (`:42`) / `400` (`:41`); `put → 200` with `camelcaseKeys(authoritative row)` (`:67`) / `400` validation (`:55`) / `400` DB (`:65`); `400 "Invalid JSON body"` on parse failure (`:35`); `503` (`:26`); `401` (`:29`). `owner_id` is **server-stamped** from `user.id` (`:57`), never trusted from client.
- Imports (`:1-5`): `camelcase-keys`, `snakecase-keys`, `@/lib/supabase`, `@/lib/sync-payload-validation` → which imports `@/lib/part1-config` (`sync-payload-validation.ts:16`) → which imports `zod` (`part1-config.ts:14`). **Richer import graph than `create` — the reason both must be probed.**

#### A3. Env / secret access path

- Declared in `env.schema` (`astro.config.mjs:68-73`): `SUPABASE_URL` and `SUPABASE_KEY`, both `envField.string({ context:"server", access:"secret", optional:true })`. **`optional:true` is load-bearing** — missing secrets read `undefined`, they do not throw at boot.
- Read in `src/lib/supabase.ts:3` via `import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server"`; `createClient()` returns `null` when either is falsy (`:7-9`). Also read by `src/lib/config-status.ts` for the missing-config banner.
- Auth flow: `src/middleware.ts:6-16` builds a server client from `request.headers` + `context.cookies`, calls `supabase.auth.getUser()`, stamps `context.locals.user`. Cookie read/write via `parseCookieHeader` + `cookies.set` (`supabase.ts:13,18-21`). `PROTECTED_ROUTES = ["/dashboard","/inspections"]` (`middleware.ts:4`) — note **`/api/*` is not protected by middleware**; the endpoints self-guard with `401`.
- **Escape hatch on record** (lessons.md): if a value still reads `undefined`, import from `cloudflare:workers` instead of `astro:env/server`. The code uses `astro:env/server` only today — the prime env-divergence suspect.

#### A4. Service worker

- PWA config `astro.config.mjs:16-62`: `registerType:"autoUpdate"` (`:17`), `injectRegister:false` (`:20`), manifest name "Veriffica" (`:21-28`), Workbox `skipWaiting`/`clientsClaim` (`:32-33`), precache `globPatterns: ["**/*.{js,css,svg,png,ico,webmanifest}"]` (`:35`, **static client assets only — pages are SSR**), `navigateFallback: undefined` (`:39`, deliberately disabled; a regression reintroducing the default `"/"` would break the SW at startup), one NetworkFirst runtime rule excluding `/api`,`/auth`,`/dashboard` (`:40-60`).
- Registration `src/layouts/Layout.astro:41-49`: inline `navigator.serviceWorker.register("/sw.js")` on `window load`, **guarded by `import.meta.env.PROD` (`:44`)** → `/sw.js` exists and registers **only in the production build**, never under `astro dev`. Manifest link `Layout.astro:19`.
- **What "SW loads on the deployed Worker" means concretely:** `GET /sw.js → 200` + JS content-type, body contains the Workbox precache manifest (`self.__WB_MANIFEST` / non-empty entries); `GET /manifest.webmanifest → 200`. These are unauthenticated `ASSETS`-binding fetches (`wrangler.jsonc:7-11`) — the cheapest probe of all, no DB.

#### A5. Runtime config

- `wrangler.jsonc`: `compatibility_date "2026-05-08"` (`:5`), `compatibility_flags: ["nodejs_compat"]` (`:6`), `main "@astrojs/cloudflare/entrypoints/server"` (`:4`), `ASSETS → ./dist` `not_found_handling "404-page"` (`:7-11`), **`observability.enabled: true` (`:12-14`) — this is what makes `wrangler tail` emit logs.**
- `astro.config.mjs`: `output:"server"` (`:12`), `adapter: cloudflare()` called **with no options** (`:67`) — default behavior, no `platformProxy`/`imageService` overrides.

#### Divergence surface — builds clean, breaks only on the deployed Worker

1. **Transitive Node-API reach** in the SSR dep graph (lessons.md (a)) — throws only when an endpoint is invoked on the Worker; probe **both** endpoints (graphs differ).
2. **Empty/missing Worker secret** (lessons.md (b)/(c)) — `optional:true` makes it a silent `503`, not a crash. Local `astro dev` reads `.dev.vars` and looks healthy. ⇒ gate must assert a **positive 2xx + body field**.
3. **Frozen module-load clock on workerd** (Spectre mitigation, `part1-config.ts:69-78`) — already mitigated (lazy `currentYear()`, handler-local `new Date()`), but a _new_ module-level date on the endpoint path would re-break only on the Worker. A `put` of a current-year config that must not be rejected as an invalid year is a useful guard.
4. **SW emitted only by the production build** (`Layout.astro:44`) — a build/adapter regression dropping `/sw.js` or emptying the precache manifest is invisible until you `GET /sw.js` on the deployed Worker.
5. **Session cookie round-trip on the edge** — a `401` on an authenticated request signals the cookie/`getUser()` leg diverged, not the endpoint logic.

### B. Gate-wiring mechanics (how a gate runs)

- **CI today** (`.github/workflows/ci.yml`): triggers on **PRs into `main` only** (`:7-8`), **no push trigger, no deploy step**. Two jobs: `ci` (Node 22; `npm ci → npx astro sync → npm run lint → npm run build`, with `SUPABASE_URL`/`SUPABASE_KEY` GitHub secrets at build time, `:19-25`) and `db-test` (spins up local Supabase via Docker, exports `SUPABASE_SERVICE_ROLE_KEY`, runs `npm test` for RLS isolation, `:30-59`). **`npm run test:e2e` is not in CI** — it only runs locally.
- **Deploy** is owned by **Cloudflare Workers Builds** on push to `main` (Cloudflare runs `npm run build → npx wrangler deploy`). Manual break-glass is the `/deploy-cf` skill. Production secrets are real Wrangler secrets, not `vars`.
- **Existing harness:** `playwright.config.ts:44-52` boots `npm run build && npx wrangler dev --port 4322` (separate from `astro dev`'s 4321 to avoid SW hijack). `BASE_URL` is `http://localhost:4322` — **every spec targets localhost; none targets the live URL.** `wrangler` v4.90.0 is pinned (`package.json:73`). **No existing use of `wrangler tail`, `wrangler versions upload`, or `wrangler deploy` in scripts.**
- **Auth for an authenticated deployed probe:** `tests/e2e/auth.setup.ts` creates a confirmed user via the **service-role admin client** (`:27`), signs in through the real UI so the SSR middleware sets the cookie (`:34-39`), and persists `storageState` (`:42`). Needs `SUPABASE_URL` + `SUPABASE_KEY` (anon) + `SUPABASE_SERVICE_ROLE_KEY` (`tests/helpers/supabase.ts:12-22`). Against the **live** Worker this implies a confirmed test user in the **production** Supabase project (or a preview/staging branch) and a cleanup path (the 2-per-owner cap means rows must be self-deleted; `auth.teardown.ts` cascade-deletes the user as a backstop).

#### Inventory — exists vs missing

| Exists today                                                                                                                                                                                                                | Missing to build the gate                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI scaffolding (`ci.yml`); Playwright + auth setup; SW-via-`wrangler dev` pattern; pinned `wrangler` 4.90; `observability.enabled:true`; GitHub Supabase secrets; `/deploy-cf` skill; both endpoints ready; lessons.md rule | Push-to-`main` / post-deploy trigger; a spec (or config) targeting the **live URL** not localhost; any `wrangler tail` integration; production test-user lifecycle + row cleanup; non-interactive `wrangler secret` handling if CI ever rotates secrets |

### C. Gate Execution Models (open survey — for `/10x-plan` to choose)

Cloudflare Workers Builds owns deploy, and it does **not** emit a GitHub webhook by default — that constraint shapes every option.

| Model                                                                        | How it runs                                                                                                                     | Pros                                                                                                             | Cons / what it needs                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) Post-merge GitHub Actions job** (`on: push: [main]`)                   | After Workers Builds deploys, a job waits for the live URL to be ready, runs a deployed-smoke spec + `wrangler tail` assertions | True "between merge and prod" gate; reuses Playwright + GitHub secrets                                           | No deploy-done signal (must poll the live URL or wire a Cloudflare webhook → `repository_dispatch`); needs a prod/preview test user + cleanup; tail auth (Cloudflare API token) in CI |
| **(b) Repeatable manual / break-glass script** (`npm run smoke:deployed`)    | A human runs it against the live URL post-deploy; Playwright spec + optional parallel `wrangler tail`                           | Smallest new surface; matches how the 2026-06-01 + S-02 smokes were actually done (by hand); no webhook plumbing | Not an automated gate (relies on discipline); still needs a live-URL spec and a documented oracle                                                                                     |
| **(c) Preview version smoked before promotion** (`wrangler versions upload`) | Build → upload a non-prod version → smoke its preview URL → promote with `wrangler versions deploy`                             | Catches divergence **before** prod traffic; closest to a real "gate" semantically                                | Conflicts with Workers-Builds-owns-deploy (would change the deploy model); needs URL extraction from wrangler output; preview Supabase env                                            |
| **(d) Observability MCP / scheduled check**                                  | An agent queries the Cloudflare Workers Observability MCP for error patterns on the live Worker                                 | Read-only; zero deploy-model change                                                                              | Observes existing traffic rather than driving a deterministic smoke; not a pre-prod gate; MCP not yet configured                                                                      |

**Cheapest-signal note (test-plan §1 principle):** the SW + "invalid JSON → 400" probes are pure unauthenticated HTTP and give a real workerd-init signal with no DB mutation and no auth — they are the cheapest first rung. The authenticated `create`/`put` round-trip is the stronger signal but carries the test-user + cleanup cost. A plan can stage these (cheap HTTP probes always; authenticated round-trip where the auth lifecycle is affordable).

## Code References

- `src/pages/api/inspections/create.ts:17-39` — create contract, error ladder, handler-local `new Date()`
- `src/pages/api/inspections/sync.ts:18-67` — `SyncOp` shape, put/delete paths, server-stamped `owner_id`, camel/snake transform
- `src/lib/supabase.ts:3-24` — `astro:env/server` import, `createClient()` null path, cookie read/write
- `src/middleware.ts:4-21` — session stamping, `PROTECTED_ROUTES` (no `/api/*`)
- `src/lib/config-status.ts` — second reader of the two secrets (missing-config banner)
- `astro.config.mjs:16-62` — `@vite-pwa/astro` Workbox config (`navigateFallback: undefined`, precache globs)
- `astro.config.mjs:67-73` — bare `cloudflare()` adapter; `env.schema` with `optional:true` secrets
- `src/layouts/Layout.astro:19,41-49` — manifest link + `import.meta.env.PROD`-guarded `/sw.js` registration
- `wrangler.jsonc:4-14` — `nodejs_compat`, `ASSETS` binding, `observability.enabled:true`
- `.github/workflows/ci.yml:7-59` — PR-only gate, no deploy/push trigger
- `playwright.config.ts:44-52` — `build && wrangler dev` web server, localhost `BASE_URL`
- `tests/e2e/auth.setup.ts:27-42` / `tests/helpers/supabase.ts:12-22` — service-role user creation + env requirements

## Architecture Insights

- **The build is a blind spot by design.** `astro build` succeeds regardless of (1) lazy Node-API reach in transitive deps, (2) empty secrets, (3) module-clock assumptions, (4) a dropped SW asset. All four only surface at runtime _on the deployed Worker_. This is precisely why the test-plan files Risk #5 as a deployed smoke-gate and bans mocking workerd away.
- **"No 500" is an insufficient oracle.** The dominant historical failure (empty secret) degrades to a quiet `503`, and a mis-emitted SW degrades to a `404` — both are 2-class HTTP errors, not exceptions. The gate's oracle must be **positive**: `201 + {id}`, `200 + camelCase body field`, `200 + non-empty precache manifest`.
- **Single server boundary is the leverage point.** Because `SUPABASE_KEY` is server-only and there is no browser Supabase client, _all_ client→server sync flows through `/api/inspections/sync` — smoking that one endpoint exercises the entire offline-write→cloud path's runtime dependencies.
- **The deploy model constrains the gate shape.** Workers-Builds-owns-deploy + no webhook is the single biggest design constraint; it pushes options toward (a) polling or (b) manual, and makes (c) a deploy-model change rather than an add-on.

## Historical Context (from prior changes)

- `context/archive/2026-06-01-deployment/deployment-plan.md:179-204` — the original parity foot-guns, caught and mitigated: **empty-secret-from-non-TTY** (`printf '%s' "<value>" | npx wrangler secret put NAME`, verify with `wrangler secret list`) and **`wrangler.jsonc` `vars` not forwarding to `astro:env/server`** (sidestepped by using real `wrangler secret put`; last-resort import from `cloudflare:workers`).
- `context/archive/2026-06-01-deployment/deployment-plan.md:262-284` — Phase 6 smoke (the proven gate shape): `curl -I / → 200`; `/dashboard` logged-out `→ 302 /auth/signin` (proves middleware + non-null `createClient`); full auth round-trip; `npx wrangler tail` during it showed every request `Ok`, **no nodejs_compat/Node-API errors, no undefined env**.
- `context/archive/2026-06-11-offline-first-persistence-layer/change.md:36-43` — F-02's deferred check **4.8** (deployed `wrangler tail` parity smoke of `/api/inspections/sync`), deferred because the `inspections` table wasn't on hosted Supabase until S-02.
- `context/foundation/roadmap.md:111,137-139` — F-02 `implemented`; **4.8 closed by S-02 on 2026-06-14**: after `npx supabase db push` of F-01+F-02 migrations to hosted Supabase, `npx wrangler tail` showed **clean `/api/inspections/{create,sync}` round-trips with no Node-API runtime error**. (DB migrations are not in the Cloudflare deploy pipeline — a slice must `db push` before its UI ships.)
- `context/foundation/lessons.md:5-21` — "Verify Cloudflare Workers runtime parity on the live URL": the canonical (a)/(b)/(c) failure taxonomy and the `wrangler tail` rule. `:47-66` — "Service worker is build-only — test with `wrangler dev`, never `astro dev`/`preview`."
- `context/foundation/infrastructure.md:101-130,166-180` — Risk #1 (Node-only API on workerd) + pre-mortem; `wrangler tail` and the **Cloudflare Workers Observability MCP** (`observability.mcp.cloudflare.com/mcp`) as read-only log access; an agent may tail/preview unattended but promoting to prod needs a human.

## Related Research

- `context/archive/2026-06-27-testing-sync-endpoint-server-trust/research.md` — Phase 3; the server-trust boundary of the same `sync` endpoint (verdict-first house style mirrored here).
- `context/archive/2026-06-24-testing-offline-durability/research.md` — Phase 2; the offline write→reconnect flow whose cloud leg this gate's runtime exercises.
- `context/archive/2026-06-11-offline-first-persistence-layer/research.md:36-95` — F-02; why the single server sync boundary exists (no browser Supabase client).

## Open Questions

1. **Execution model** — which of §C (a)/(b)/(c)/(d) (or a hybrid: cheap HTTP probes automated + authenticated round-trip manual)? This is the central design decision deferred to `/10x-plan`.
2. **Test-user lifecycle against production Supabase** — is there an appetite for a dedicated smoke user (and row cleanup under the 2-per-owner cap) in the prod project, or should the gate use a Supabase preview/staging branch? Without this, the authenticated `create`/`put` rung can't run automatically.
3. **Deploy-done signal** — for option (a), poll the live URL for readiness, or invest in a Cloudflare webhook → `repository_dispatch`? Polling is cheaper and needs no Cloudflare-side config.
4. **`wrangler tail` in CI auth** — tailing the live Worker non-interactively needs a Cloudflare API token in GitHub secrets; confirm that token's scope/availability before assuming option (a) is buildable.
5. **Oracle for the SW precache assertion** — assert `GET /sw.js → 200` + JS content-type only, or additionally parse the body for a non-empty `__WB_MANIFEST`? The latter catches the "emitted but empty" regression but couples the test to Workbox output format.
