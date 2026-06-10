# Domain Schema + RLS Isolation Contract — Implementation Plan

## Overview

Land the **first** SQL migration for Veriffica: a minimal `inspections` table protected by Row-Level Security so each row is private to its owning account. Alongside the table, establish the three conventions every later domain slice (S-02…S-09) will copy: the **RLS policy pattern**, the **TypeScript type-generation workflow**, and a **Vitest integration test** that proves — repeatably, in CI — that one account can never see or mutate another account's data.

This is roadmap item **F-01**. Its scope is deliberately narrow: the table is a lifecycle skeleton, not the full Part 1 config (S-03), and it carries no 2-inspection limit (S-02). The value is the _pattern_, landed once and verified, so no later slice has to retrofit data isolation.

## Current State Analysis

- **No migrations exist.** `supabase/migrations/` is absent; the only database objects are Supabase Auth's built-in `auth.users`. This change creates the migrations directory and its first file.
- **The SSR Supabase client is the RLS-enabling pattern.** `src/lib/supabase.ts` builds a `createServerClient` with the **anon/publishable** key and the user's session cookies. Because the user's JWT rides along, `auth.uid()` resolves inside Postgres, so a policy of `owner_id = auth.uid()` is enforced by the database itself — not by application code. This is the security boundary; app code never filters by owner.
- **No test framework is configured.** `package.json` has no Vitest/Playwright. The `supabase` CLI _is_ a devDependency (`supabase@^2.23.4`), so a local Supabase stack is available via `npx supabase`.
- **Env access is server-only and typed.** `SUPABASE_URL`/`SUPABASE_KEY` are declared in the `env.schema` of `astro.config.mjs` (`context: "server", access: "secret", optional: true`) and read via `astro:env/server`. Local secrets live in `.env` (for `npx supabase`) and `.dev.vars` (for the workerd dev runtime).
- **CI is a quality gate only** (`.github/workflows/ci.yml`): on PRs into `main`, it runs `npm ci` → `astro sync` → `lint` → `build`. It does **not** run a database or tests today. Production deploys are handled separately by Cloudflare Workers Builds; **database migrations are not part of that pipeline** and must be applied with `supabase db push`.
- **Local auth auto-confirms.** `supabase/config.toml` has `auth.email.enable_confirmations = false`, so users created locally are immediately usable — the test harness can seed users without an email round-trip.

## Desired End State

After this plan:

1. `supabase db reset` applies a single migration that creates `public.inspections` with RLS **enabled** and four per-command policies scoping every row to `owner_id = (select auth.uid())`.
2. `npm run db:types` regenerates `src/db/database.types.ts` from the live local schema, and the SSR client is typed as `SupabaseClient<Database>` so later slices get compile-time-checked queries.
3. `npm run test` runs a Vitest integration test against local Supabase that **proves isolation**: two seeded users each see/edit only their own inspection; cross-account `select`/`update`/`delete` return nothing / affect nothing.
4. CI runs that test against a real Supabase instance on every PR, so the isolation guarantee is continuously verified.

### Key Discoveries:

- RLS works because `src/lib/supabase.ts:9` passes the user session to `createServerClient` — `auth.uid()` is the trust anchor, so policies need no app-side help.
- `on delete cascade` on the `owner_id` → `auth.users(id)` FK is what will let **S-09** (account deletion) erase all domain data for free; included here as part of the pattern (the _deletion flow_ itself is out of scope).
- `auth.email.enable_confirmations = false` (`supabase/config.toml:209`) lets the test seed confirmed users directly; otherwise use the service_role admin API with `email_confirm: true`.
- Both a pgTAP test and a Vitest test would require Supabase running in CI — so the CI cost is identical; Vitest was chosen for client-path fidelity and reuse (see Key Decisions in the brief).

## What We're NOT Doing

- **No Part 1 config columns** (Price, Make, Model, fuel/transmission/drive/body, VIN, …) — that's S-03; the table stays a lifecycle skeleton.
- **No 2-inspection limit** (FR-007) — that's S-02's lifecycle concern; it needs the dashboard pop-up UX.
- **No account-deletion flow** (S-09) — only the cascade FK that _enables_ it later.
- **No app UI, page, or API endpoint** — nothing reads `inspections` yet; isolation is proven via the Vitest harness, not a rendered surface.
- **No prod migration push** — applied locally only; the `supabase db push` step is documented for whichever slice first ships a consuming UI (S-02).
- **No offline / Last-Write-Wins logic** (F-02) — `updated_at` is server-trigger-maintained for now; F-02 revisits whether offline edits need client-supplied timestamps.
- **No enum type for status** — text + CHECK constraint is used (simpler to extend via migration).

