-- Migration: add the answers map column to inspections (S-05 / FR-015, US-01).
--
-- S-05 records the buyer's Parts 2–5 answers. Rather than a separate answers
-- table or sync entity, answers live as a single jsonb map on the existing
-- inspection row — `{ <questionId>: "yes" | "no" | "dont_know" }` — so they ride
-- the proven optimistic write → outbox → /api/inspections/sync path with no new
-- entity, and S-06 (scoring) / S-07 (Smart Pruning) operate on this one structure.
--
-- Conventions copied from the S-04 session-fields migration (20260617120000):
--   - snake_case column; DB stays snake_case, app stays camelCase, conversion
--     confined to the single sync boundary.
--   - additive column only — no backfill. The `not null default '{}'::jsonb`
--     means every existing inspection reads as "no answers" with no data fix-up.
--   - no new RLS: the existing per-command owner policies cover every column on
--     the row, so a column addition needs no policy changes.
--
-- Casing note (load-bearing): the map's KEYS are opaque catalogue question IDs
-- (e.g. `q_p2_base_car_body_corrosion_bonnet`) that must survive the round-trip
-- VERBATIM to match the question catalogue. The sync boundary's deep
-- `camelcaseKeys` transform therefore EXCLUDES this column's contents via
-- `stopPaths: ["answers"]` (lessons.md "Field casing" → "exclude jsonb contents").

alter table public.inspections
  add column answers jsonb not null default '{}'::jsonb;
