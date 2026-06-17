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

## Service worker is build-only — test it with `wrangler dev`, never `astro dev`/`preview`

- **Context**: Any phase touching the `@vite-pwa/astro` service worker, PWA shell,
  offline reload, or precache on this Astro 6 + Cloudflare Workers stack — e.g. F-02,
  S-08, or edits to `Layout.astro`'s SW registration / the `astro.config.mjs` PWA block.
- **Problem**: The SW is emitted only by `astro build`; under `npm run dev` there is
  no `/sw.js`, so offline/SW/precache behavior cannot be exercised in dev at all.
  Compounding it: the `@astrojs/cloudflare` adapter has no working `astro preview`, and
  a registered SW persists per origin — since `astro dev` and `wrangler dev` both
  default to port 4321, a SW left registered from build-testing silently intercepts
  later `npm run dev` sessions on the same port.
- **Rule**: Keep `npm run dev` for normal work. To exercise the SW / offline reload /
  precache, use `npm run build && npx wrangler dev --port 4321` — the only way to serve
  the built SW locally (the Cloudflare adapter has no `astro preview`; needs local
  Supabase for auth). Keep the registration in `Layout.astro` guarded by
  `import.meta.env.PROD`. After SW testing, discard the worker (Incognito window, or
  DevTools → Application → Service Workers → Unregister) so it can't hijack a later
  `npm run dev` on port 4321. `npm run test:e2e` already does the build+wrangler step
  for the automated offline round-trip.
- **Applies to**: implement, impl-review

## Count-based limits in DB triggers are not concurrency-safe — acceptable only at trivial scale

- **Context**: Enforcing a per-owner row cap (e.g. the 2-inspection limit) via a
  BEFORE INSERT trigger that does `select count(*) ... >= N` —
  `supabase/migrations/20260613204306_inspections_two_limit.sql:20`.
- **Problem**: count-then-insert has no lock (TOCTOU): two concurrent inserts for
  the same owner both read count=N-1 and both succeed, exceeding the cap. Blast
  radius is one extra row, never cross-owner.
- **Rule**: For single-user/single-device apps at trivial scale, a count-in-trigger
  cap is acceptable IF paired with a client-side in-flight guard (a `busy` flag) —
  document the residual race as a known limitation. When a hard guarantee is needed,
  enforce with a partial unique index / exclusion constraint or `select ... for
update`, not a bare count.
- **Applies to**: plan, plan-review, implement, impl-review

## Use `implemented` (not `done`) when closing a roadmap item

- **Context**: /10x-archive edits to `context/foundation/roadmap.md` — specifically the `## At a glance` table Status cell and the `### <ID>:` body `- **Status:**` line.
- **Problem**: /10x-archive used `done` (borrowed from the `## Done` section's prose convention) instead of `implemented`, mismatching all other completed items (F-01, F-02, S-01, S-02) and breaking the table as a reliable status index.
- **Rule**: When closing a roadmap item, set Status to `implemented` in both the `## At a glance` table cell and the `### <ID>:` body line. The `## Done` section bullet uses prose ("Archived …") and is separate — do not conflate the two conventions.
- **Applies to**: archive

## Type-checked ESLint rules can crash on `.astro` frontmatter — scope them off for `.astro`, don't fight the parser

- **Context**: A top-level `return Astro.redirect(...)` (data-dependent SSR
  redirect) in `.astro` frontmatter — e.g. `src/pages/inspections/[id].astro` —
  with `@typescript-eslint` type-checked rules enabled via astro-eslint-parser
  (`eslint.config.js`).
- **Problem**: `@typescript-eslint/no-misused-promises` throws (not just warns) on
  that return: astro-eslint-parser gives the return node no enclosing-function
  parent, so the rule's `nullThrows` blows up and breaks `npm run lint` entirely.
- **Rule**: When a type-checked TS rule crashes (not misfires) on `.astro`
  frontmatter, disable that specific rule inside the `.astro` ESLint config block
  rather than rewriting valid frontmatter to appease it — astro-eslint-parser has
  known type-info gaps. Keep the disable narrow (one rule, `.astro` only) and
  comment why.
- **Applies to**: implement, impl-review

## Self-verify anything you can; only delegate true human-judgment checks

- **Context**: Any phase with a verification or "manual test" step — especially /10x-implement and /10x-impl-review success criteria, where a plan lists checks under a "Manual Verification" heading.
- **Problem**: Treating a check as "manual" by default and handing it to the user wastes their time and stalls the loop, when the agent could have run it directly. Example: reconciling the visibility engine's per-group/per-part output against the authored `list-of-questions.md` source of truth was listed as a manual spot-check, but the agent can read both files and reconcile them line-by-line itself.
- **Rule**: If a verification step can be performed by the agent — reconciling output against a source-of-truth file, running a script, comparing data, parsing a catalogue — do it directly instead of delegating it as a "manual test". Only ask the user to manually verify things that genuinely require human judgment, a live UI, a physical device, or external access the agent lacks.
- **Applies to**: implement, impl-review