## Implementation Approach

Build in dependency order: **schema → types → test**. The migration is the source of truth; types are generated _from_ the applied schema; the test exercises the typed client against the live policies. Each phase is independently verifiable, so a failure is localized.

The RLS convention is intentionally explicit and commented in the migration, because that file becomes the template S-02+ copy. The trigger function (`set_updated_at`) is written as a **reusable** `public` function so later tables attach the same trigger rather than redefining it.

## Critical Implementation Details

- **RLS perf convention:** policies compare `owner_id` to `(select auth.uid())` — the subquery form, not bare `auth.uid()`. Postgres evaluates the subselect once per statement instead of once per row; this is Supabase's documented best practice and the reason to set the pattern now rather than refactor later.
- **`with check` vs `using`:** the `insert` policy needs `with check` (validates the _new_ row's `owner_id`); `update` needs **both** `using` (which rows are visible to update) and `with check` (the row can't be reassigned to another owner); `select`/`delete` need only `using`. Getting this split right is the auditable-per-command benefit.
- **Vitest runs in plain Node, not workerd and not `astro:env`.** The test reads local Supabase credentials from `process.env` (loaded from `.env`), independent of the app's `astro:env/server` schema. The **service_role** key (test-only, never in app code or the env schema) is needed to seed and tear down users; the per-user reads use the anon key + each user's session, exactly like the app.
- **Test isolation/cleanup:** seed two users via the service_role admin API, insert one inspection each, then assert with two anon clients. Tear down by deleting the two users — the cascade FK removes their inspections, leaving the database clean for reruns.

## Phase 1: Schema migration + RLS pattern

### Overview

Create the `inspections` table, enable RLS, add the four per-command policies, the shared `updated_at` trigger, and an `owner_id` index — all in one migration applied locally.

### Changes Required:

#### 1. First domain migration

**File**: `supabase/migrations/<timestamp>_create_inspections.sql` (generate the timestamped name with `npx supabase migration new create_inspections`)

**Intent**: Define the owner-private `inspections` table and the RLS contract every later table copies. Keep columns to the lifecycle skeleton; make the policies and trigger the reusable pattern.

**Contract**:

- Table `public.inspections`:
  - `id uuid primary key default gen_random_uuid()`
  - `owner_id uuid not null references auth.users(id) on delete cascade`
  - `status text not null default 'draft' check (status in ('draft','completed'))`
  - `name text`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
- `create index inspections_owner_id_idx on public.inspections(owner_id);`
- `alter table public.inspections enable row level security;`
- Four policies, each `to authenticated`:
  - `select`: `using (owner_id = (select auth.uid()))`
  - `insert`: `with check (owner_id = (select auth.uid()))`
  - `update`: `using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))`
  - `delete`: `using (owner_id = (select auth.uid()))`
- Reusable trigger: `create function public.set_updated_at() returns trigger ... set new.updated_at = now()`, attached as `before update` on `inspections`. Written generically so later tables reuse the same function.

A snippet is unnecessary — this is standard DDL; the contract above is the spec. The only non-obvious requirement is the `(select auth.uid())` wrapping and the `using`/`with check` split, both called out in Critical Implementation Details.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly from scratch: `npx supabase db reset`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- In Supabase Studio (`http://127.0.0.1:54323`), `inspections` shows RLS **enabled** with four named policies.
- Inserting a row via Studio SQL as an authenticated role respects `owner_id`; an anon query returns nothing.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Type generation + typed client

### Overview

Establish the schema → TypeScript workflow and apply it to the SSR client so every later query is type-checked.

### Changes Required:

#### 1. Type-generation script

**File**: `package.json`

**Intent**: Add a repeatable command to regenerate types from the local schema after any migration.

**Contract**: New script `"db:types": "supabase gen types typescript --local > src/db/database.types.ts"`. (Run requires local Supabase up.)

