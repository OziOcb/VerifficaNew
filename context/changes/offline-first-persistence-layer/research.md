---
date: 2026-06-11T00:00:00Z
researcher: OziOcb
git_commit: 10b6ef45c7fe64f0f5d9ce4971b344306bf5aea8
branch: feat/offline-first-persistence-layer
repository: veriffica
topic: "Is dexie-reference.md compatible with the codebase, for implementing F-02?"
tags: [research, codebase, dexie, offline-first, supabase, astro, cloudflare]
status: complete
last_updated: 2026-06-12
last_updated_by: OziOcb
last_updated_note: "Recorded decisions resolving open questions Q1–Q3 (Q4 still open)."
related: [research-of-unknowns-and-risks.md, dexie-reference.md]
---

# Codebase Compatibility Review — is `dexie-reference.md` compatible?

**Date**: 2026-06-11 · **Branch**: `feat/offline-first-persistence-layer` ·
**Commit**: `10b6ef4` · **Method**: direct codebase read (inline, no sub-agents).

## Research question

Review the codebase and decide whether
`context/changes/offline-first-persistence-layer/dexie-reference.md` is compatible
with it, toward implementing F-02 (`context/foundation/roadmap.md`). Architecture
priors live in the sibling `research-of-unknowns-and-risks.md`.

## Summary / verdict

**Mostly compatible — Dexie itself drops in cleanly, but one architectural
assumption in the reference is WRONG for this codebase and must change before
planning: the sync push cannot be a direct browser→Supabase `supabase-js` call.**
There is no browser Supabase client and no client-exposed key; all data must flow
through a server API endpoint. Two further interactions (server `updated_at`
trigger vs client LWW timestamp; camelCase vs snake_case) need a deliberate
decision. Everything else (SSR gotcha, alias, React 19, file placement, tests)
checks out.

## ✅ Compatible / confirmed correct

- **SSR gotcha is real and correctly flagged.** `astro.config.mjs:11,16` —
  `output: "server"` + `adapter: cloudflare()`. Dexie must be client-only. ✓
- **React 19 islands available.** `package.json` — `react@^19.2.6`,
  `@astrojs/react@^5.0.4`. Islands mount via `client:load` today
  (`src/pages/auth/signin.astro:16`, `signup.astro:16`), so
  `client:only="react"` / `client:load` for a Dexie-backed island is idiomatic.
  `useLiveQuery` + `dexie-react-hooks` will work. ✓
- **`@/*` alias exists.** `tsconfig.json:9-11` maps `@/* → ./src/*`. The
  reference's `@/lib/db` import resolves. ✓
- **`src/lib/` is the right home.** Already holds `supabase.ts`, `utils.ts`,
  `config-status.ts`. `src/lib/db.ts` fits — **caveat:** it must NEVER be imported
  by server code, because anything in `src/lib` that runs server-side (like
  `supabase.ts`, which imports `astro:env/server`) is a different world. Keep
  `db.ts` import-disciplined to client modules only.
- **`synced` as a local-only flag is correct.** The DB `inspections` table has no
  `synced` column (`supabase/migrations/20260610181920_create_inspections.sql:29-36`;
  `src/db/database.types.ts:37-63`) — it's purely a local Dexie outbox flag. ✓
- **Schema skeleton is enough for F-02's scope.** `inspections` is a lifecycle
  skeleton (`id, owner_id, status, name, created_at, updated_at`) with no Part 1
  columns yet — fine, since F-02's scope cap is round-tripping ONE record. ✓
- **Test harness present.** `vitest.config.ts`, `tests/inspections.rls.test.ts`,
  `tests/helpers/` — F-02's round-trip test follows the existing pattern. ✓

## ❌ Incompatibility #1 (BLOCKER) — sync push must go through a server endpoint

