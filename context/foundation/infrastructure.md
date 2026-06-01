---
project: Veriffica
researched_at: 2026-06-01
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 (output "server") + React 19
  runtime: Cloudflare workerd (V8 isolates)
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare scores a clean 5/5 against the agent-friendly criteria, is edge-native
(directly serving the "global / latency matters" requirement), and ships the most
mature agent tooling of any candidate (16 official MCP servers plus a Workers
observability MCP). Decisively, it is the runtime the stack already targets — Astro 6
runs on `workerd` both locally (`astro dev`) and in production, so there is no
runtime-parity gap between dev and deploy. The generous free tier (100k requests/day
per script) covers an MVP at the PRD's "medium users / low QPS" scale at zero cost,
and Supabase Auth/Postgres over `fetch` works cleanly from the isolate runtime, so
keeping data external (interview Q5) costs nothing here.

## Platform Comparison

| Platform               | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP/Integration | Total   |
| ---------------------- | --------- | ------------------ | ---------- | ----------------- | --------------- | ------- |
| **Cloudflare Workers** | Pass      | Pass               | Pass       | Pass              | Pass            | **5/5** |
| **Vercel**             | Pass      | Pass               | Pass       | Pass              | Pass            | 5/5\*   |
| **Netlify**            | Pass      | Pass               | Pass       | Pass              | Pass            | 5/5\*   |
| **Fly.io**             | Pass      | Partial            | Pass       | Pass              | Fail            | ~3      |
| **Railway**            | Pass      | Pass               | Partial    | Pass              | Partial         | ~3.5    |
| **Render**             | Partial   | Pass               | Partial    | Pass              | Fail            | ~2.5    |

\* Vercel and Netlify tie on the five criteria but lose on the interview-driven soft
weights (see notes).

**Cloudflare Workers** — `wrangler` covers the full operational loop (deploy, secrets,
rollback, tail logs) headlessly. The runtime is fully managed isolates (no OS, no
Dockerfile). Docs publish `llms.txt` and markdown source on GitHub. `wrangler deploy`
is deterministic and returns a URL. MCP coverage is the broadest in the field. The only
deductions are caveats, not criterion failures: `workerd` is not Node, and the free
tier caps CPU at 10ms/request.

**Vercel** — Excellent DX, official OAuth-backed MCP, MDX docs on GitHub. Two soft-weight
penalties: (1) the free **Hobby** tier explicitly **prohibits commercial use**, so a
real launch needs Pro at $20/user/mo; (2) Astro SSR deploys as **regional** serverless
functions with 200–500ms cold starts — weaker on the "global edge" requirement (Q4)
than Cloudflare's isolates.

**Netlify** — Official MCP, clean adapter maintained by the Astro team, deploy previews
built in. Penalized on (1) the worst measured cold starts of the trio (800ms–1.5s) and
(2) a 2025 shift to opaque **credit-based billing** that makes cost hard to predict at
MVP — a poor fit for a solo, after-hours budget.

**Fly.io** — Strong `flyctl` CLI and persistent processes (not needed here, per PRD).
Dropped on: requires a Dockerfile (more operational surface, against the "managed"
preference), **no free tier for new users** as of 2026, and **no official MCP**. The
multi-region story is real but you manage the regions yourself.

**Railway** — Good `railway` CLI and nixpacks (no Dockerfile). Dropped on: **no free
tier** (one-time $5 trial credit only), **no global edge** (single-region standard
runtime), only community MCP wrappers, and its headline co-located-DB advantage is
neutralized because Veriffica uses Supabase (Q5 = external fine).

**Render** — Real no-credit-card free tier, but the free web service **spins down after
15 min** (30–50s cold start on next visit) — impractical for an SSR app. CLI is thinner
(API/deploy-hooks led), single region, no MCP. Lowest score.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on every criterion and on the two interview weights that discriminate here: global
edge (Q4) and a zero-cost path at MVP scale (Q2's cost half). Uniquely, it removes a
class of bug the serverless alternatives keep — there is no dev/prod runtime mismatch
because `astro dev` already runs on `workerd`. Strongest agent ergonomics via the
official MCP fleet. It is also the path the stack was scaffolded for.

#### 2. Vercel

The closest on raw criteria and arguably the smoothest DX, with a first-class official
MCP. It loses because the free tier can't be used commercially (so a launch costs
$20/mo) and because Astro SSR on Vercel is regional serverless with cold starts —
materially weaker for the global-latency requirement than Cloudflare's edge isolates.

