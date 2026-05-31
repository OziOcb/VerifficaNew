---
name: ci-check
description: Run the CI gate locally before pushing — astro sync, ESLint (type-checked), and production build. Use to verify changes pass the same checks GitHub Actions runs.
---

Mirror the GitHub Actions CI pipeline locally. Run, in order, and stop at the first failure:

1. `npx astro sync` — regenerate generated types (`.astro/types.d.ts`).
2. `npm run lint` — type-checked ESLint over the repo.
3. `npm run build` — production build (Cloudflare adapter).

If the build fails on missing `SUPABASE_URL`/`SUPABASE_KEY`, note that they come from `.dev.vars`/`.env` locally; the env schema marks them optional, so the build should still pass without them.

Report which step failed with the relevant output, or confirm all three passed. This is the same sequence CI runs (`.github/workflows/ci.yml`).

Note: the bundled `/verify` skill is for *running* the app to observe behavior; this skill runs the static CI gate instead.
