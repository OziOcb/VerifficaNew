# Session Screen + Personalized Question Generation (S-04) — Plan Brief

> Full plan: `context/changes/personalized-question-engine/plan.md`
> Research: `context/changes/personalized-question-engine/research.md`

## What & Why

Make the product wedge real: instead of a generic wall of questions, the user sees a set
**personalized to this car's declared configuration** (fuel / transmission / drive / body +
equipment exceptions). This slice wires the already-authored question catalogue into `src/`,
builds the FR-014 additive visibility engine, and ships the FR-010 session screen — the hub
that drives the whole inspection.

## Starting Point

S-03 landed the Part 1 config form: 15 nullable scalar columns on `inspections` whose CHECK
enums (`fuel_type`/`transmission`/`drive`/`body_type`) already match the catalogue's
`visibleWhen` values exactly. The catalogue itself (206 questions, 54 groups with data-driven
visibility rules, 59 explanations) exists fully normalized at `idea/veriffica-questions-list/`
but is **wired into nothing** — zero references in `src/`. The route + offline-sync templates
(`[id].astro`, `saveInspection`/`startAutoSync`, the scalar sync endpoint) are proven.

## Desired End State

A user with a valid Part 1 config opens the session screen and sees the session name, free-choice
Part 1–5 navigation, a Total Score distribution, a completion indicator, and one 10,000-char
global notes document. The Part 2–5 nav shows **per-Part visible counts computed by the engine**,
and relevance-filtered equipment toggles let the user reveal flag-gated groups — watching counts
and the score denominator recompute instantly. Tapping a Part lands on a placeholder screen that
S-05 fills with answer cards.

## Key Decisions Made

| Decision                     | Choice                                              | Why (1 sentence)                                                                | Source   |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- | -------- |
| Visibility engine shape      | Pure function over the data-driven `visibleWhen`    | ~15 lines, trivially unit-testable, and the exact function S-07 re-runs         | Research |
| Catalogue location           | Copy into `src/data/questions/`, Zod-parse + freeze | Versioned with the app; drift guard fails fast if the copy diverges from schema | Plan     |
| Equipment-flag storage       | 5 nullable boolean columns on `inspections`         | Stays scalar → rides existing sync untouched, dodges the jsonb-casing caveat    | Plan     |
| Equipment-flag affordance    | Relevance-filtered toggles on the session screen    | Honors the settled config/flag separation, keeps the answer store pure for S-05 | Research |
| Session-screen render scope  | FR-010 hub only — **no** per-Part question list     | FR-010 lists no question list; question text first appears as S-05 cards        | Plan     |
| Part 2–5 nav target in S-04  | Enabled → minimal placeholder route                 | Exercises free-choice nav + proves the engine via counts; gives S-05 a route    | Plan     |
| Total Score / completion now | Compute over visible set with 0 answers (0%)        | US-01 ties both to answered ∈ visible; no rework when S-05 adds answers         | Research |

## Scope

**In scope:** catalogue module + Zod drift guard; pure visibility predicate + per-Part counts +
explanation resolver; `global_notes` + 5 flag columns (migration + types + sync wiring); the
FR-010 session hub; relevance-filtered equipment toggles; minimal placeholder Part 2–5 routes.

**Out of scope:** answer cards / mandatory answering / back-nav / per-card notes (FR-015, S-05);
education pop-up rendering (resolver wired only); answer store (S-05); Smart Pruning of stored
answers (FR-016, S-07); the Summary (FR-019, S-06); any new RLS policy or sync entity.

## Architecture / Approach

Server imports the 80 KB catalogue in the session route frontmatter, computes the visible set
with the pure engine, and passes only the **filtered** per-Part group set to a `client:only`
React island — the bank never reaches the browser. The personalized set is **derived, never
persisted** (a pure projection of static catalogue × persisted config × persisted flags), so
there is nothing to store or migrate, and S-07 is "recompute + diff" on the same function.
Rules stay in JSON; the thin evaluator lives in `src/lib/questions.ts`, mirroring `part1-config.ts`.

## Phases at a Glance

| Phase                                 | What it delivers                                               | Key risk                                                |
| ------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| 1. Catalogue module + engine (FR-014) | Validated, frozen, server-safe module + pure predicate, tested | Module must not transitively import Dexie (server-safe) |
| 2. Persistence: notes + flag columns  | `global_notes` + 5 boolean columns, types + sync wiring        | Migration must also reach hosted Supabase before ship   |
| 3. Session screen hub (FR-010)        | Route + island: nav, Total Score, completion, global notes     | Keeping the catalogue server-side (not in the island)   |
| 4. Equipment toggles + recompute      | Relevance-filtered toggles; instant count/score recompute      | Flag-relevance logic must match the catalogue's gates   |

**Prerequisites:** S-03 done (it is). Local Supabase running for the migration; workerd dev runtime for manual checks.
**Estimated effort:** ~3–4 sessions across 4 phases (engine is fast/pure; the session island is the bulk).

## Open Risks & Assumptions

- The two casing boundaries hold only for **scalar** columns — discrete boolean flags chosen
  precisely to avoid the jsonb-contents caveat in `lessons.md`.
- The questions module must stay Dexie-free or the server build breaks; the build step is the guard.
- Flag-relevance logic on the toggles duplicates a slice of the catalogue's fuel-axis knowledge;
  kept minimal and covered by the EV cross-case test.

## Success Criteria (Summary)

- A user sees a question set whose per-Part counts visibly change with their config (the wedge).
- The Total Score denominator and completion indicator track the visible set and recompute on a flag toggle.
- One editable 10,000-char global notes document persists offline and syncs, distinct from Part 1 notes.
