# Cloudflare Integration & Deployment Plan — Veriffica

## Context

The repo is already **scaffolded** against Cloudflare's `workerd` runtime (Astro 6 +
`@astrojs/cloudflare` v13, `output: "server"`, `nodejs_compat`, null-safe
`createClient()`), but it has **never been deployed** and there is **no production
backend**. Today Supabase runs only against local Docker, secrets exist only in local
files, and `wrangler.jsonc` still carries the starter's default `name`
(`10x-astro-starter`). This plan takes the project from "runs locally" to "auto-deploys
to production on every push to `main`", per `context/foundation/infrastructure.md`
(recommended platform: Cloudflare Workers).

**Decisions locked with the user:**

- **Supabase**: create a **new hosted (cloud) project** and wire its credentials + Auth
  redirect URLs to the Workers domain.
- **Deploys**: handled by **Cloudflare Workers Builds** (Cloudflare's _native_
  git-integrated CI/CD) — **not** an external GitHub Actions deploy job. Auto-deploy on
  push to the production branch.
- **Environments**: **production-only** for the MVP (single Worker, single secret set).
- **Domain**: free **`workers.dev`** subdomain.

The existing GitHub Actions workflow (`.github/workflows/ci.yml`) stays as a **lint +
build quality gate** only; it does not deploy.

> **Branch note (resolved):** The repo only ever had a **`main`** branch — the old
> `master` references in CLAUDE.md/CI were stale and never matched reality. We
> standardized on **`main`**: CI triggers, CLAUDE.md, README, and this plan were all
> updated. Cloudflare Workers Builds will use **production branch = `main`**.

---

## Why these choices (learning notes)

- **Astro 6 runs `workerd` at every stage** (dev, prerender, prod) via the rebuilt
  `@astrojs/cloudflare` adapter — so `npm run dev` already gives production runtime
  fidelity. There is **no separate `wrangler dev`** step. (Confirmed against Astro 6 +
  adapter v13 docs.)
- **Env is fixed at build time in Astro 6.** The old `astro build --env <name>` flow is
  gone; you select an environment with `CLOUDFLARE_ENV=<env> astro build`. For
  production-only we never set it (defaults to top-level config).
- **Workers Builds vs GitHub Actions**: Workers Builds connects the Git repo directly to
  Cloudflare; Cloudflare runs the build and `wrangler deploy` on its own infra on each
  push. This is what the user asked for ("handled by Cloudflare, not external CI/CD").

---

## Phase 0 — Prerequisites (accounts, CLI, credentials) ✓

These are human/interactive setup steps an agent cannot do unattended. Do them once, in
order. They produce three things the later phases assume: a logged-in `wrangler`, a
hosted Supabase project with its URL + anon key, and a Cloudflare account with
`workers.dev` enabled.

### 0a — Local toolchain ✓

- [x] **Use the pinned Node version.** `.nvmrc` pins `22.14.0`. With nvm:
      `nvm install && nvm use` (reads `.nvmrc`). Verify: `node -v` → `v22.14.0`.
- [x] **Install dependencies** if not already: `npm install`. This makes `wrangler` and
      `supabase` available via `npx` (both are devDependencies — no global install
      needed). Verify: `npx wrangler --version` (expect ≥ 4.90) and
      `npx supabase --version`.
  - _Why `npx` not global:_ the repo pins exact CLI versions, so `npx` always runs the
    project's version and avoids "works on my machine" drift from a stale global install.

### 0b — Cloudflare account + Wrangler CLI auth ✓

- [x] **Create / confirm a Cloudflare account** at <https://dash.cloudflare.com/sign-up>
      (free tier is enough for the MVP — 100k requests/day per script). Verify the email.
- [x] **Enable a `workers.dev` subdomain.** Dashboard → **Workers & Pages**. On first
      visit Cloudflare asks you to **choose a subdomain** (e.g. `your-handle`) — this
      becomes the `*.your-handle.workers.dev` host your Worker serves on. (If you skip it
      here, the first `wrangler deploy` in Phase 3 will prompt for it.)
- [x] **Authenticate the CLI.** Run it in this session so output is visible — type
      `! npx wrangler login` in the Claude prompt. It opens a browser, asks you to
      authorize Wrangler, then stores an OAuth token locally (`~/.config/.wrangler`).