#### 2. Generated types

**File**: `src/db/database.types.ts` (generated, committed)

**Intent**: Commit the generated `Database` type so consumers and CI have it without needing Supabase running for a plain build.

**Contract**: Output of `npm run db:types` — exports the `Database` interface including `public.inspections` Row/Insert/Update types. Do not hand-edit.

#### 3. Typed SSR client

**File**: `src/lib/supabase.ts`

**Intent**: Parameterize the client with `Database` so `.from("inspections")` is fully typed downstream.

**Contract**: Import `Database` from `@/db/database.types`; change `createServerClient(...)` to `createServerClient<Database>(...)`. Return type becomes `SupabaseClient<Database> | null`. No behavioral change.

### Success Criteria:

#### Automated Verification:

- Types regenerate without error: `npm run db:types` (with local Supabase running)
- Generated file is in sync (no diff after regen): `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Type-check / sync passes: `npx astro sync && npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- In an editor, `supabase.from("inspections").select()` autocompletes `status`, `owner_id`, etc.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Vitest isolation proof + CI

### Overview

Introduce Vitest, a Supabase test helper, and the integration test that proves cross-account isolation; wire a CI job that boots Supabase and runs it.

### Changes Required:

#### 1. Vitest setup

**File**: `package.json`, `vitest.config.ts`

**Intent**: Add Vitest as the project's test framework with a Node test environment and local Supabase credentials available to tests.

