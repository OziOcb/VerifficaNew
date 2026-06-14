# F-02 Offline-First Persistence Layer — Plan Brief

> Full plan: `context/changes/offline-first-persistence-layer/plan.md`
> Research: `context/changes/offline-first-persistence-layer/research.md`
> Dexie reference: `context/changes/offline-first-persistence-layer/dexie-reference.md`

## What & Why

F-02 lands Veriffica's local-first persistence foundation — a client-only Dexie store, a hand-rolled Change Queue (outbox), a single-record server sync endpoint, and a service-worker app shell. It is sequenced before every domain slice (S-02…S-08) so they are built offline-first from day one and never need an online-first → offline retrofit. The acceptance bar: **one `inspections` record survives a full offline → online cycle, and the app shell loads on a real offline reload** (FR-023, US-03, no-data-loss guardrail).

## Starting Point

Clean slate: no `src/lib/db.ts`, no sync endpoint, no PWA, none of the deps installed (verified). The integration points all exist and match the research — the server-only `createClient` (no browser Supabase client, no client key), `context.locals.user` from middleware, the `/api/auth/*` island→endpoint pattern, the F-01 `inspections` table + `set_updated_at()` trigger, and the vitest harness.

## Desired End State

A `/offline-demo` island can save an `inspections` record offline (optimistic write + atomic outbox enqueue); on reconnect the outbox drains to `POST /api/inspections/sync`, which upserts under RLS, stamps `owner_id`/`updated_at`, and returns the authoritative camelCase row the client adopts. Reloading offline still loads the app shell and the record persists. A Playwright e2e proves the whole cycle.

## Key Decisions Made

| Decision           | Choice                                                             | Why (1 sentence)                                                                        | Source             |
| ------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------ |
| LWW authority      | Server-authoritative                                               | F-01's `set_updated_at()` trigger stamps `updated_at`; client adopts the returned row.  | Research           |
| Sync endpoint      | Single-record upsert `POST /api/inspections/sync`                  | No browser Supabase client/key exists; one op at a time matches the scope cap.          | Research           |
| Field casing       | camelCase app-wide, snake_case only in Postgres + the one endpoint | One generic transformer, never per-table; types derived via `CamelCasedPropertiesDeep`. | Research / Lessons |
| Service worker     | Included in F-02 (`@vite-pwa/astro`)                               | Foundation must survive a real offline reload, not just persist data.                   | Research           |
| Outbox / multi-tab | Hand-rolled outbox; multi-tab guard deferred to S-08               | Matches the round-trip-one-record scope cap; most instructive.                          | Plan               |
| Casing transform   | `camelcase-keys` + `snakecase-keys`                                | Battle-tested deep transform; matches the reference doc.                                | Plan               |
| Demo surface       | Throwaway `/offline-demo` page                                     | Isolated; doesn't pre-empt S-02's dashboard design.                                     | Plan               |
| Offline test       | Playwright e2e + vitest units                                      | Only an e2e verifies the real offline reload Decision #4 requires.                      | Plan               |
| PWA breadth        | SW + offline shell + minimal manifest                              | F-02 outcome is "shell loads offline"; installability is a later concern.               | Plan               |

## Scope

**In scope:** Dexie store + derived types; hand-rolled outbox; `POST /api/inspections/sync` (put + delete, RLS, casing, owner stamping); `@vite-pwa/astro` SW + offline shell (auth routes excluded); throwaway demo island/page; unit + endpoint + Playwright e2e tests.

**Out of scope:** Multi-tab leader election (S-08); `@tanstack/offline-transactions`; CRDTs/HLC; notes-granularity table (S-05); full installable PWA; batch/multi-entity sync; pushing the migration to hosted Supabase (S-02); camel-casing the DB.

## Architecture / Approach

Assemble proven parts. Client (browser-only): Dexie store + outbox + a `useLiveQuery` island; writes are optimistic and enqueued atomically. Boundary: a same-origin `fetch` carries the auth cookie to `POST /api/inspections/sync`, the **single place** casing converts and server authority is re-established (strip `synced`, stamp `owner_id`, upsert under RLS, return authoritative row). The `@vite-pwa/astro` service worker is a separate browser artifact precaching the static shell so offline reloads work; it never touches the Cloudflare Worker.

## Phases at a Glance

| Phase                     | What it delivers                                                | Key risk                                                        |
| ------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| 1. Store + types          | Client-only Dexie store, derived camelCase types, unit tests    | `CamelCasedPropertiesDeep` derivation tracking generated types  |
| 2. Sync endpoint          | `POST /api/inspections/sync` with casing + RLS + owner stamping | Casing transform / not trusting client `owner_id`               |
| 3. Client outbox + island | Optimistic write, FIFO replay, demo page                        | SSR import discipline (Dexie must stay client-only)             |
| 4. SW shell + e2e         | Offline app shell + capstone Playwright round-trip              | SW only runs in build; auth-route caching exclusion correctness |

**Prerequisites:** F-01 (implemented) — `inspections` table + `set_updated_at()` trigger + RLS exist locally.
**Estimated effort:** ~3–4 sessions across 4 phases (unfamiliar tech: Dexie, PWA, Playwright — pull current APIs via Context7).

## Open Risks & Assumptions

- Multi-tab concurrent replay is knowingly unhandled in F-02 (single-device assumption); hardened in S-08.
- `@vite-pwa/astro` SSR config + Playwright API are pulled via Context7 at implement time — exact syntax not locked here.
- Service worker behavior only manifests in a built+previewed app, not `astro dev` — testing must use `npm run build && npm run preview`.
- Workerd parity: smoke-test the deployed sync endpoint with `wrangler tail` (`lessons.md`).

## Success Criteria (Summary)

- A record saved offline survives an offline page reload (app shell loads from the SW) and syncs automatically on reconnect.
- The sync endpoint enforces RLS, stamps `owner_id` from the session, and round-trips casing — verified by unit + endpoint + Playwright e2e tests, all passing.
- Signing in/out still works (the SW never cached auth routes or a stale authenticated shell).
