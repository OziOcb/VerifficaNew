-- Migration: enforce the 2-inspection-per-owner limit (S-02 / FR-007).
--
-- The F-01 migration deliberately deferred this cap (see its header comment).
-- It must be SERVER-AUTHORITATIVE: the client's Dexie row count is per-device
-- and untrusted, so the limit lives in Postgres as a BEFORE INSERT trigger —
-- mirroring the reusable trigger-function + trigger pattern F-01 established
-- for `set_updated_at`.
--
-- Drafts and completed inspections BOTH count (any status), so the count is
-- unfiltered by status. The trigger fires on INSERT only: resume/edit and
-- upsert-on-existing never trip it.

-- Reject an insert when the owner already holds 2 inspections. The exception
-- message is a distinctive, stable string so the create endpoint can map it to
-- a 409 by matching on the message (not a SQLSTATE).
create function public.enforce_inspection_limit() returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.inspections where owner_id = new.owner_id) >= 2 then
    raise exception 'inspection_limit_reached';
  end if;
  return new;
end;
$$;

create trigger inspections_enforce_limit
before insert on public.inspections
for each row
execute function public.enforce_inspection_limit();
