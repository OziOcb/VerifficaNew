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
- Auth uses Supabase Auth's built-in `auth.users` only — no app tables or migrations. Add protected paths to the `PROTECTED_ROUTES` array in `src/middleware.ts`.

## Git

- Default/CI branch is **`master`** (not `main`).
- Conventional Commits (`feat:`, `fix:`, `chore:`, …). Work on feature branches off `master`; never commit directly to `master`.
- Never `git push` or open a PR unless explicitly asked.
- A husky `pre-commit` hook runs `lint-staged` (ESLint --fix on `.ts/.tsx/.astro`, Prettier on `.json/.css/.md`).

## Deploy

Cloudflare Workers via `npm run build` then `npx wrangler deploy`. Set `SUPABASE_URL`/`SUPABASE_KEY` as Wrangler/Cloudflare secrets. Use the `/deploy-cf` skill.
