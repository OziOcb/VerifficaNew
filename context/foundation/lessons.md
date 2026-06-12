# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Verify Cloudflare Workers runtime parity on the live URL

- **Context**: Any phase deploying or debugging an Astro (or similar SSR) app on
  Cloudflare Workers / workerd — build config, secret setup, env access, SSR deps.
- **Problem**: workerd is not Node, and local `astro dev`/`wrangler dev` does not
  guarantee production parity. Three concrete failures hit while deploying veriffica:
  (a) a transitive SSR dependency reaching for Node APIs (fs/net/native crypto/streams)
  builds clean but throws only at runtime on the deployed Worker; (b) `wrangler secret
put NAME` in a non-interactive shell (CI/agent/piped) silently uploads an EMPTY secret
  because it expects the value from a TTY prompt; (c) `vars` declared in `wrangler.jsonc`
  may not forward to `astro:env/server`, reading as `undefined` at runtime.
- **Rule**: Always smoke-test the deployed URL with `npx wrangler tail` (not just local
  dev) before calling a deploy done. Set secrets non-interactively by piping the value
  (`printf '%s' "<value>" | npx wrangler secret put NAME`) and verify with `npx wrangler
secret list`. Use real Worker secrets — not `wrangler.jsonc` `vars`/build variables —
  for runtime config; if a value still reads `undefined`, import from `cloudflare:workers`
  instead of `astro:env/server`.
- **Applies to**: research, plan, implement, impl-review

## Field casing: camelCase in app code, snake_case in Postgres, convert at one boundary

- **Context**: Any feature reading/writing Supabase domain data through the app —
  the Dexie/on-device store, React, API endpoints, and the offline sync layer.
  Applies from F-02 onward and to every domain slice (S-02…S-09).
- **Problem**: Postgres/Supabase columns are (and must stay) `snake_case` — Supabase
  explicitly recommends it, camelCase columns require double-quoting everywhere
  ("YOU WILL FORGET"), and the F-01 migration + RLS policies are the snake_case
  template every later table copies. But JS/TS app code wants `camelCase`. The naive
  fix — a hand-written mapper per table — scales linearly (N tables = N mappers =
  N drift risks).
- **Rule**: Keep the **database snake_case**. Make **all application layers**
  (Dexie store, React, fetch payloads, the app-facing side of endpoints)
  **camelCase**. Confine the snake↔camel conversion to the **single server boundary**
  where rows cross into/out of `supabase-js` (e.g. the sync endpoint), using **one
  generic, table-agnostic key-case transformer** (`camelcase-keys`/`snakecase-keys`,
  `humps`, or a ~10-line recursive helper) — **never a per-table mapper**. Derive
  camelCase TS types from the generated snake_case types with `type-fest`
  `CamelCasedPropertiesDeep<…>` so types auto-track `npm run db:types`. Scope the
  runtime transform to top-level keys and exclude `jsonb` column contents (a blind
  transform would camelize the data inside a jsonb blob).
- **Applies to**: frame, research, plan, plan-review, implement, impl-review