- [x] **Verify the login:** `npx wrangler whoami` → should print your account email and
      Account ID. Copy the **Account ID** — Workers Builds and some commands reference it.
  - _Edge case — headless / no browser / CI machine:_ skip `wrangler login` and use an
    **API token** instead. Dashboard → **My Profile → API Tokens → Create Token →
    "Edit Cloudflare Workers" template** (grant your account + zone). Then export it:
    `export CLOUDFLARE_API_TOKEN=<token>` (add to your shell profile or `.dev.vars` is
    **not** the place — this is a CLI/CI credential, keep it out of the repo). Re-run
    `npx wrangler whoami` to confirm it's picked up.
  - _Edge case — multiple Cloudflare accounts:_ if `whoami` lists more than one account,
    set `CLOUDFLARE_ACCOUNT_ID=<id>` in your environment so `wrangler deploy` targets the
    right one instead of erroring on ambiguity.

### 0c — Supabase account + cloud project ✓

(The detailed project creation is Phase 2; this step just gets the account and, optionally,
the Supabase CLI linked so local and cloud stay in sync.)

- [x] **Create / confirm a Supabase account** at <https://supabase.com/dashboard> (GitHub
      login is easiest). The free tier covers the MVP.
- [x] _(Optional but recommended)_ **Link the Supabase CLI** to your account so you can
      manage the hosted project from the terminal: `npx supabase login` (opens a browser,
      stores an access token). Verify: `npx supabase projects list`.
  - _Why optional:_ the app only needs the project **URL + anon key** (set as Cloudflare
    secrets later), which you can copy from the dashboard without the CLI. The CLI is only
    needed if you later want to push migrations or run `supabase db` commands — not
    required for auth-only MVP.
- [x] **Know which two values you'll need** (collected in Phase 2): `SUPABASE_URL` and the
      `anon` public key (`SUPABASE_KEY`). Found under **Project → Settings → API**.

### 0d — Credentials map (where each secret lives) ✓

The classic foot-gun here is the **three** locations the same Supabase pair lives in.
Keep them straight:

| Location                        | Purpose                                               | Tracked in git?  |
| ------------------------------- | ----------------------------------------------------- | ---------------- |
| `.env`                          | Read by the **Supabase CLI** (`npx supabase`)         | No (gitignored)  |
| `.dev.vars`                     | Read by the **`workerd` dev runtime** (`npm run dev`) | No (gitignored)  |
| **Wrangler/Cloudflare secrets** | Read by the **deployed Worker** at runtime            | No (server-side) |
| `.env.example`                  | Authoritative template (lists the keys, no values)    | **Yes**          |

- [x] Confirm `.gitignore` already excludes `.env` and `.dev.vars` (it does) so real keys
      never get committed.
- [x] Create the local files when you have values (Phase 2): `cp .env.example .env` and
      `cp .env.example .dev.vars`, then fill both in.

**Exit criteria for Phase 0:** `npx wrangler whoami` succeeds, a Cloudflare `workers.dev`
subdomain is chosen, you have a Supabase account, and you know where the URL + anon key
will come from. You're then ready for Phase 1.

---

## Phase 1 — Repo config fixes ✓

Small but **blocking** — Workers Builds fails if the dashboard Worker name ≠
`wrangler.jsonc` `name`.

- [x] **Rename the Worker** in `wrangler.jsonc`: `"name": "10x-astro-starter"` →
      `"name": "veriffica"`. This also determines the deployed URL
      (`veriffica.<subdomain>.workers.dev`).
  - File: `wrangler.jsonc:3`.
- [x] (Optional, cosmetic) Update `package.json` `name` from `10x-astro-starter` to
      `veriffica`.
- [x] Sanity-check the rest of `wrangler.jsonc` (already correct): `main` entrypoint,
      `compatibility_date` `2026-05-08`, `compatibility_flags: ["nodejs_compat"]`,
      `assets` binding, `observability.enabled: true`. No change needed.

---

## Phase 2 — Create the production Supabase project (external integration) ✓

- [x] In the Supabase dashboard, **create a new project** (pick a region close to your
      users). Wait for provisioning to finish.
- [x] Copy from **Settings → API Keys** (dashboard reorganized; use the **Connect** dialog
      or Settings → API Keys): the **Project URL** (`SUPABASE_URL`) and the **publishable
      key** `sb_publishable_…` (`SUPABASE_KEY`) — the modern replacement for the legacy
      `anon` key. These are the only two the app reads (`src/lib/supabase.ts:3`).
- [x] **Mirror locally** so dev can point at cloud if desired: put both values in
      `.dev.vars` (workerd dev) and `.env` (Supabase CLI). Keep `.env.example`
      authoritative (it already lists both keys).

> **Edge case — auth uses built-in `auth.users` only.** No tables/migrations to run
> (per CLAUDE.md). Nothing to migrate; do **not** create app tables.

