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
