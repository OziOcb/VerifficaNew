-- Migration: fix the 2-per-owner limit trigger so it never blocks UPDATES.
--
-- The original limit migration (20260613204306) claimed "upsert-on-existing
-- never trip it" — that is WRONG. A BEFORE INSERT row trigger fires for EVERY
-- row proposed by `INSERT ... ON CONFLICT (...) DO UPDATE`, BEFORE Postgres
-- detects the conflict and routes the row to the UPDATE path. The sync endpoint
-- (src/pages/api/inspections/sync.ts) persists every edit via `.upsert()`, which
-- is exactly that statement. So once an owner held 2 inspections, saving Part 1
-- (or any later edit) of an EXISTING inspection re-counted that same row and
-- raised `inspection_limit_reached` — the update silently never landed.
--
-- Fix: exclude the row being written (`id <> new.id`) from the count.
--   * Genuine INSERT of a 3rd row: new.id is brand-new, so `id <> new.id`
--     excludes nothing real → counts the 2 existing rows → still rejected.
--   * Upsert that UPDATES an existing row: excludes itself → counts the OTHER
--     rows only → an owner at the limit can keep editing their inspections.
--
-- `create or replace` keeps the existing `inspections_enforce_limit` trigger
-- bound to the same function; only the body changes.
create or replace function public.enforce_inspection_limit() returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.inspections
      where owner_id = new.owner_id and id <> new.id) >= 2 then
    raise exception 'inspection_limit_reached';
  end if;
  return new;
end;
$$;
