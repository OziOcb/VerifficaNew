---
name: deploy-cf
description: Build and deploy this app to Cloudflare Workers via Wrangler. User-triggered only.
disable-model-invocation: true
---

Deploy to Cloudflare Workers. This has real side effects (ships to production) — only run when the user explicitly invokes `/deploy-cf`.

Steps:

1. Confirm the working tree is clean and on the intended branch (`git status`).
2. `npm run build` — produces `dist/` using the Cloudflare adapter.
3. `npx wrangler deploy` — deploy the Worker (config in `wrangler.jsonc`).

Notes:

- `SUPABASE_URL` / `SUPABASE_KEY` must already be set as Cloudflare secrets (`npx wrangler secret put <NAME>`), not read from local `.dev.vars`.
- If the user passes `$ARGUMENTS` (e.g. an environment name), forward it to `wrangler deploy` as appropriate.
- Report the deployed URL from Wrangler's output.
