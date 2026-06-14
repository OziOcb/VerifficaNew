# S-02 Dashboard + Inspection Lifecycle Implementation Plan

## Overview

Build the first user-visible domain slice: a tiled dashboard grouped Draft/Completed, with start, resume, and hard-delete of inspections, capped at 2 inspections per account. This exercises the F-01 (owner-private `inspections` + RLS) and F-02 (sync endpoint) foundations end-to-end through a real lifecycle surface.

Per the frame brief (`frame.md`, Confidence **HIGH**), the dashboard is an **online, server-rendered read surface + synchronous lifecycle mutations** — explicitly **not** an offline-first surface. Offline is scoped to the in-inspection flow (S-05→S-08), so S-02 does **not** build a server→local hydrate path (research's "GAP 3" is out of scope).

## Current State Analysis

- **`inspections` table exists** (`supabase/migrations/20260610181920_create_inspections.sql`): `id, owner_id, status ('draft'|'completed' CHECK), name, created_at, updated_at`; reusable `set_updated_at()` trigger; four RLS policies scoped `owner_id = (select auth.uid())`; `on delete cascade` FK to `auth.users`. The migration comment (`:13-14`) explicitly defers **the 2-inspection limit to S-02**.
- **Sync endpoint exists** (`src/pages/api/inspections/sync.ts`): `POST` with `{op:"put"|"delete", entityId, payload?}`; 401 without session; `delete` → RLS-scoped delete → 204; `put` → strip `synced`, stamp `owner_id` from session, snake_case → `upsert().select().single()` → camelCase row. This is the single casing boundary.
- **F-02 offline layer** (`src/lib/db.ts`, `src/lib/sync.ts`): Dexie store + outbox + `startAutoSync` + `resetLocalStoreOnUserChange`. **Client-only** — `@/lib/db` and `@/lib/sync` must never reach an SSR path (Dexie has no global on workerd). Push-only; no list/hydrate path.
- **Dashboard is a placeholder** (`src/pages/dashboard.astro`): welcome + email + server signout form. Already protected via `PROTECTED_ROUTES = ["/dashboard"]` (`src/middleware.ts:4`).
- **Auth pattern to mirror**: `SignInForm.tsx` (`client:load` form) → `POST /api/auth/signin` → `context.redirect`. Signout (`src/pages/api/auth/signout.ts`) is a server form POST → redirect `/`; it does **not** clear Dexie.
- **shadcn inventory**: only `src/components/ui/button.tsx`. Missing & needed: `Card`, `Dialog`, `AlertDialog`. Config is new-york / `rsc:false` / `lucide-react` (`components.json`); `cn()` in `src/lib/utils.ts`.
- **Throwaway demo present**: `src/pages/offline-demo.astro` + `src/components/offline/OfflineDemo.tsx` — the only current consumer of the F-02 layer; S-02 subsumes and deletes it.
- **Status TS type is widened to `string`** (`src/db/database.types.ts`) even though the DB CHECK is `'draft'|'completed'`.
- **Casing rule** (`context/foundation/lessons.md`): camelCase across all app layers; snake_case only in Postgres + the one sync boundary; convert at a boundary, never per-table.

## Desired End State

A signed-in user lands on `/dashboard` and sees their inspections as tiles grouped into Draft and Completed (or an empty-state CTA). "Start new inspection" shows the startup instruction pop-up (with `Don't show again`), then creates a draft and navigates to a placeholder inspection page. A 3rd start is blocked by a limit pop-up. Each tile can be resumed (navigates to the placeholder) or hard-deleted after confirmation, freeing a slot. The 2-limit is enforced authoritatively by a DB trigger. The throwaway demo is gone, signout clears the local store, the migrations are pushed to hosted Supabase, and F-02 check 4.8 is closed.

**Verify**: `npm test` (RLS + limit), `npm run lint`, `npm run build` all pass; manual walk-through of create/resume/delete/limit on the workerd dev runtime; deployed `wrangler tail` shows a clean `/api/inspections/sync` round-trip.

### Key Discoveries:

- The limit must be **server-authoritative** — a `BEFORE INSERT` trigger counting `owner_id` rows, mirroring `set_updated_at` (`...create_inspections.sql:19-26,42-45`). The client Dexie count is per-device/stale and untrusted.
- SSR read is the established pattern: `createClient(Astro.request.headers, Astro.cookies)` + `.select()` runs under RLS exactly like middleware (`src/middleware.ts:6-16`, `src/lib/supabase.ts:6-25`).
- Delete plumbing already exists end-to-end (`/api/inspections/sync` `op:"delete"` → 204); S-02 calls it **synchronously** (awaited inline) rather than via the outbox.
- The trigger fires on **INSERT only** — resume/edit and `upsert`-on-existing never trip it.

## What We're NOT Doing

- **No server→local hydrate/list path** (research GAP 3). The dashboard reads via SSR, not Dexie.
- **No offline-first dashboard.** Create/delete require connectivity; offline survival is S-08.
- **No outbox path for dashboard mutations.** Create/delete are synchronous online calls; the F-02 outbox (`saveInspection`) stays for the in-inspection flow (S-05+).
- **No auto-naming from Make/Model** (FR-006) — needs Part 1 columns that arrive in S-03. S-02 stamps an auto placeholder name.
- **No real Part 1 / session screen** — resume routes to a stub. S-03/S-04 own those.
- **No `resetLocalStoreOnUserChange` wiring on the dashboard** — nothing reads Dexie here; S-05 reintroduces it with the offline answering surface. (The defensive signout wipe is still added — see Phase 3.)

## Implementation Approach

Build bottom-up: (1) land and test the authoritative limit trigger; (2) add the thin synchronous mutation layer (create endpoint + client fetch helpers, delete reusing the sync endpoint); (3) build the SSR-read dashboard UI with its dialogs and the stub resume route; (4) remove the demo, push to hosted Supabase, and close F-02 4.8.

The dashboard renders as: SSR frontmatter fetches + camelCases the list and computes the count → a single `client:load` `DashboardBoard` island receives `{ inspections, userId }` as props and owns all interactivity (tiles, dialogs, fetch mutations). A separate `client:only` `SignOutButton` island is the **only** Dexie consumer. This split keeps the Dexie-importing code off every SSR path.

## Critical Implementation Details

- **SSR import discipline (load-bearing).** `dashboard.astro` frontmatter and the `DashboardBoard` island must never import `@/lib/db` or `@/lib/sync` (Dexie has no global on workerd — build/render throws; see `src/lib/db.ts:1-4`). The fetch helpers in `src/lib/inspections.ts` must be Dexie-free. Only `SignOutButton` imports `@/lib/db`, so it must be mounted `client:only="react"`.
- **Casing at the SSR boundary.** The SSR `.select()` returns snake_case rows; convert to camelCase with `camelcaseKeys(data, { deep: true })` in the frontmatter before passing to the island, so the React layer stays camelCase (`lessons.md`). This is the same convert-at-the-boundary rule the sync endpoint follows.
- **Limit feedback is two-layered.** SSR knows the count, so the island opens the limit pop-up instantly when count ≥ 2 (no round-trip). The trigger → 409 is the race backstop for an over-limit insert that slipped past the stale prop.

## Phase 1: DB limit trigger + tests

### Overview

Land the authoritative 2-inspection limit as a `BEFORE INSERT` trigger and prove it with a test. Local migration only (hosted push is Phase 4).

### Changes Required:

#### 1. Limit-enforcement migration

**File**: `supabase/migrations/<new-timestamp>_inspections_two_limit.sql`

**Intent**: Add a `BEFORE INSERT` trigger that rejects an insert when the owner already has 2 inspections (any status — drafts and completed both count, FR-007). Mirror the `set_updated_at` trigger-function + trigger pattern established in the F-01 migration.

**Contract**: New `public.enforce_inspection_limit()` `returns trigger language plpgsql`; counts `public.inspections where owner_id = new.owner_id`; if `>= 2`, `raise exception` with a **distinctive, stable message** (`'inspection_limit_reached'`) so the endpoint can map it to 409 reliably (match on message, not SQLSTATE). New trigger `inspections_enforce_limit before insert on public.inspections for each row execute function public.enforce_inspection_limit()`. No columns change → no `db:types` regen needed.

#### 2. Apply locally

**File**: (command, not a file) — apply the migration to the local Supabase so tests run against it (e.g. `npx supabase db push` to local, or `npx supabase migration up` / `db reset` per the project's local flow in README).

#### 3. Limit test

**File**: `tests/inspections.limit.test.ts` (new) — or a new `describe` block in `tests/inspections.rls.test.ts`

**Intent**: Prove the trigger rejects a 3rd inspection for one owner and that delete frees a slot. Reuse the `createConfirmedUser` / `signInAs` / `deleteUser` harness (`tests/helpers/supabase.ts`).

**Contract**: With a confirmed user signed in (RLS-subject client): inserting inspections 1 and 2 succeeds; inserting a 3rd returns a non-null error (the raised exception surfaces as a PostgREST error). After deleting one row, a fresh insert succeeds again. Keep the existing RLS suite green (its "A can insert a row for itself" path tops out at 2 rows, so it stays under the cap).

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly to local Supabase
- [ ] Limit test passes and existing RLS suite still green: `npm test`
- [ ] Linting passes: `npm run lint`

#### Manual Verification:

- [ ] In local Supabase Studio (or psql), a 3rd `INSERT` for one `owner_id` is rejected with the `inspection_limit_reached` message; an `UPDATE` of an existing row is unaffected by the trigger

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Mutation server layer

### Overview

Add the synchronous online create path and the thin client fetch helpers. Delete reuses the existing sync endpoint.

### Changes Required:

#### 1. Create endpoint

**File**: `src/pages/api/inspections/create.ts` (new) — `POST`

**Intent**: Server-authoritatively create one draft inspection. The client supplies **no** trusted fields; the server stamps `owner_id` from the session, `status:'draft'`, and an auto placeholder `name`. Map the trigger's limit rejection to a distinct status so the client can show the limit pop-up. Mirror the existing endpoints' structure (`createClient` null-check → 503; `context.locals.user` null-check → 401).

**Contract**: Requires session (401 otherwise). Inserts `{ owner_id: user.id, status: 'draft', name: <auto placeholder, e.g. "Draft inspection — YYYY-MM-DD"> }` via `.insert(...).select("id").single()` under RLS. On success → `201` JSON `{ id }`. If `error.message` contains `inspection_limit_reached` → `409` (limit). Other errors → `400`/`500`. (No camel/snake transform needed — the row is generated server-side from scalars.)

#### 2. Client fetch helpers

**File**: `src/lib/inspections.ts` (new — Dexie-free, safe to import in a `client:load` island)

**Intent**: Two thin awaited `fetch` wrappers for the synchronous mutation path, distinct from the F-02 outbox. Same-origin so the auth cookie rides along.

**Contract**:

- `createInspection(): Promise<{ ok: true; id: string } | { ok: false; limitReached: boolean }>` — `POST /api/inspections/create`; on 201 return `{ok:true,id}`; on 409 return `{ok:false,limitReached:true}`; other non-ok → `{ok:false,limitReached:false}`.
- `deleteInspection(id: string): Promise<boolean>` — `POST /api/inspections/sync` with body `{ op:"delete", entityId:id }` (reuses the existing endpoint's delete branch → 204). Returns `res.ok`.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking + lint pass: `npm run lint`
- [ ] Build passes: `npm run build`

#### Manual Verification:

- [ ] On the workerd dev runtime (`npm run dev`), `POST /api/inspections/create` for a fresh account returns `201 {id}`; a 3rd call returns `409`; unauthenticated returns `401`
- [ ] `POST /api/inspections/sync {op:"delete",entityId}` returns `204` and the row is gone in Studio

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Dashboard UI + stub resume route

### Overview

Replace the placeholder dashboard with the real tiled lifecycle surface, wire all dialogs, add the Dexie-wiping signout, and create the stub resume target.

### Changes Required:

#### 1. shadcn components

**File**: `src/components/ui/{card,dialog,alert-dialog}.tsx` (via shadcn CLI)

**Intent**: Add `Card` (tiles), `Dialog` (startup instruction + limit pop-ups), `AlertDialog` (destructive delete confirm — shadcn's destructive-action convention). Use the project's new-york / `rsc:false` config.

**Contract**: `npx shadcn@latest add card dialog alert-dialog`. No hand-reordering of Tailwind classes (Prettier sorts).

#### 2. Status narrowing helper

**File**: `src/lib/inspections.ts` (extend) or a small local type in the board island

**Intent**: Narrow the DB-widened `status: string` to `"draft" | "completed"` for grouping logic (research note).

**Contract**: Export `type InspectionStatus = "draft" | "completed"` and group by it; treat unknown as draft defensively.

#### 3. SSR read + frontmatter

**File**: `src/pages/dashboard.astro`

**Intent**: Fetch the signed-in user's inspections under RLS at render, camelCase them, compute the count, and hand both islands their props. Replace the placeholder markup.

**Contract**: `const supabase = createClient(Astro.request.headers, Astro.cookies)`; null-check (render a configuration notice if null). `.from("inspections").select("id,status,name,created_at,updated_at").order("created_at",{ascending:false})`; `camelcaseKeys(data ?? [], {deep:true})`. Render `<DashboardBoard client:load inspections={...} />` and `<SignOutButton client:only="react" />`. **Do not** import `@/lib/db`/`@/lib/sync` here.

#### 4. Dashboard board island

**File**: `src/components/dashboard/DashboardBoard.tsx` (new, `client:load`)

**Intent**: Own all dashboard interactivity. Seed local React state from the SSR `inspections` prop. Render tiles grouped Draft/Completed using `Card`; render an empty-state CTA when there are none (FR-006). "Start new inspection" → if count ≥ 2 open the limit `Dialog`; else open the startup-instruction `Dialog` (unless `Don't show again` is set in localStorage, in which case create directly) → on confirm call `createInspection()` → on `{ok:true,id}` navigate to `/inspections/{id}`, on `{limitReached:true}` open the limit `Dialog`. Each tile: Resume → navigate to `/inspections/{id}`; Delete → `AlertDialog` confirm → `deleteInspection(id)` → remove from local state (frees the slot, re-enables Start). Dexie-free.

**Contract**: Props `{ inspections: Inspection[] }` (camelCase, `synced` omitted — SSR shape). Uses `createInspection`/`deleteInspection` from `@/lib/inspections`. Navigation via `window.location.assign`. Startup `Don't show again` flag → localStorage key `veriffica:hideStartupInstructions`.

#### 5. Startup instruction content

**File**: `src/components/dashboard/DashboardBoard.tsx` (or a small `StartupInstructions.tsx` sibling)

**Intent**: Condense the helper-tool disclaimer + how-to from `idea/veriffica-instruction.md` into the startup `Dialog` body, with a `Don't show again` checkbox (FR-009). English-only (FR-024).

**Contract**: Static copy lifted/condensed from `idea/veriffica-instruction.md` (helper-tool framing: "auxiliary tool… does not guarantee… good starting point"). Checkbox toggles the localStorage flag on confirm.

#### 6. Signout with Dexie-wipe

**File**: `src/components/dashboard/SignOutButton.tsx` (new, `client:only="react"`)

**Intent**: Replace the plain server signout form with a button that clears the local Dexie store **before** submitting signout — the inherited F-02 obligation, homed here in the "real signout UI". Importing `@/lib/db` forces `client:only`.

**Contract**: On click: `await db.delete()` (or clear both tables in a tx) then submit a `POST /api/auth/signout` form (or `window.location` after the wipe). Reuses existing `src/pages/api/auth/signout.ts`.

#### 7. Stub resume route + protection

**File**: `src/pages/inspections/[id].astro` (new) and `src/middleware.ts`

**Intent**: Give resume/start a real navigation target. SSR-load the inspection by id under RLS; if not found (RLS hides others' / nonexistent) redirect to `/dashboard`. Render a placeholder body ("Part 1 — coming in S-03"). Protect the route.

**Contract**: Frontmatter `createClient(...).from("inspections").select().eq("id", Astro.params.id).maybeSingle()`; redirect to `/dashboard` when null. Add `"/inspections"` to `PROTECTED_ROUTES` (prefix match covers `/inspections/[id]`).

### Success Criteria:

#### Automated Verification:

- [ ] `astro sync` + lint pass (type-checked, react-compiler clean): `npm run lint`
- [ ] Build passes: `npm run build`

#### Manual Verification:

- [ ] Empty account shows the empty-state CTA; creating shows the startup pop-up, then navigates to the stub `/inspections/{id}`
- [ ] `Don't show again` suppresses the startup pop-up on the next start (persists across reload)
- [ ] Tiles render grouped Draft/Completed; resume navigates to the stub; delete asks for confirmation, removes the tile, and frees a slot
- [ ] With 2 inspections, "Start" opens the limit pop-up and no 3rd is created
- [ ] Signing out clears Dexie (IndexedDB `veriffica` DB emptied in DevTools) and redirects to `/`
- [ ] Visiting `/inspections/<someone-else's-id>` redirects to `/dashboard`

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Cleanup, hosted deploy & F-02 4.8 closeout

### Overview

Remove the throwaway demo, push migrations to hosted Supabase, deploy, run the inherited workerd-parity smoke-test, and update the foundation docs.

### Changes Required:

#### 1. Delete the throwaway demo

**File**: remove `src/pages/offline-demo.astro` and `src/components/offline/OfflineDemo.tsx`

**Intent**: The real dashboard subsumes the demo (research obligation #1). Confirm nothing else imports them.

**Contract**: Both files deleted; `npm run build` still passes (the only consumer is gone).

#### 2. Push migrations to hosted Supabase

**File**: (commands) — `npx supabase link --project-ref <ref>` then `npx supabase db push`

**Intent**: DB migrations are not in the Cloudflare deploy pipeline. As the first slice reading/writing `inspections`, S-02 must apply **both** the F-01 migration (never pushed) and the new Phase 1 limit migration to hosted Supabase before the UI ships (roadmap S-02 Deploy note).

**Contract**: `db push` reports both migrations applied to the hosted project; hosted `inspections` table + RLS + both triggers present.

#### 3. Deploy + close F-02 check 4.8

**File**: (commands) — production auto-deploys on push to `main` (Workers Builds); then `npx wrangler tail`

**Intent**: Validate the deployed `/api/inspections/sync` round-trip on workerd (the parity smoke-test F-02 deferred because `inspections` wasn't on hosted Supabase until now).

**Contract**: With `wrangler tail` attached, exercise a live create/delete; confirm **no Node-API runtime error** on workerd (`lessons.md` parity rule). Then check off F-02 manual item 4.8 in `context/changes/offline-first-persistence-layer/plan.md`.

#### 4. Update foundation docs

**File**: `context/foundation/roadmap.md` (+ F-02 change.md follow-up)

**Intent**: Flip **F-02 → implemented** (4.8 closed) and **S-02 → implemented**.

**Contract**: Roadmap "At a glance" + slice statuses updated; F-02 change.md follow-up marked done.

### Success Criteria:

#### Automated Verification:

- [ ] Build passes after demo removal: `npm run build`
- [ ] Full check passes: `npm test` && `npm run lint`

#### Manual Verification:

- [ ] `db push` applied both migrations to hosted Supabase (verified in hosted Studio)
- [ ] Deployed `wrangler tail` shows a clean `/api/inspections/sync` round-trip with no workerd Node-API error
- [ ] F-02 check 4.8 checked off; F-02 and S-02 statuses flipped to `implemented`
- [ ] Production dashboard create/resume/delete/limit works end-to-end against hosted Supabase

**Implementation Note**: Final phase — confirm production behavior before closing the slice.

---

## Testing Strategy

### Unit / Integration Tests:

- Limit trigger: 3rd insert rejected; delete frees a slot (`tests/inspections.limit.test.ts`).
- Existing RLS isolation suite stays green (stays under the 2-row cap).

### Manual Testing Steps:

1. Fresh account → empty-state CTA → Start → startup pop-up → create → land on stub.
2. `Don't show again` → next Start skips the pop-up (survives reload).
3. Create a 2nd → Start now opens the limit pop-up; no 3rd created.
4. Delete a tile (with confirm) → slot freed → Start works again.
5. Resume a tile → stub page for that id; foreign id → redirect to `/dashboard`.
6. Signout → IndexedDB `veriffica` cleared.
7. Deployed: `wrangler tail` round-trip clean.

## Performance Considerations

Trivial scale (≤2 rows/owner). The `inspections_owner_id_idx` already supports the SSR list and the trigger's count.

## Migration Notes

Two migrations reach hosted Supabase for the first time in Phase 4 (F-01 baseline + the new limit trigger). No data backfill — the table is empty in production.

## References

- Frame brief: `context/changes/inspection-dashboard-lifecycle/frame.md`
- Research: `context/changes/inspection-dashboard-lifecycle/research.md`
- Sync endpoint (delete reuse): `src/pages/api/inspections/sync.ts:37-42`
- Trigger pattern: `supabase/migrations/20260610181920_create_inspections.sql:19-26,42-45`
- SSR read pattern: `src/middleware.ts:6-16`, `src/lib/supabase.ts:6-25`
- Auth form→POST→redirect: `src/components/auth/SignInForm.tsx`, `src/pages/api/auth/signin.ts`
- Casing rule: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB limit trigger + tests

#### Automated

- [x] 1.1 Migration applies cleanly to local Supabase — 94b90ec
- [x] 1.2 Limit test passes and existing RLS suite still green: `npm test` — 94b90ec
- [x] 1.3 Linting passes: `npm run lint` — 94b90ec

#### Manual

- [x] 1.4 3rd INSERT rejected with `inspection_limit_reached`; UPDATE unaffected by the trigger — 94b90ec

### Phase 2: Mutation server layer

#### Automated

- [x] 2.1 Type checking + lint pass: `npm run lint` — 3f0e68b
- [x] 2.2 Build passes: `npm run build` — 3f0e68b

#### Manual

- [x] 2.3 `POST /api/inspections/create` returns 201/409/401 as expected on workerd dev — 3f0e68b
- [x] 2.4 `POST /api/inspections/sync {op:"delete"}` returns 204 and removes the row — 3f0e68b

### Phase 3: Dashboard UI + stub resume route

#### Automated

- [x] 3.1 `astro sync` + lint pass (react-compiler clean): `npm run lint` — 4a23143
- [x] 3.2 Build passes: `npm run build` — 4a23143

#### Manual

- [x] 3.3 Empty-state CTA → create → startup pop-up → navigate to stub — 4a23143
- [x] 3.4 `Don't show again` suppresses the startup pop-up across reload — 4a23143
- [x] 3.5 Tiles grouped Draft/Completed; resume navigates; delete confirms, removes tile, frees slot — 4a23143
- [x] 3.6 With 2 inspections, Start opens the limit pop-up; no 3rd created — 4a23143
- [x] 3.7 Signout clears Dexie and redirects to `/` — 4a23143
- [x] 3.8 Foreign `/inspections/<id>` redirects to `/dashboard` — 4a23143

### Phase 4: Cleanup, hosted deploy & F-02 4.8 closeout

#### Automated

- [x] 4.1 Build passes after demo removal: `npm run build`
- [x] 4.2 Full check passes: `npm test` && `npm run lint`

#### Manual

- [x] 4.3 `db push` applied both migrations to hosted Supabase
- [ ] 4.4 Deployed `wrangler tail` shows a clean `/api/inspections/sync` round-trip (no workerd Node-API error)
- [ ] 4.5 F-02 check 4.8 checked off; F-02 and S-02 flipped to `implemented`
- [ ] 4.6 Production create/resume/delete/limit works end-to-end against hosted Supabase