#### 3. Netlify

Also 5/5 on criteria with an official MCP and the Astro-team-maintained adapter. The gap
versus the recommendation is operational economics: the worst cold starts of the three
edge platforms and a credit-based billing model that is hard to reason about for a
solo MVP budget.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **`workerd` is V8 isolates, not Node.** An SSR-path npm dependency that reaches for
   `fs`, `net`, native `crypto`, or Node streams can build successfully yet throw at
   runtime. Requires the `nodejs_compat` flag, and transitive dependencies are the real
   exposure.
2. **10ms CPU per request on the free tier.** Veriffica's heavy recompute (Total Score,
   Smart Pruning, Part 1 validation) is client-side so it's safe — but any future
   server-side bulk operation could hit the CPU ceiling.
3. **Astro 6 changed the Cloudflare build/env model.** The Astro 5 `wrangler deploy
--env <env>` flow is gone; the environment is now fixed at build time
   (`CLOUDFLARE_ENV=<env> astro build`). Misconfiguring preview vs prod in CI is easy.
4. **Pages-vs-Workers drift.** `tech-stack.md` records `cloudflare-pages`, but Astro 6
   and Cloudflare's own current guidance route new projects to **Workers (Static
   Assets)**; Pages is in maintenance. Building on Pages-only primitives is a dead end.
5. **Supabase can't pool TCP from Workers.** Auth/PostgREST over `fetch` is fine, but a
   future need for direct Postgres connection pooling would force Hyperdrive or
   Supabase's pooler.

### Pre-Mortem — How This Could Fail

The team shipped the offline PWA to Cloudflare and it worked in demos. Then the slow
bleed began. A validation/date library pulled a transitive Node `crypto` dependency — it
built clean, and `astro dev` (also `workerd`) never exercised the failing path, so it
surfaced only as intermittent production 500s. CI had been wired on the Astro 5 mental
model (`--env preview`); after the Astro 6 bump it silently shipped prod Supabase keys
into preview builds. Dashboard preview links were built assuming Cloudflare Pages
branch-previews, then had to be re-wired once reality turned out to be Workers with a
different preview model. Finally, a server-side bulk recompute tripped the 10ms
free-tier CPU ceiling under the only occasional real load. No single fatal flaw — but
each cost an after-hours debugging session against a `workerd` ≠ Node gap that local
dev had hidden, and the cumulative drag blew the loose, after-hours-only timeline.

### Unknown Unknowns

- **`astro dev` already runs on `workerd` in Astro 6** — there is no separate `wrangler
dev` needed for runtime fidelity. The common "test locally with wrangler" advice is
  legacy for this stack (CLAUDE.md already reflects this).
- **Treat `cloudflare-pages` as "Cloudflare Workers."** Workers Static Assets supersedes
  Pages for new Astro projects; don't invest in Pages-only features.
- **Secrets live in two local files** (`.env` for the Supabase CLI, `.dev.vars` for
  `workerd`) and as **Wrangler secrets** in production — not Pages env vars. Mismatch is
  the classic foot-gun here.
- **The free tier is 100k requests/day _per script_, not per account.** Generous for one
  Worker, but the unit matters if you ever split into multiple Workers.
- **`workerd` local ≠ 100% production parity** for some edge APIs (cache, certain
  headers). The service worker is client-side so it's unaffected, but SSR-set
  cookies/headers (the Supabase Auth session) deserve a real-preview test before launch.

## Operational Story

- **Preview deploys**: `wrangler versions upload` produces a preview URL (a
  version-preview alias) without promoting to production; branch/PR previews wire through
  GitHub Actions calling that command. Preview Workers are public by default — gate
  sensitive previews behind **Cloudflare Access** if needed. Fork PRs won't have repo
  secrets, so their preview builds will lack Supabase keys (expected).
