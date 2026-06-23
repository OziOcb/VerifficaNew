# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Astro 6 (`output: "server"`) + React 19 + TypeScript (strict) + Tailwind 4 + Supabase Auth, deployed to Cloudflare Workers. Node 22.14.0 (`.nvmrc`). Built on the 10x-astro-starter.

## Commands

Standard scripts (`dev`, `build`, `lint`, `lint:fix`, `format`) are in `package.json`. Non-obvious points:

- `npm run dev` runs on the Cloudflare **workerd** runtime (via `@astrojs/cloudflare`), not plain Node — behavior can differ from a normal Astro dev server.
- Run `npx astro sync` after changing `astro.config.mjs` env schema or content collections — it regenerates `.astro/types.d.ts`. CI runs it before lint/build.
- `npm run lint` uses type-checked ESLint rules, so it needs a successful `astro sync` first.

## Environment & secrets

- Env vars are declared in the `env.schema` in `astro.config.mjs` and accessed via `import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server"` — **server-only secrets**, never imported into client code. Do not use `import.meta.env` for these.
- Local secrets live in **two** files: `.env` (used by `npx supabase`) and `.dev.vars` (used by the Cloudflare dev runtime). Copy from `.env.example`. See README for Supabase local setup.
- `createClient()` in `src/lib/supabase.ts` returns `null` when env is unset — always null-check before use (see `src/middleware.ts`).

## Conventions

- Import alias: `@/*` → `src/*`.
- UI: shadcn/ui "new-york" style, components in `@/components/ui`, `lucide-react` icons, `rsc: false`, `.tsx` (see `components.json`).
- Code style differs from common defaults: **double quotes**, semicolons, 2-space indent, `printWidth: 120`, `trailingComma: "all"`. Prettier sorts Tailwind classes; don't hand-reorder them.
- ESLint runs `strictTypeChecked` + `stylisticTypeChecked` and `react-compiler` as an **error** — avoid patterns the React Compiler rejects. `no-console` is a warning. Prefix intentionally-unused vars with `_`.
- Auth uses Supabase Auth's built-in `auth.users`. Add protected paths to the `PROTECTED_ROUTES` array in `src/middleware.ts`.
- App tables live under `supabase/migrations/` (RLS-protected, owner-scoped via `owner_id = (select auth.uid())` — see the `inspections` migration as the template). After any schema change run `npm run db:types` to regenerate `src/db/database.types.ts` and commit it; the SSR client is typed `SupabaseClient<Database>`. RLS isolation is verified by `npm test` (`tests/inspections.rls.test.ts`).

## Git

- Default/CI branch is **`main`**.
- Conventional Commits (`feat:`, `fix:`, `chore:`, …). Work on feature branches off `main`; never commit directly to `main`.
- Never `git push` or open a PR unless explicitly asked.
- A husky `pre-commit` hook runs `lint-staged` (ESLint --fix on `.ts/.tsx/.astro`, Prettier on `.json/.css/.md`).

## Deploy

Production (`https://veriffica.veriffica.workers.dev`) **auto-deploys via Cloudflare Workers Builds** on every push to `main` (Cloudflare runs `npm run build` → `npx wrangler deploy`). This is the routine path — no external CI deploy job. The `/deploy-cf` skill (`npm run build` then `npx wrangler deploy`) is the **manual break-glass** path. `SUPABASE_URL`/`SUPABASE_KEY` are Worker **secrets** (`npx wrangler secret put`), not `vars` or build variables, and carry across both paths.

## Mutation testing

Repo uses Stryker for selective mutation testing on risk-critical modules.
Run it only for code covered by the current change or a risk from test-plan.md,
prefer narrowed scope with --mutate "path/to/file.ts:start-end", and do not chase
100% mutation score. Survived mutants should be reviewed one by one: add an
assertion only when the mutant represents a user-visible or business-relevant bug.
