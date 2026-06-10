-- Migration: create the inspections table + the RLS isolation contract.
--
-- This is Veriffica's FIRST domain migration (F-01). It is intentionally the
-- template that every later domain slice (S-02…S-09) copies. Three conventions
-- are established here and must be reused, not re-invented:
--   1. The RLS policy pattern: every row is private to its owner via
--      `owner_id = (select auth.uid())`, enforced by Postgres — not app code.
--   2. The reusable `public.set_updated_at()` trigger function (later tables
--      attach the same trigger rather than redefining it).
--   3. The `on delete cascade` FK to auth.users, which lets S-09 (account
--      deletion) erase all domain data for free.
--
-- The table is a lifecycle SKELETON only: no Part 1 config columns (S-03),
-- no 2-inspection limit (S-02). Scope is the pattern, landed once and verified.

-- Reusable trigger function: stamp updated_at on every UPDATE. Written
-- generically (no table-specific logic) so later tables attach the same
-- trigger via `before update ... execute function public.set_updated_at()`.
create function public.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Owner-private inspections. Lifecycle skeleton: id, owner, status, name, timestamps.
create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Supports owner-scoped queries the RLS policies (and later slices) run.
create index inspections_owner_id_idx on public.inspections (owner_id);

-- Maintain updated_at on every UPDATE via the reusable trigger function.
create trigger inspections_set_updated_at
before update on public.inspections
for each row
execute function public.set_updated_at();

-- Enable RLS: with it on and no policy matching, access is denied by default.
alter table public.inspections enable row level security;

-- Four per-command policies, each scoped to the authenticated owner.
--
-- Perf convention: compare against `(select auth.uid())`, the subquery form —
-- NOT bare `auth.uid()`. Postgres evaluates the subselect once per statement
-- instead of once per row (Supabase's documented best practice).
--
-- using vs with check:
--   - select / delete: only `using` (which existing rows are visible).
--   - insert: only `with check` (validates the NEW row's owner_id).
--   - update: BOTH `using` (which rows can be targeted) and `with check`
--     (the row cannot be reassigned to a different owner).

create policy "Owners can select their own inspections"
on public.inspections
for select
to authenticated
using (owner_id = (select auth.uid()));

create policy "Owners can insert their own inspections"
on public.inspections
for insert
to authenticated
with check (owner_id = (select auth.uid()));

create policy "Owners can update their own inspections"
on public.inspections
for update
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy "Owners can delete their own inspections"
on public.inspections
for delete
to authenticated
using (owner_id = (select auth.uid()));