- **Secrets**: production `SUPABASE_URL` / `SUPABASE_KEY` are **Wrangler/Cloudflare
  secrets** (`wrangler secret put SUPABASE_KEY`), readable only by account members with
  access. Locally they live in `.dev.vars` (workerd) and `.env` (Supabase CLI). Rotate by
  re-running `wrangler secret put` and redeploying; rotate the Supabase key from the
  Supabase dashboard.
- **Rollback**: `wrangler rollback [<version-id>]` reverts to a prior deployed version,
  typically in seconds. Caveat: code rolls back, **Supabase schema/auth changes do not** —
  any DB-side change must be reverted separately in Supabase.
- **Approval**: an agent may deploy previews and tail logs unattended. Promoting a
  version to production (`wrangler deploy` / `wrangler versions deploy`), rotating the
  primary Supabase secret, or any destructive Supabase action should require a human.
- **Logs**: `wrangler tail` streams live runtime logs read-only; the **Cloudflare Workers
  Observability MCP server** (`observability.mcp.cloudflare.com/mcp`) exposes logs and
  analytics as typed agent tools. GitHub Actions run logs are read via `gh run view`.

## Risk Register

| Risk                                                                      | Source                      | Likelihood | Impact | Mitigation                                                                                                                      |
| ------------------------------------------------------------------------- | --------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| SSR dependency uses a Node-only API and throws at runtime on `workerd`    | Devil's advocate            | M          | H      | Enable `nodejs_compat`; prefer Web-standard/isomorphic libs; exercise SSR paths on a real Workers preview, not just `astro dev` |
| CI ships wrong env vars after Astro 6 build-time env change               | Pre-mortem                  | M          | H      | Build per-environment with `CLOUDFLARE_ENV`; separate preview vs prod secret scopes; assert env in a CI smoke step              |
| Built on Pages-only features that are EOL'd                               | Unknown unknowns            | L          | M      | Standardize on Workers (Static Assets); read `cloudflare-pages` in tech-stack as "Workers"                                      |
| Local/prod secret mismatch across `.env` / `.dev.vars` / Wrangler secrets | Unknown unknowns            | M          | M      | Keep `.env.example` authoritative; document the three locations; null-check `createClient()` (already in middleware)            |
| 10ms free-tier CPU ceiling hit by future server-side work                 | Devil's advocate            | L          | M      | Keep recompute client-side (already the design); upgrade to Workers Paid ($5/mo, 30M CPU ms) if server work grows               |
| SSR-set auth cookies/headers behave differently on edge than locally      | Unknown unknowns            | L          | M      | Test Supabase Auth session set/clear on a deployed preview before launch                                                        |
| Supabase needs direct Postgres pooling later                              | Devil's advocate / Research | L          | M      | Stay on Auth/PostgREST over `fetch`; adopt Supabase pooler or Hyperdrive only if direct pooling becomes necessary               |

## Getting Started

> Version-accurate for Astro 6 + `@astrojs/cloudflare` on this repo's pinned toolchain.
> The repo is already scaffolded against `workerd`, so most of this is verification, not setup.

1. **Confirm the Cloudflare adapter and `wrangler` are wired** — `astro.config.mjs` should
   set `output: "server"` with the Cloudflare adapter, and a `wrangler.jsonc` should exist
   (CLAUDE.md confirms both). If adding fresh: `npx astro add cloudflare`.
2. **Local dev runs on `workerd` already** — `npm run dev`. Do **not** add a separate
   `wrangler dev` step; Astro 6 gives you runtime fidelity in the normal dev server.
3. **Set production secrets** — `npx wrangler secret put SUPABASE_URL` and
   `npx wrangler secret put SUPABASE_KEY` (mirror locally in `.dev.vars`).
4. **Build and deploy** — `npm run build` then `npx wrangler deploy` (use the `/deploy-cf`
   skill). For a non-prod target: `CLOUDFLARE_ENV=preview npm run build && npx wrangler versions upload`.
5. **Wire read-only ops for the agent** — verify `npx wrangler tail` streams logs, and
   optionally connect the Cloudflare Workers Observability MCP server for typed log/analytics access.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region failover, HA, DR)