> **Edge case — email confirmation.** Hosted Supabase requires email confirmation by
> default, so first sign-in will appear to "fail silently" until the user clicks the
> emailed link. For the MVP either (a) leave it on and test with a real inbox, or
> (b) Authentication → Email → turn **Confirm email** off (README documents this).

---

## Phase 3 — First manual deploy + production secrets ✓

We deploy once by hand to **create the named Worker** and **set its runtime secrets**,
_before_ connecting Workers Builds (Builds attaches to an existing Worker).

**Deployed URL: `https://veriffica.veriffica.workers.dev`** (subdomain is `veriffica`).
Live smoke test passed: `/` → 200, `/dashboard` (logged out) → 302 → `/auth/signin`,
`/auth/signin` → 200 — confirms runtime secrets are present and `createClient()` is
non-null on the edge.

- [x] Set runtime secrets on the Worker. **Note:** `wrangler secret put` reads the value
      from a TTY prompt; in a non-interactive shell pipe the value instead
      (`printf '%s' "<value>" | npx wrangler secret put SUPABASE_URL`) or it can upload an
      empty secret. Both `SUPABASE_URL` and `SUPABASE_KEY` set this way; verified with
      `npx wrangler secret list`.
  - These are **runtime secrets** read via `astro:env/server`; they are _not_ baked into
    the build. The env schema marks both `optional: true`, so the build never fails when
    they're absent — but production runtime needs them or `createClient()` returns `null`
    and every protected route redirects to `/auth/signin`.
- [x] `npm run build` (Cloudflare adapter → `dist/`).
- [x] `npx wrangler deploy`. Auto-enabled `workers.dev` + Preview URLs and auto-provisioned
      a **KV namespace** (`veriffica-session`) for the `SESSION` binding.
- [x] Reuse the existing **`/deploy-cf`** skill for this (build + `wrangler deploy`); it
      already documents that secrets must be Cloudflare secrets, not `.dev.vars`.

