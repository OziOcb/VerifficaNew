-- Migration: add the session-screen scalar columns to inspections (S-04 / FR-010, FR-014).
--
-- S-04 needs somewhere on the existing inspection row to persist two things the
-- session screen writes: the FR-010 global notes document, and the 5 equipment
-- flags (FR-014) that feed the additive visibility engine. Both are plain scalar
-- columns, so they ride the existing snake⇄camel sync boundary for free — exactly
-- why discrete boolean flag columns were chosen over a jsonb blob (the casing
-- lesson scopes the transform to top-level keys only).
--
-- Conventions copied from the S-03 config migration (20260615120000):
--   - snake_case columns; DB stays snake_case, app stays camelCase, conversion
--     confined to the single sync boundary.
--   - additive, nullable columns only — no backfill. Existing rows get NULL
--     (correct: notes empty, flags unset). "Unset" is meaningful and distinct
--     from an explicit `false`, so the flag columns carry no default.
--   - no new RLS: the existing per-command owner policies cover every column on
--     the row, so column additions need no policy changes.
--
-- The 10,000-char limit on global_notes is enforced app-side (mirroring how the
-- Part 1 `notes` length is Zod-enforced, not a DB CHECK).
--
-- Casing note: `imported_from_eu` camelCases to `importedFromEu`, which the
-- engine's FLAG_COLUMN_MAP (src/lib/questions.ts) binds to the catalogue's
-- canonical `importedFromEU` flag — the column does NOT match the catalogue name
-- directly, and that is intentional.

alter table public.inspections
  add column global_notes text,
  add column charging_port_equipped boolean,
  add column ev_battery_docs_available boolean,
  add column turbo_equipped boolean,
  add column mechanical_compressor_equipped boolean,
  add column imported_from_eu boolean;
