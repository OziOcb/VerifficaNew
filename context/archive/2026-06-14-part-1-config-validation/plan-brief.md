# Part 1 Config Form, Validation & Parts 2–5 Unlock — Plan Brief

> Full plan: `context/changes/part-1-config-validation/plan.md`

## What & Why

Build the Part 1 vehicle-configuration form (15 fields), enforce the strict field-by-field + cross-field validation in `idea/veriffica-part-1-validation-rules.md`, and gate Parts 2–5 behind the six required fields. This is roadmap slice **S-03** (north-star Stream A) and the precondition for the S-04 personalization engine — the saved config is what drives which questions appear, so it must be correct first (FR-011/012/013, US-01).

## Starting Point

The `inspections` table is a lifecycle skeleton (no config columns); `[id].astro` is a stub ("Part 1 — coming in S-03"). The F-02 local-first stack (Dexie store, optimistic `saveInspection` + outbox, single `POST /api/inspections/sync` casing boundary) is built and ready to carry domain writes. No `zod`/`react-hook-form` and no shadcn form primitives exist yet.

## Desired End State

Opening `/inspections/:id` shows the Part 1 form: blur validation with inline English errors, explicit Save that scrolls to/focuses the first invalid field, and — when the six required fields are valid and CF-1 passes — persists normalized config via the offline outbox, auto-names the inspection `Make Model`, and flips disabled Part 2–5 placeholders to unlocked (but inert until S-04). Config survives reload.

## Key Decisions Made

| Decision         | Choice                              | Why (1 sentence)                                                                  | Source |
| ---------------- | ----------------------------------- | --------------------------------------------------------------------------------- | ------ |
| Data model       | Individual typed columns            | DB-level type/enum safety and clean reads for S-04 personalization.               | Plan   |
| Persistence path | F-02 local-first outbox             | Domain slices local-first from day one; no online→offline retrofit (quality).     | Plan   |
| Validation       | Add Zod schema                      | One source of truth for shape, normalization, messages, and the unlock predicate. | Plan   |
| Unlock scope     | Form + derived unlock state only    | Stays within the slice; session screen is S-04; no throwaway UI.                  | Plan   |
| Draft saving     | Explicit save only                  | Matches the rules doc; no half-valid persisted state (CF-3).                      | Plan   |
| Testing depth    | Unit (validation) + extend RLS test | Validation is the bug-prone core; reuses existing infra; no brittle e2e.          | Plan   |
| Form primitives  | Add shadcn input/label/select       | Matches `components.json` convention; accessible Radix enum selects.              | Plan   |

## Scope

**In scope:** Part 1 config columns + RLS coverage; Zod validation/normalization module + unit tests; local-first save path extension; shadcn form primitives; the Part 1 form on `[id].astro`; derived unlock + disabled Part 2–5 placeholders; auto-name from Make/Model.

**Out of scope:** S-04 session screen / question engine; Smart Pruning (S-07); runtime equipment flags; partial-draft autosave; new Playwright e2e.

## Architecture / Approach

Bottom-up across four phases: (1) migration adds typed columns following the F-01 template + `db:types` regen — which auto-propagates to the Dexie type and sync endpoint; (2) Zod schema encodes the rules doc once with exhaustive unit tests; (3) extend `saveInspection`/`SaveInput` to carry config (no sync-endpoint logic change for scalars) and add shadcn primitives; (4) the `client:only="react"` form island composes it all and renders the unlock state.

## Phases at a Glance

| Phase                       | What it delivers                                    | Key risk                                              |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| 1. Schema + Types           | Typed Part 1 columns, regen types, RLS coverage     | Migration must reach hosted Supabase before deploy.   |
| 2. Validation (Zod) + tests | Single validation/normalization module, unit-tested | Faithfully encoding every rule + CF-1 edge.           |
| 3. Persistence + primitives | Config flows through the outbox; shadcn inputs      | New `@radix-ui/react-select` dep; type widening.      |
| 4. Form island + unlock     | The Part 1 UI + scroll/focus UX + unlock state      | First-invalid focus + lock-derived-from-config logic. |

**Prerequisites:** S-02 implemented (done); local Supabase running for `db:types`/tests.
**Estimated effort:** ~2–3 sessions across the 4 phases.

## Open Risks & Assumptions

- The migration must be pushed to hosted Supabase before deploy (DB migrations aren't in the Workers pipeline — same as S-02).
- Assumes scalar config columns need no sync-endpoint change (the top-level casing transform already covers them) — verified in Phase 3.
- The form island assumes the local store is already user-scoped (the dashboard owns `resetLocalStoreOnUserChange`).

## Success Criteria (Summary)

- Parts 2–5 stay locked until the six required fields are saved valid; CF-1 (Electric ⇒ Automatic) blocks save with the right message.
- Saving valid config unlocks Parts 2–5, auto-names the inspection, and the normalized config survives reload.
- Validation unit tests and the extended RLS test pass under `npm test`.
