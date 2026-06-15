-- Migration: add the Part 1 vehicle-configuration columns to inspections (S-03 / FR-011..FR-013).
--
-- The F-01 migration landed the lifecycle skeleton only. This slice adds the 15
-- Part 1 config fields the inspection form persists. Conventions copied from F-01:
--   - snake_case columns (the casing lesson: DB stays snake_case, app stays
--     camelCase, conversion confined to the single sync boundary).
--   - enums modeled as `text ... check (...)` with lowercase keys (mirroring the
--     `status text ... check (...)` pattern), NOT native PG enum types.
--   - no new RLS: the existing per-command owner policies already cover every
--     column on the row, so column additions need no policy changes.
--
-- ALL columns are nullable: the S-02 lifecycle-skeleton row is created before
-- Part 1 is filled, so it must stay valid with these columns empty. Required-ness
-- and full validity are enforced in app code (the Zod schema), not the DB. A
-- nullable column with a CHECK is null-permissive by default, so each enum CHECK
-- still allows NULL for the not-yet-filled row.

alter table public.inspections
  add column price numeric(10, 2),
  add column make text,
  add column model text,
  add column year integer,
  add column registration_number text,
  add column vin text,
  add column mileage integer,
  add column fuel_type text check (fuel_type in ('petrol', 'diesel', 'hybrid', 'electric')),
  add column transmission text check (transmission in ('manual', 'automatic')),
  add column drive text check (drive in ('2wd', '4wd')),
  add column color text,
  add column body_type text check (
    body_type in ('sedan', 'hatchback', 'suv', 'coupe', 'convertible', 'van', 'pickup', 'other')
  ),
  add column door_count integer,
  add column address text,
  add column notes text;