> **Edge case — `nodejs_compat` / `workerd` ≠ Node (Risk #1 in infra doc).** A transitive
> SSR dependency that reaches for `fs`/`net`/native `crypto`/Node streams can build clean
> yet throw at runtime, and `astro dev` may not exercise the failing path. `nodejs_compat`
> is already on. If a deployed route 500s where local dev was green, run `npx wrangler
tail` and look for a Node-API error; prefer a Web-standard/isomorphic replacement.

> **Edge case — `astro:env` vs `wrangler vars` forwarding bug.** There's a known issue
> where vars declared in `wrangler.jsonc` aren't forwarded to `astro:env`. We sidestep it
> by using **`wrangler secret put`** (real runtime secrets), not `vars`. Verify on the
> deployed URL in Phase 6; if a value reads as `undefined`, the documented fallback is to
> import from `cloudflare:workers` instead of `astro:env/server`.

---

## Phase 4 — Configure Supabase Auth for the Workers domain (edge case) ✓

Auth cookies/redirects break if Supabase doesn't know the production origin.

- [x] Supabase dashboard → **Authentication → URL Configuration**:
  - Set **Site URL** to `https://veriffica.veriffica.workers.dev`.
  - Add the origin (`https://veriffica.veriffica.workers.dev/**`) to **Redirect URLs**.
- [x] Re-deploy is **not** needed for this (it's Supabase-side config).

> **Edge case — SSR-set auth cookies on the edge (Unknown-unknown in infra doc).** The
> Supabase session cookie is set server-side in `src/middleware.ts` /
> `src/lib/supabase.ts`. `workerd` local ≠ 100% prod parity for some cookie/header
> behavior. **Must be smoke-tested on the real deployed URL**, not just `astro dev`
> (covered in Phase 6).

---

## Phase 5 — Wire Cloudflare Workers Builds (native git auto-deploy) ✓

This is the user's chosen deploy mechanism — Cloudflare builds & deploys on push, no
external CI.

**Verified:** push to `main` (commit `a5d9dc7`) auto-triggered a Cloudflare build that
deployed version `2e9650cf` to 100% within ~1–2 min, no manual step. Live site healthy
afterward (`/` → 200, `/dashboard` → 302 → `/auth/signin`), confirming runtime secrets
carried over to the Builds-produced deployment.

- [x] Cloudflare dashboard → **Workers & Pages → `veriffica` → Settings → Builds →
      Connect**. Authorize the GitHub repo. _(Worker name already matches `wrangler.jsonc`
      from Phase 1 — required, or builds fail.)_
- [x] Set **production branch = `main`** (see Branch note in Context).
- [x] **Build command**: `npm run build`. **Deploy command**: `npx wrangler deploy`
      (promotes to production). Leave non-production branches on the default
      `npx wrangler versions upload` (preview version, no promotion) — harmless for an
      MVP and gives ad-hoc preview URLs.
- [x] Confirm the Worker's **runtime secrets** (set in Phase 3) are present — Builds
      deploys the same Worker, so the secrets carry over. No need to re-enter them in the
      Builds UI (they are Worker secrets, not build vars).
- [x] Push a trivial commit to `main` (e.g., a README touch on a feature branch →
      merge) and confirm Cloudflare runs a build and deploys automatically.

> **Edge case — build-time vs runtime secrets.** Do **not** add `SUPABASE_KEY` as a
> Workers Builds _build variable_ expecting it at runtime — runtime reads come from Worker
> _secrets_. The build itself needs neither (schema is `optional`).

> **Edge case — fork PRs.** PRs from forks don't get the account's secrets; their preview
> builds will run without Supabase. Expected, per infra doc — don't treat as a failure.

> **Redundancy note.** Existing GitHub Actions CI still runs `astro sync` → lint → build
> on push/PR to `main` as a quality gate. It does **not** deploy. Keep it; the two
> systems are complementary (GH = gate, CF = deploy). Optionally narrow CI to PRs only to
> avoid double-building on push — decide at execution.

---

## Phase 6 — Verification / smoke tests ✓

Exercise the **deployed** URL, because the riskiest items (Node-API gaps, edge cookies)
are invisible to `astro dev`.

- [x] `curl -I https://veriffica.veriffica.workers.dev/` → `200`.
- [x] In a browser: visit `/dashboard` while logged out → **redirects to `/auth/signin`**
      (proves middleware + `createClient()` see the secrets).
- [x] **Full auth round-trip on the live URL**: sign up → confirm email → sign in → land on
      `/dashboard` → refresh (session persisted) → sign out. Validates SSR cookie
      edge-parity directly — worked. (Pre-confirmation sign-in correctly returned
      `error=Email not confirmed`, then the `/?code=…` callback completed confirmation.)
- [x] `npx wrangler tail` during the round-trip — **every request returned `Ok`**, no
      `nodejs_compat`/Node-API errors, no `undefined` Supabase env.
- [x] Workers Builds run green; deployed version (`2e9650cf`) matches latest `main`.
- [ ] (Optional) Connect the **Cloudflare Workers Observability MCP**
      (`observability.mcp.cloudflare.com/mcp`) for typed log/analytics access; the Worker
      already has `observability.enabled: true`.

**Rollback (good to know):** `npx wrangler rollback [<version-id>]` reverts code in
seconds. Caveat: **Supabase schema/auth config changes do not roll back** — revert those
in the Supabase dashboard separately.

---

## Phase 7 — Update docs to match reality ✓

- [x] **README.md** "Deployment"/"CI" sections: document that production auto-deploys via
      **Cloudflare Workers Builds** on push to `main`; `/deploy-cf` (manual) is the
      break-glass path. Note the production URL and the Supabase Auth URL config step.
- [x] **CLAUDE.md** "Deploy" section: add the Workers Builds auto-deploy fact (currently
      only documents manual `wrangler deploy`).
- [x] **`.claude/skills/deploy-cf/SKILL.md`**: add a line clarifying it's the _manual_
      path; routine deploys go through Workers Builds.
- [ ] Consider capturing the `workerd ≠ Node` / `astro:env` forwarding gotchas as a
      `/10x-lesson` for future implementations. _(Optional — offered separately.)_

---

## Critical files

| File                                | Change                                                         |
| ----------------------------------- | -------------------------------------------------------------- |
| `wrangler.jsonc:3`                  | Rename Worker `name` → `veriffica` (must match dashboard)      |
| `package.json:2`                    | (Optional) rename project to `veriffica`                       |
| `.dev.vars` / `.env` (gitignored)   | Cloud Supabase URL + anon key                                  |
| `README.md`                         | Document Workers Builds auto-deploy + Supabase Auth URL config |
| `CLAUDE.md`                         | Add auto-deploy note to Deploy section                         |
| `.claude/skills/deploy-cf/SKILL.md` | Mark as the manual/break-glass path                            |

**No code changes** to `src/middleware.ts` or `src/lib/supabase.ts` — they're already
null-safe and correct. This is configuration + external integration work, not application
code.

---

## Open items to confirm at execution time

1. ~~Branch~~ **Resolved**: standardized on **`main`** (the only branch that ever
   existed); CI, CLAUDE.md, README, and this plan updated accordingly.
2. Whether to trim the GitHub Actions CI to PR-only (avoid double builds) once Workers
   Builds is live.