The reference's `flushQueue()` does `await pushToSupabase(op); // your supabase-js
call`, implying a direct browser→Supabase client call (as most of the Exa examples
showed). **This does not fit the codebase:**

- The only Supabase client is **server-side**: `src/lib/supabase.ts` uses
  `createServerClient` from `@supabase/ssr`, reads cookies, and imports the
  **server-only secret** `SUPABASE_KEY` from `astro:env/server`
  (`astro.config.mjs:19-20`, `access: "secret"`, `context: "server"`).
- **No anon/public key is exposed to the browser** and **no browser client
  exists** — confirmed: `grep` for `PUBLIC_` / `createBrowserClient` / `import.meta.env`
  in `src` → none; `.env.example` declares only server `SUPABASE_URL`/`SUPABASE_KEY`.
- The session lives in **HTTP cookies**, read server-side in `src/middleware.ts:7-13`.
- The established pattern is: client island → plain `POST` to an Astro server
  endpoint → server `createClient(headers, cookies)` → Supabase under RLS. See
  `src/components/auth/SignInForm.tsx:43` (`action="/api/auth/signin"`) →
  `src/pages/api/auth/signin.ts`.

**Compatible design:** `flushQueue()` should `fetch()`-POST each queued op to a NEW
server endpoint (e.g. `src/pages/api/inspections/sync.ts`), mirroring
`/api/auth/*`. Same-origin fetch carries the auth cookie automatically; the
endpoint reuses the server client, so RLS + cookie auth + the server-only secret
all keep working. `dexie-reference.md` §3 should be amended to reflect this — its
`pushToSupabase` is a placeholder, but the implied direct-client model is wrong.

## ⚠️ Interaction #2 — server `updated_at` trigger vs client LWW timestamp

F-01 installs a trigger that **overwrites `updated_at` server-side on every
UPDATE**: `set_updated_at()` → `new.updated_at = now()`
(`supabase/migrations/20260610181920_create_inspections.sql:19-26,41-45`), and the
column is `timestamptz` (ISO string), default `now()`.

The reference designates client `updatedAt: number` (ms epoch) as "the LWW field;
newer wins at `pushToSupabase`." Two mismatches:

- **Authority:** the server trigger clobbers any client-sent `updated_at`, so a
  client-authoritative LWW timestamp can't persist into that column.
- **Type:** DB is ISO-string `timestamptz`; reference uses a JS `number`.

For F-02's single-writer/single-device scope this is mostly benign, but the plan
must choose deliberately:

- **Option A (recommended, simplest):** server is the LWW authority — let the
  trigger stamp `updated_at`; the client's local `updatedAt` is just an optimistic
  ordering hint, and the client adopts the server's value on push response/pull.
- **Option B:** client-authoritative — carry the client timestamp in a separate
  column and bypass/disable the trigger for synced writes (more work; only needed
  if true client-clock LWW is required, which single-device doesn't demand).

## ⚠️ Interaction #3 — camelCase (reference) vs snake_case (DB) + DRY types

Reference uses `ownerId` / `updatedAt`; the DB and generated types use
`owner_id` / `updated_at` (`src/db/database.types.ts:38-45`). Local Dexie naming is
free, but the push boundary then needs camel↔snake mapping. Cheaper + type-safe:
**mirror the DB column names (snake_case) in the Dexie row type and derive it from
the generated types** rather than hand-writing the `Inspection` interface, e.g.
`type InspectionRow = Database["public"]["Tables"]["inspections"]["Row"] & { synced: 0 | 1 }`.
This honors the repo's `SupabaseClient<Database>` typed-client convention (CLAUDE.md)
and avoids drift when `npm run db:types` regenerates.

## Out of scope for the Dexie reference (but needed for full F-02)

- **Service worker / PWA shell** — `@vite-pwa/astro` is NOT installed
  (`package.json`); baseline confirms "PWA/offline: absent". The Dexie reference is
  correctly scoped to store/queue/sync only; the SW (FR-023 true offline) is a
  separate workstream the plan must include.
- **Deps to add:** `dexie` + `dexie-react-hooks` are not yet in `package.json`.
- **Multi-tab leader guard** — `navigator.locks`/`BroadcastChannel` wrapper, per
  the architecture research (`research-of-unknowns-and-risks.md`); Dexie doesn't
  provide it.

## Historical context (from prior changes)

- `context/changes/offline-first-persistence-layer/research-of-unknowns-and-risks.md`
  — architecture priors: LWW is adequate (single-writer), library tier comparison,
  notes-granularity and multi-tab-guard fixes.
- `context/changes/offline-first-persistence-layer/dexie-reference.md` — the Dexie
  API reference under review here (Context7 `/websites/dexie`).
- `context/foundation/lessons.md` — "Verify Cloudflare Workers runtime parity":
  the NEW sync API endpoint runs on workerd and uses `@supabase/ssr` (already proven
  in `/api/auth/*`), so it's safe; smoke-test the deployed URL with `wrangler tail`
  and keep Node-only SSR deps out of it. Dexie stays client-side, never touches
  workerd.

## Code references

- `astro.config.mjs:11,16,19-20` — SSR output, Cloudflare adapter, server-only secret env schema
- `src/lib/supabase.ts:1-25` — server-only `createServerClient`, cookie-based
- `src/middleware.ts:7-13` — cookie session → `context.locals.user`
- `src/components/auth/SignInForm.tsx:43` + `src/pages/api/auth/signin.ts` — island → server-endpoint pattern to mirror for sync
- `supabase/migrations/20260610181920_create_inspections.sql:19-45` — `set_updated_at` trigger + table schema
- `src/db/database.types.ts:37-63` — generated `inspections` types (snake_case)
- `tsconfig.json:9-11` — `@/*` alias
- `src/pages/auth/signin.astro:16` — `client:load` island mounting

## Decisions (resolving the open questions) — 2026-06-12

All four are settled and bind `/10x-plan`.

1. **LWW authority → Option A, server-authoritative.** Let F-01's
   `set_updated_at()` trigger stamp `updated_at` on every write; the client adopts
   the row returned by the sync endpoint. The local `updatedAt` is only an
   optimistic ordering hint. (Fine for single-device; no trigger bypass needed.)
2. **Sync endpoint → single-record upsert.** `POST /api/inspections/sync` takes one
   queued op and upserts the single `inspections` row under RLS. Matches F-02's
   "round-trip one record" scope cap; no batch/multi-entity endpoint yet.
3. **Field casing → camelCase across ALL app layers; snake_case confined to
   Postgres + the single sync endpoint.** Do NOT camelCase the DB (Supabase
   explicitly recommends snake_case; would break the F-01 template). Instead:
   - **Runtime:** one generic, table-agnostic key-case transformer
     (`camelcase-keys`/`snakecase-keys` or `humps` or a ~10-line recursive helper)
     applied only at the `/api/inspections/sync` boundary. **One utility for all
     tables — never a per-table mapper.** Scope it to top-level keys / exclude
     `jsonb` content (low risk here: scalar columns, notes are row/field-level not a
     blob).
   - **Types:** derive camelCase types from the generated snake_case types via a
     generic type-level transform (`type-fest` `CamelCasedPropertiesDeep<…>`), e.g.
     `type InspectionRow = CamelCasedPropertiesDeep<Database["public"]["Tables"]["inspections"]["Row"]> & { synced: 0 | 1 }`.
     So Dexie/React/payloads are camelCase, still auto-track `npm run db:types`, and
     scale to S-02…S-07's tables at zero marginal cost.
   - Exact `type-fest` / `camelcase-keys` API to be pulled via Context7 at implement
     time; lib choice not locked here.
   - This **supersedes** Interaction #3 above (which had recommended a snake_case
     Dexie mirror) and §1 of `dexie-reference.md` (hand-written camelCase interface —
     update it to the derived `CamelCasedPropertiesDeep` form when planning).
   - **Promoted to a project-wide convention** in
     `context/foundation/lessons.md` ("Field casing: camelCase in app code,
     snake_case in Postgres, convert at one boundary") — it governs every
     Supabase-touching slice, not just F-02. This entry is the F-02 application of it.

4. **Service worker scope → Option A, include the SW in F-02.** F-02 ships
   `@vite-pwa/astro` (Workbox shell) alongside the Dexie store/queue/sync so the
   foundation is genuinely offline-capable — the app shell loads on an offline
   reload, not just the data persisting. Scope additions for the plan:
   - Add `@vite-pwa/astro`; configure a static **app-shell fallback** for offline
     navigation (SSR precaches from `dist/client`).
   - **Exclude auth from caching:** `/api/auth/{signin,signup,signout}` and the
     `PROTECTED_ROUTES` paths → `NetworkOnly` / Workbox `navigateFallbackDenylist`,
     so the SW never serves a stale authenticated shell or caches an auth POST.
   - F-02's "one record survives offline→online" outcome is now verified by a
     **real offline browser reload**, not only a programmatic offline-simulation.
   - Heed `lessons.md` (workerd parity): the SW is a browser artifact and never
     touches the Cloudflare Worker; the new sync endpoint does, and reuses the
     proven `@supabase/ssr` server client.