**Contract**: Add `vitest` (and `@vitest/coverage` optional) to devDependencies; `"test": "vitest run"` and `"test:watch": "vitest"` scripts. `vitest.config.ts` sets `test.environment: "node"` and loads local env (e.g. via Vite's `loadEnv(mode, cwd, "")` into `process.env`) so `SUPABASE_URL`, `SUPABASE_KEY` (anon), and `SUPABASE_SERVICE_ROLE_KEY` are readable. Tests are **not** part of `npm run build`.

#### 2. Supabase test helper

**File**: `tests/helpers/supabase.ts`

**Intent**: Centralize creating an admin (service_role) client for seeding/teardown and per-user anon clients for assertions — the harness later slices reuse.

**Contract**: Exports `adminClient()` (service_role, typed `SupabaseClient<Database>`), `createConfirmedUser(email, password)` (admin `auth.admin.createUser({ email, password, email_confirm: true })`), `signInAs(email, password)` returning an authenticated anon client, and `deleteUser(id)` for teardown. Reads credentials from `process.env`.

#### 3. Isolation integration test

**File**: `tests/inspections.rls.test.ts`

**Intent**: Prove the isolation guardrail at the client boundary, covering all four commands.

**Contract**: In `beforeAll`, seed user A and user B and one inspection each (owned correctly). Assertions:

- A's client `select`ing `inspections` returns exactly A's row (not B's).
- A `select().eq("id", <B's id>)` returns empty (RLS hides it, not a 403).
- A's `update` targeting B's row affects 0 rows — **must chain `.select()`** and assert the returned array is empty. Under RLS a cross-account write is _not_ an error (PostgREST matches 0 rows and returns success), so asserting "no error" false-passes; assert on returned rows, never on error absence.
- A's `delete` targeting B's row affects 0 rows — same `.select()`-chained empty-array assertion.
- A can `insert` a row for itself; an `insert` attempting `owner_id = <B>` is rejected by the `with check` policy.
- `afterAll` deletes both users (cascade clears inspections).

#### 4. `.env.example` + docs

**File**: `.env.example`, `README.md` (test section), `CLAUDE.md`

**Intent**: Document the test-only service_role key and how to run the suite; fix the two statements this change makes false.

**Contract**: Add commented `SUPABASE_SERVICE_ROLE_KEY=###` to `.env.example` (note: test/local only, never an app secret, never in `astro.config.mjs` env schema). Brief README note: `npx supabase start` → `npm test`. Also document the **prod migration step** for later slices: `supabase link` + `supabase db push`. **Stale-doc fixes**: update `README.md:114` ("No database tables or migrations are required") and the `CLAUDE.md` auth bullet ("no app tables or migrations") — app tables now live under `supabase/migrations/`, regenerate types via `npm run db:types` after schema changes.

#### 5. CI job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the isolation test against a real Supabase instance on every PR.

**Contract**: Add a `db-test` job (parallel to `ci`): checkout → setup-node 22 → `npm ci` → `npx supabase start -x studio,imgproxy,inbucket,realtime,storage-api,edge-runtime,logflare,vector` (exclude services the test never touches — tune the list; full start pulls minutes of unused Docker images) → `npx supabase db reset` (applies the migration) → `npm test`, with `SUPABASE_URL`/`SUPABASE_KEY`/`SUPABASE_SERVICE_ROLE_KEY` sourced from `npx supabase status -o env` (local keys are deterministic). Runner has Docker, which the Supabase CLI needs. The job also runs the types-in-sync check (`npm run db:types && git diff --exit-code src/db/database.types.ts`) — required, since committed types otherwise drift silently after the next migration.

### Success Criteria:

#### Automated Verification:

- Test suite passes locally with Supabase up: `npx supabase start && npm test`
- Lint passes (test files included): `npm run lint`
- CI `db-test` job is green on the PR (includes the types-in-sync check).

#### Manual Verification:

- Review the test asserts all four commands (select/insert/update/delete) for cross-account denial, not just `select`.
- Temporarily disabling RLS (or breaking a policy) makes the test **fail** — confirming it actually guards isolation, not a false pass.

**Implementation Note**: After automated verification passes, pause for manual confirmation that the negative-control check (broken policy ⇒ red test) was observed.

---

## Testing Strategy

### Unit Tests:

- None — the unit under test is a database policy, best exercised through the client (integration).

### Integration Tests:

- `tests/inspections.rls.test.ts` — two-user cross-account matrix over select/insert/update/delete (the core deliverable).

### Manual Testing Steps:

1. `npx supabase start`, then `npx supabase db reset` — confirm migration applies.
2. In Studio, confirm RLS enabled + four policies on `inspections`.
3. `npm test` — confirm green.
4. Negative control: comment out one policy (or `alter table ... disable row level security`), rerun `npm test`, confirm it goes **red**, then revert.

## Performance Considerations

- The `(select auth.uid())` wrapping keeps policy evaluation to once-per-statement; the `owner_id` index supports owner-scoped queries the later slices will run. No measurable cost at MVP data volumes.

## Migration Notes

- Applied **locally only** in this change. When a consuming UI ships (S-02), apply to the hosted project with `supabase link` then `supabase db push`. The hosted `SUPABASE_URL`/`SUPABASE_KEY` are Worker secrets and unaffected by the migration.
- The migration is additive and forward-only; no existing data to migrate (first table).

## References

- Roadmap item F-01: `context/foundation/roadmap.md:85`
- PRD — Access Control / Data isolation: `context/foundation/prd.md:212`; guardrail `prd.md:77`; FR-006/FR-011.
- RLS-enabling client pattern: `src/lib/supabase.ts:9`
- Env schema: `astro.config.mjs:17`
- Existing CI gate: `.github/workflows/ci.yml`
- Local auth auto-confirm: `supabase/config.toml:209`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema migration + RLS pattern

#### Automated

- [x] 1.1 Migration applies cleanly from scratch: `npx supabase db reset`
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 Build passes: `npm run build`

#### Manual

- [x] 1.4 Studio shows `inspections` with RLS enabled + four named policies
- [x] 1.5 Authenticated insert respects `owner_id`; anon query returns nothing

### Phase 2: Type generation + typed client

#### Automated

- [ ] 2.1 Types regenerate without error: `npm run db:types`
- [ ] 2.2 Generated file in sync: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- [ ] 2.3 Type-check/sync passes: `npx astro sync && npm run lint`
- [ ] 2.4 Build passes: `npm run build`

#### Manual

- [ ] 2.5 `supabase.from("inspections")` autocompletes columns in-editor

### Phase 3: Vitest isolation proof + CI

#### Automated

- [ ] 3.1 Test suite passes locally with Supabase up: `npx supabase start && npm test`
- [ ] 3.2 Lint passes (test files included): `npm run lint`
- [ ] 3.3 CI `db-test` job is green on the PR (includes the types-in-sync check)

#### Manual

- [ ] 3.4 Test asserts all four commands for cross-account denial
- [ ] 3.5 Negative control: broken/disabled policy makes the test go red, then reverted
