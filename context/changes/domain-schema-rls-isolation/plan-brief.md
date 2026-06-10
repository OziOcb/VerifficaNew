# Domain Schema + RLS Isolation Contract — Plan Brief

> Full plan: `context/changes/domain-schema-rls-isolation/plan.md`

## What & Why

Land Veriffica's **first** database migration: a minimal `inspections` table protected by Row-Level Security so every row is private to its owning account. This is roadmap **F-01**, sequenced first because every later domain slice writes owner-private data — establishing the RLS isolation contract once (not per-slice) is the cheapest way to honor the PRD's absolute data-isolation guardrail.

## Starting Point

No migrations exist yet — only Supabase Auth's `auth.users`. The SSR client (`src/lib/supabase.ts`) already uses the anon key + the user's session cookies, which is exactly what makes RLS enforceable: `auth.uid()` resolves in Postgres, so a `owner_id = auth.uid()` policy is enforced by the database, not app code. No test framework is configured, but the `supabase` CLI is available.

## Desired End State

`supabase db reset` applies a migration creating `public.inspections` with RLS on and four per-command policies. Generated TypeScript types (`src/db/database.types.ts`) flow into a typed SSR client. A Vitest integration test proves — locally and in CI — that two accounts can never see or mutate each other's inspections across select/insert/update/delete.

## Key Decisions Made

| Decision           | Choice                                              | Why (1 sentence)                                                                                | Source |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ |
| Table scope        | Lifecycle skeleton (id, owner_id, status, name, ts) | True to the roadmap's "minimal table + pattern" scope; later slices add columns via migrations  | Plan   |
| Isolation proof    | Vitest integration test (introduce Vitest now)      | CI cost is identical to pgTAP, but tests the real client path and seeds the reusable harness    | Plan   |
| 2-inspection limit | Defer to S-02                                       | Needs the dashboard pop-up UX; over-scopes the foundation                                       | Plan   |
| Type generation    | Generate now + typed client                         | Every later slice gets compile-time-checked queries; establishes the regen-after-migration flow | Plan   |
| Migration target   | Local only + documented `db push`                   | Nothing in prod reads the table yet; pushing an unused table adds risk with no benefit          | Plan   |
| RLS policy shape   | Per-command + `(select auth.uid())`                 | Supabase best practice — per-statement auth caching + auditable per-command intent              | Plan   |
| `updated_at`       | DB trigger (F-01 default)                           | Always trustworthy server-side; F-02 revisits if offline LWW needs client timestamps            | Plan   |

## Scope

**In scope:** first migration (`inspections` + RLS + trigger + index); `db:types` workflow + typed client; Vitest + isolation test; CI job that boots Supabase and runs it.

**Out of scope:** Part 1 config columns (S-03), 2-inspection limit (S-02), account-deletion flow (S-09, though the cascade FK is included), any app UI/endpoint, prod migration push, offline/LWW handling (F-02).

## Architecture / Approach

Dependency order **schema → types → test**. The migration is the source of truth; types are generated from the applied schema; the Vitest test exercises the typed anon client against the live policies, seeding two confirmed users via the service_role admin API and tearing them down by cascade. The migration is written as the explicit, commented template later tables copy; the `set_updated_at()` trigger is a reusable `public` function.

## Phases at a Glance

| Phase                             | What it delivers                                               | Key risk                                                               |
| --------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. Schema migration + RLS         | `inspections` table, RLS, 4 policies, trigger, index           | Getting `using`/`with check` split + `(select auth.uid())` wrap right  |
| 2. Type generation + typed client | `db:types` script, committed types, `SupabaseClient<Database>` | Keeping generated types in sync (CI diff check mitigates)              |
| 3. Vitest isolation proof + CI    | Test harness, cross-account test, CI job booting Supabase      | First Vitest test is an integration test needing Docker/Supabase in CI |

**Prerequisites:** local Supabase running (`npx supabase start`); Docker available for CI.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- The Vitest harness assumes local Supabase deterministic keys and `enable_confirmations = false` (true in `config.toml`) so seeded users are immediately usable.
- `updated_at` via DB trigger is the _online_ answer; F-02 may need client-supplied timestamps for offline LWW — flagged as a known follow-up, not solved here.
- The migration is applied locally only; the hosted DB stays without the table until S-02 runs `supabase db push` (documented).

## Success Criteria (Summary)

- `supabase db reset` applies the migration with RLS enabled and four policies.
- `npm test` proves cross-account select/insert/update/delete are all blocked, and a deliberately broken policy turns the test red.
- CI runs the isolation test against real Supabase on every PR.
