---
change_id: domain-schema-rls-isolation
title: Domain schema + RLS isolation contract
status: planned
created: 2026-06-10
updated: 2026-06-10
archived_at: null
---

## Notes

Roadmap item **F-01** (foundation), from `context/foundation/roadmap.md`.

- **Outcome:** Supabase domain schema baseline landed with Row-Level Security enforcing per-account isolation; the first owner-private record persists and is provably invisible to other accounts.
- **PRD refs:** Access Control §Data isolation, Guardrail §Strict data isolation, NFR §isolation, FR-006, FR-011.
- **Unlocks:** S-02 (owner-private inspections), S-09 (cascade account deletion), and the strict-data-isolation guardrail verification path.
- **Prerequisites:** — (Supabase Auth + deploy already present per Baseline).
- **Scope cap:** minimal `inspections` table + the RLS policy pattern later tables follow — not a whole schema built ahead.
