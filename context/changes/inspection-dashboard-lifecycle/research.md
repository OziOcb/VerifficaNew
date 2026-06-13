---
date: 2026-06-13T19:37:04+0100
researcher: OziOcb
git_commit: 448fa0c34614eed1629af6a69ce31ecf0035f6aa
branch: feat/inspection-dashboard-lifecycle
repository: VerifficaNew
topic: "S-02 dashboard + inspection lifecycle — wiring into the F-01 (schema/RLS) and F-02 (offline-first) foundations"
tags: [research, codebase, inspections, offline-first, rls, dashboard, dexie, sync]
status: complete
last_updated: 2026-06-13
last_updated_by: OziOcb
---

# Research: S-02 dashboard + inspection lifecycle — F-01/F-02 wiring

**Date**: 2026-06-13T19:37:04+0100
**Researcher**: OziOcb
**Git Commit**: 448fa0c34614eed1629af6a69ce31ecf0035f6aa
**Branch**: feat/inspection-dashboard-lifecycle
**Repository**: VerifficaNew

## Research Question

For the S-02 "dashboard + inspection lifecycle" slice (see, start, resume, hard-delete inspections; hit the 2-inspection limit), how do the F-01 (domain schema + RLS) and F-02 (offline-first persistence + sync) foundations actually wire together in the live code, what exact APIs must S-02 call, and what gaps must S-02 close?

## Summary

The two foundations give S-02 a solid spine — an RLS-isolated `inspections` table, a typed SSR Supabase client, a client-only Dexie store with an optimistic write + outbox + auto-sync, and a single server sync endpoint — but they were built to round-trip **one locally-created record**, not to back a **dashboard that lists existing rows and enforces a per-account cap**. Three structural gaps dominate the plan:

1. **No server→local hydrate/list path exists.** The offline layer is push-only (outbox drain). On a fresh login the Dexie store is _wiped_ and never repopulated, so a dashboard reading only Dexie would show empty even when the user has inspections on the server. This is the single biggest design decision for S-02. (`src/lib/sync.ts`, no `.select()` except the upsert's own RETURNING.)
2. **The 2-inspection limit is enforced nowhere.** The F-01 migration explicitly punted it to S-02 (`...create_inspections.sql:14`). It must be server-authoritative (the offline client store is untrusted), which interacts awkwardly with optimistic creation.
3. **No `deleteInspection` client helper.** The delete _plumbing_ exists end-to-end (outbox `op:"delete"` → endpoint → 204), but nothing enqueues a delete; S-02 must add the helper mirroring `saveInspection`.

Plus the expected surface work (the real dashboard UI, startup + limit pop-ups, `Don't show again` persistence) and inherited obligations (delete the throwaway `/offline-demo`, hook a signout store-wipe, push the migration to hosted Supabase, close F-02 check 4.8).

A key sequencing wrinkle: **"resume" has nowhere to route yet** — the Part 1 form (S-03) and session screen (S-04) don't exist. S-02 must pick a placeholder destination.

## Detailed Findings

### F-02 — Offline-first layer (the APIs S-02 calls)

**Dexie store** — `src/lib/db.ts`

- `type Inspection = CamelCasedPropertiesDeep<Database["public"]["Tables"]["inspections"]["Row"]> & { synced: 0 | 1 }` (`db.ts:14-15`) — camelCase, auto-tracks `npm run db:types`. Shape: `{ id, ownerId, status, name, createdAt, updatedAt, synced }`.
- `interface ChangeOp { seq?; entity:"inspections"; entityId; op:"put"|"delete"; payload:Inspection; createdAt:number }` (`db.ts:20-27`).
- Schema v1 (`db.ts:34-37`): `inspections: "id, ownerId, updatedAt, synced"`, `changeQueue: "++seq, entity, entityId, createdAt"`. `id` is a client-supplied uuid (same id locally and in Supabase); `synced` indexed as `0|1` (booleans aren't indexable).
- Exports: `db`, types `Inspection` / `ChangeOp` (`db.ts:42-43`).

**Sync helpers** — `src/lib/sync.ts` (exports: `resetLocalStoreOnUserChange`, `saveInspection`, `flushQueue`, `startAutoSync` — **no delete, no list**)

- `saveInspection(input: SaveInput): Promise<void>` (`sync.ts:47-69`). `SaveInput = Pick<Inspection,"id"> & Partial<Pick<Inspection,"status"|"name"|"ownerId"|"createdAt">>` (`sync.ts:39`). Defaults `status:"draft"`, `ownerId:""` (server stamps real value), timestamps to now, `synced:0`; writes the row + a `put` `ChangeOp` **atomically in one `rw` transaction** (the no-data-loss mechanism).
- `flushQueue(): Promise<void>` (`sync.ts:84-92`) → internal `drainQueue` (`sync.ts:94-127`): reads `changeQueue` FIFO by `createdAt`, POSTs `{ op, entityId, payload }` to `/api/inspections/sync`; on error **breaks** (rest stays queued, retried next signal); on `delete`(204) drops local row + queue entry in a tx; on `put`(200) **adopts the server's authoritative camelCase row** (server-stamped `ownerId`/`updatedAt`), sets `synced:1`, deletes the queue entry. Reentrancy-guarded.
- `startAutoSync(): () => void` (`sync.ts:151-184`) — drains on **four signals**: initial mount, `online` event, `visibilitychange`, and a 4s retry poll while ops remain queued. Returns a cleanup. (Richer than the original plan's single `online` listener.)
- `resetLocalStoreOnUserChange(userId): Promise<void>` (`sync.ts:27-34`) — compares `localStorage:veriffica:lastOwnerId`; if changed, **wipes both Dexie tables** in a tx and updates the marker. Prevents one user seeing another's cached rows on a shared device.

**Sync endpoint** — `src/pages/api/inspections/sync.ts`

- `POST` (`sync.ts:23-60`). Input `{ op:"put"|"delete", entityId, payload? }` (`sync.ts:17-21`). 401 if `context.locals.user` missing (`:27-28`). `delete`: `supabase.from("inspections").delete().eq("id", entityId)` → 204 (`:37-42`). `put`: strip `synced`, stamp `ownerId = user.id` (overrides client), snake_case → `upsert(payload).select().single()` → return camelCase row (`:48-59`). RLS does the owner-scoping; it's a **blind upsert with no count check** (relevant to the limit gap).

**Today's only consumer** is the throwaway demo — `src/components/offline/OfflineDemo.tsx` (`client:only="react"`, `offline-demo.astro:14`), which calls `resetLocalStoreOnUserChange` + `startAutoSync` in a `useEffect`, `useLiveQuery(() => db.inspections.orderBy("updatedAt").toArray())` for the list, and `saveInspection` on a button. **S-02's dashboard reimplements this same wiring pattern** and then deletes the demo.

### F-01 — Schema + RLS (what S-02 reads/writes)

**Migration** — `supabase/migrations/20260610181920_create_inspections.sql`

- Columns (`:29-36`): `id uuid pk default gen_random_uuid()`, `owner_id uuid not null references auth.users(id) on delete cascade`, `status text not null default 'draft' check (status in ('draft','completed'))`, `name text`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
- **`status` is a CHECK constraint, not an enum** — exactly `'draft' | 'completed'`. Maps 1:1 to the dashboard's Draft/Completed grouping. (But the generated TS type widens it to `string` — see below.)
- Trigger `inspections_set_updated_at` BEFORE UPDATE runs `set_updated_at()` (`:19-26, 42-45`) → server is the LWW authority on `updated_at`.
- Index `inspections_owner_id_idx` (`:39`).
- RLS enabled (`:48`); four policies for role `authenticated` (`:62-85`), all subquery form `(select auth.uid())`: SELECT `using owner_id = auth.uid()`; INSERT `with check owner_id = auth.uid()`; UPDATE `using + with check`; DELETE `using`.
- Comment (`:13-14`): "lifecycle SKELETON only: no Part 1 config columns (S-03), **no 2-inspection limit (S-02)**" — the cap was deliberately deferred to this slice.

**Generated types** — `src/db/database.types.ts:37-62`. `Row` has snake_case fields; `status: string` (not narrowed to the union); `Insert` requires `owner_id`, `status?` optional. Timestamps are ISO strings.

**SSR client** — `src/lib/supabase.ts:1-25`. `createClient(requestHeaders: Headers, cookies: AstroCookies): SupabaseClient<Database> | null`; returns `null` when `SUPABASE_URL`/`SUPABASE_KEY` unset (always null-check). Built on `createServerClient` from `@supabase/ssr`.

**RLS test pattern S-02 reuses** — `tests/inspections.rls.test.ts` + `tests/helpers/supabase.ts`: `createConfirmedUser`, `signInAs` (anon key, RLS-subject), `adminClient` (service role, bypasses RLS). Asserts cross-account select/update/delete return empty (not 403) and that INSERT with a foreign `owner_id` is actively rejected by WITH CHECK.

### UI scaffold, auth & routing (what S-02 builds on)

- `src/pages/dashboard.astro` — placeholder only (welcome + email + signout form). Reads `Astro.locals.user`. No tiles/grouping/actions. Already protected.
- `src/middleware.ts` — `PROTECTED_ROUTES = ["/dashboard"]` (`:4`); populates `context.locals.user` via `supabase.auth.getUser()` (`:6-16`); redirects unauthenticated protected hits to `/auth/signin` (`:18-22`). Prefix match, so `/dashboard/*` is covered.
- `src/layouts/Layout.astro` — wraps pages; **SW registration guarded by `import.meta.env.PROD`** (`:41-48`); global CSS + manifest in head.
- **Island patterns**: `client:load` for interactive forms (`SignInForm` at `signin.astro:16`), `client:only="react"` for Dexie-backed (`OfflineDemo` at `offline-demo.astro:14`). The dashboard's Dexie-reading island must be `client:only="react"`.
- **Form → POST → redirect pattern** (mirror for create/delete): `SignInForm.tsx` (`<form method="POST" action="/api/auth/signin">` + `SubmitButton` using `useFormStatus`) → `src/pages/api/auth/signin.ts:4-20` (null-check client → 503-style redirect, action, redirect with `?error=` on failure).
- **shadcn/ui inventory** — only `src/components/ui/button.tsx` exists. **Missing and needed**: `Card` (tiles), `AlertDialog`/`Dialog` (delete confirm + limit/startup pop-ups). Add via shadcn CLI ("new-york", `lucide-react`, `rsc:false`). `cn()` ready in `src/lib/utils.ts`; Tailwind 4 via the Vite plugin, OKLch theme vars in `global.css`.

### Requirements (PRD) the wiring must satisfy

- **FR-006** (`prd.md:132`): tiled dashboard grouped Draft vs Completed, **auto-named from Make/Model** (± Year/Reg) — note auto-naming depends on Part 1 config columns that **don't exist yet** (S-03); for S-02 `name` is the only column. Resume from tile; empty-state CTA.
- **FR-007** (`prd.md:133-134`): **max 2 inspections per account — _any status_** (drafts + completed both count); limit pop-up when reached.
- **FR-008** (`prd.md:135`): hard delete after confirmation, frees a slot. Guardrail §"No accidental destructive actions" makes confirmation mandatory + irreversible.
- **FR-009** (`prd.md:136`): startup instruction pop-up (content from `idea/veriffica-instruction.md`, helper-tool disclaimer) with a **`Don't show again`** option → needs a per-device persisted flag (localStorage, not a synced domain field).
- **US-01** (`prd.md:85-96`): precondition "fewer than 2 existing inspections"; start → into Part 1 (S-03).

## Code References

- `src/lib/db.ts:14-43` — Dexie store, `Inspection`/`ChangeOp` types, schema, exports
- `src/lib/sync.ts:27-184` — `resetLocalStoreOnUserChange`, `saveInspection`, `flushQueue`/`drainQueue`, `startAutoSync` (no delete/list helper)
- `src/pages/api/inspections/sync.ts:17-60` — single sync endpoint; blind upsert, owner stamped server-side, delete→204
- `src/components/offline/OfflineDemo.tsx` / `src/pages/offline-demo.astro` — throwaway pattern to copy then delete
- `supabase/migrations/20260610181920_create_inspections.sql:13-45,62-85` — schema, `status` check, `set_updated_at` trigger, RLS policies, deferred-limit comment
- `src/db/database.types.ts:37-62` — generated Row/Insert/Update (`status: string`)
- `src/lib/supabase.ts:1-25` — `createClient` SSR factory, null-on-unset
- `tests/inspections.rls.test.ts` + `tests/helpers/supabase.ts` — RLS test harness to extend
- `src/middleware.ts:4-22` — `PROTECTED_ROUTES`, session population, redirect
- `src/pages/dashboard.astro` — placeholder to replace
- `src/components/auth/SignInForm.tsx` + `src/pages/api/auth/signin.ts:4-20` — form→POST→redirect pattern
- `src/components/ui/button.tsx` — only existing shadcn component
- `idea/veriffica-instruction.md` — startup pop-up copy source

## Architecture Insights

- **Push-only sync is the defining constraint.** The outbox model assumes the client _originates_ every row. A dashboard needs the opposite direction (server → client). S-02 must add a pull/hydrate path; two shapes:
  - (a) **SSR the list** in `dashboard.astro` frontmatter via the server Supabase client (RLS-scoped), render tiles server-side, and treat Dexie as the offline/optimistic layer for mutations only; or
  - (b) add **`GET /api/inspections`** + a client hydrate-into-Dexie step on load, keeping Dexie the single read source for the `useLiveQuery` tiles.
    Reconciling SSR-read (server) vs Dexie-read (client) is real work because **Dexie can't be imported server-side** (`db.ts` is client-only) — the two are separate code paths. The planner should pick one read model deliberately. (b) keeps offline reads working after the first online load; (a) is simpler but tiles won't render offline-first without extra hydration.
- **The 2-limit must be server-authoritative**, ideally a `BEFORE INSERT` trigger counting `owner_id` rows (can't be raced past RLS). But that surfaces as a _sync-time_ failure for an offline-created 3rd inspection. Practical resolution: a synchronous server "can I create?" check (the count from the list/hydrate path) gates optimistic creation client-side, with the trigger as the hard backstop. This ties Gap 1 to Gap 3 — solving the list/count read solves both.
- **Casing rule binds every layer** (`lessons.md:24-45`): camelCase in Dexie/React/fetch, snake_case only in Postgres + the one sync boundary; new list/hydrate code must convert at the same single boundary, never per-table.
- **Status type safety**: the DB enforces `draft|completed` but TS sees `string`. S-02 should narrow with a local union/branded type for the grouping logic.

## Historical Context (from prior changes)

- `context/changes/offline-first-persistence-layer/change.md:25-34` — **Logout cache-wipe deferred to S-02**: today signout is a plain server form with no client hook; adding a `db.delete()` on explicit signout "belongs to S-02's real dashboard/signout UI." Also records the **throwaway-demo removal** obligation.
- `context/changes/offline-first-persistence-layer/plan.md:202` — `startAutoSync` shipped richer than planned (4 drain signals + `resetLocalStoreOnUserChange`); `:218` notes `/offline-demo` is intentionally not in `PROTECTED_ROUTES`.
- `context/changes/offline-first-persistence-layer/plan.md:386` — **F-02 check 4.8 still open** (deployed `wrangler tail` workerd-parity smoke-test), explicitly inherited by S-02.
- `supabase/migrations/...create_inspections.sql:13-14` — author deferred Part 1 columns (S-03) and the 2-limit (S-02) by design.
- `context/foundation/roadmap.md:137-138` — S-02 owns the hosted **`db push`** and closing F-02 4.8.
- `context/foundation/lessons.md` — three binding rules: workerd parity smoke-test, field casing at one boundary, SW is build-only (`wrangler dev`, never `astro dev`).

## Obligations S-02 inherits (operational, not feature work)

1. **Delete the throwaway demo**: `src/pages/offline-demo.astro` + `src/components/offline/OfflineDemo.tsx`.
2. **Hook a signout store-wipe** (`db.delete()` / clear Dexie) into the explicit signout action.
3. **Push the F-01 migration to hosted Supabase** _before_ the UI ships: `npx supabase link --project-ref <ref>` → `npx supabase db push` (migrations are not in the Cloudflare deploy pipeline).
4. **Close F-02 check 4.8** post-deploy: `npx wrangler tail` against live `/api/inspections/sync`, confirm no Node-API runtime error, check off F-02 4.8, flip F-02 → `implemented`.

## Open Questions

- **Read model**: SSR the inspections list in `dashboard.astro` vs add `GET /api/inspections` + Dexie hydrate? (Affects offline-first behavior of the dashboard itself.) → for `/10x-plan` / a framing decision.
- **Resume target**: S-03 (Part 1 form) and S-04 (session screen) don't exist. Where does "resume"/"start" route in S-02 — a placeholder page, or is S-02 sequenced to land alongside S-03? → likely a `/10x-frame` scope question.
- **Limit enforcement shape**: DB trigger vs endpoint guard vs both; how to surface a sync-time limit rejection for an offline-created overflow row.
- **Auto-naming (FR-006)** depends on Make/Model from Part 1 columns that don't exist until S-03; for S-02 only `name` exists. Does S-02 ship with a manual/placeholder name and defer auto-naming, or is the dashboard naming deferred?

## Related Research

- `context/changes/offline-first-persistence-layer/research.md` — F-02 decisions (LWW server-authoritative, single-record sync endpoint, casing boundary, SW in F-02)
- `context/changes/offline-first-persistence-layer/dexie-reference.md` — Dexie API contracts
- `context/changes/domain-schema-rls-isolation/plan.md` — F-01 schema/RLS rationale
