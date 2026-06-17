# Session Screen + Personalized Question Generation (S-04) Implementation Plan

## Overview

Realize the product wedge: wire the already-authored question catalogue into `src/`,
build the FR-014 **additive visibility engine** as a pure function over the data-driven
rules, and ship the FR-010 **session screen** (Part navigation, Total Score, completion
indicator, one 10,000-char global notes document). Equipment flags are set via
relevance-filtered toggles on the session screen and feed the same engine. All built on
the proven SSR → `camelcaseKeys` → `client:only` route template and the existing scalar
snake⇄camel sync path — no new sync mechanism, no new RLS policy.

This slice deliberately stops short of rendering question **cards** (FR-015 / S-05). The
session screen is a hub; the personalized set surfaces here as the engine that drives
per-Part visible **counts**, the Total Score denominator, and the completion indicator.

## Current State Analysis

- **The catalogue exists, fully normalized, and is NOT wired into `src/`.** It lives at
  `idea/veriffica-questions-list/` as `question-bank.json` (206 questions + 59
  explanations, stable `q_…`/`exp_…` IDs, `explanationRef` wiring) and
  `question-mapping-config.json` (54 groups, each with a data-driven `visibleWhen`
  predicate, `dependsOnFields`, and an optional `requiresEquipmentFlag`), each with a
  matching JSON-Schema. A full repo search returns zero hits for these in `src/`.
- **Part 1 config (S-03) is landed and its CHECK enums match the catalogue exactly.**
  `supabase/migrations/20260615120000_inspections_part1_config.sql` adds 15 discrete,
  nullable, snake_case columns; the four visibility-driving columns
  (`fuel_type`/`transmission`/`drive`/`body_type`) carry CHECK constraints whose lowercase
  values are identical to the catalogue's `visibleWhen` enum values — **no mapping layer
  needed**. (`src/lib/part1-config.ts:38-41` keeps `FUEL_TYPES`/`TRANSMISSIONS`/`DRIVES`/
  `BODY_TYPES` as module-private `as const` tuples — **not exported**; the engine reads its
  own enums from the catalogue JSON, and the CHECK-enum ↔ `visibleWhen` value match is the
  join, not a shared import. Export the tuples from `part1-config.ts` first if a shared
  source is wanted later.) `isConfigUnlocked(input)` (`part1-config.ts:227`) is the
  full-schema gate the session screen must reuse to decide whether Parts 2–5 are reachable.
- **Route + sync template is proven.** `src/pages/inspections/[id].astro:18-44` SSR-loads
  the row, runs it through `camelcaseKeys`, and hands a camelCase prop to a `client:only`
  React island. The Dexie store (`src/lib/db.ts`) is camelCase-typed off the generated DB
  types; `saveInspection`/`flushQueue`/`startAutoSync` (`src/lib/sync.ts`) provide the
  optimistic-write + outbox + auto-drain path; the sole casing boundary is the sync
  endpoint (`src/pages/api/inspections/sync.ts`), which is **scalar-only (no jsonb yet)**.
- **`PartsNav`** (`src/components/inspections/Part1Form.tsx:512-553`) is a 4-card Parts 2–5
  grid with locked/unlocked treatment but **no route target** (`:546` "no S-04 target yet").
- **Missing entirely:** a `global_notes` column (FR-010 wants a distinct 10,000-char
  inspection-level doc, separate from the 1,000-char Part 1 `notes`), equipment-flag
  storage, the questions module, the visibility predicate, and the session route.
- **Test harness:** vitest (`npm test`), with `tests/part1-config.test.ts` as the pure-unit
  template and `tests/inspections.sync.test.ts` / `inspections.rls.test.ts` for DB-touching
  tests. e2e via Playwright (`npm run test:e2e`).

## Desired End State

A user who has saved a valid Part 1 config can open the session screen and:

- see the **session name**, a **Part 1–5 navigation** (free choice of next part), the
  current **Total Score** (as a Yes/No/Don't-know distribution — empty/0% before any
  answers exist), a **completion indicator** (0 of N visible), and one **editable global
  notes document** (10,000-char limit) that persists offline and syncs;
- see Part 2–5 nav buttons whose **visible-question counts come from the engine** —
  proving the personalization is real — and tap any of them to reach a minimal placeholder
  Part screen (cards arrive in S-05);
- toggle **equipment flags** (only those the config makes relevant), and watch the visible
  counts / Total Score denominator recompute immediately.

Verified by: the engine's unit tests (feed a config + flag set, assert the visible
group/question-id set), the migration applying cleanly with regenerated types, a clean
`npm run lint` + `npm run build`, and manual walkthrough on the workerd dev runtime.

### Key Discoveries:

- Catalogue group shape: `{ id, part, order, section, subsection, dependsOnFields[],
visibleWhen{}, requiresEquipmentFlag? }` (`question-mapping-config.json:33-60`); base
  groups have `visibleWhen: {}` (vacuously visible). 6 groups carry a `requiresEquipmentFlag`
  AND-gate (`question-mapping-config.json:264-279` et al.).
- Question shape: `{ id (^q_), groupId (^g_), part, section, subsection, label, order,
explanationRef? }`; explanations are a dict `exp_NNN → { legacyNumber, text }`
  (`question-bank.schema.json:74-116`).
- The visibility predicate is ~15 lines of pure code over the data: a group is visible iff
  for every axis in `visibleWhen`, `config[axis] ∈ allowed[]`, AND (no `requiresEquipmentFlag`
  OR that flag is active). "Additive" falls out of evaluating independent per-group predicates.
- Stable IDs (`q_/g_/exp_`) are the future answer keys — S-04 must thread `questionId`,
  never positional indices, so S-05 keying and S-07 pruning are cheap.

## What We're NOT Doing

- **No answer cards (FR-015), mandatory answering, back-navigation, per-card notes, or
  education pop-up rendering** — that is S-05. S-04 exposes the `explanationRef` resolver
  but renders nothing from it.
- **No answer store / `answers` table** — S-05. The Total Score / completion compute over
  the visible set with zero answers.
- **No Smart Pruning of stored answers (FR-016 / S-07)** — but S-04 ships the single
  `selectVisibleQuestionIds(config, flags)` function S-07 will re-run and diff.
- **No per-Part read-only question-text list** on the session screen — FR-010 does not
  include it; the question text first appears as S-05 cards.
- **No re-authoring the catalogue** — it is complete. We import + validate it, not edit it.
- **No new RLS policy or sync entity** — `global_notes` and the flag columns are scalar
  columns on the existing `inspections` row and ride the existing path.

## Implementation Approach

Four phases, each independently verifiable, in dependency order: **engine first**
(pure, fully unit-tested, no UI), then **persistence** (the two new column groups so the
session screen has somewhere to write), then the **session hub** (FR-010 wired to the
engine, flags inert/off), then the **equipment toggles** (revealing flag-gated groups and
exercising the recompute path). Each phase leaves `main` buildable.

Rules-as-data is the house style: the visibility rules stay in JSON (authorable), and a
thin pure evaluator lives in `src/lib/questions.ts` — mirroring how `part1-config.ts` keeps
validation rules in Zod data behind a thin API.

## Critical Implementation Details

- **Server-side catalogue import only.** The ~80 KB bank must be imported in the `.astro`
  session route frontmatter (server), the visible set computed there, and only the
  _filtered_ set passed to the `client:only` island as props. Importing the catalogue into
  the island would ship the whole bank to the browser. The questions module itself must
  therefore stay Dexie-free / server-safe (it must not transitively import `@/lib/db`).
- **The personalized set is DERIVED, never persisted.** It is a pure function of
  `(catalogue, config, flags)`; the catalogue is static and the config + flags are already
  on the `inspections` row. There is nothing to store, migrate, or reconcile — recompute on
  read, which is the identical code path S-07 reuses.
- **Two casing boundaries, never between** (`lessons.md`). `global_notes` and the flag
  columns are scalar, so they inherit the snake⇄camel transform for free — this is exactly
  why discrete boolean flag columns were chosen over a jsonb blob.

## Phase 1: Question catalogue module + visibility engine (FR-014)

### Overview

Bring the catalogue into the app as a validated, frozen, server-safe module and expose the
pure visibility predicate + an explanation resolver. No UI, no DB. This is the FR-014 engine.

### Changes Required:

#### 1. Catalogue data files

**File**: `src/data/questions/question-bank.json`, `src/data/questions/question-mapping-config.json`

**Intent**: Copy the two authored JSON files out of the `idea/` planning area into a
versioned runtime location so the app owns them. (Schemas stay in `idea/` as the source of
truth; the runtime guard is the Zod parse below.)

**Contract**: Byte-for-byte copies of
`idea/veriffica-questions-list/question-{bank,mapping-config}.json`. Drop the `$schema`
pointer line if it breaks the Zod parse, otherwise leave untouched.

#### 2. Questions module

**File**: `src/lib/questions.ts`

**Intent**: Single source of runtime truth for the catalogue. Parse both JSON files through
a Zod schema and freeze them on first import (drift guard — a malformed catalogue throws at
load). Expose the pure visibility predicate, a per-Part grouping/ordering helper, and an
explanation resolver. Must stay server-safe (no `@/lib/db` import) so it is importable from
`.astro` frontmatter.

**Contract**: Exports —

- `selectVisibleGroups(config, flags): QuestionGroup[]` — groups whose `visibleWhen` axes
  all match `config` AND whose `requiresEquipmentFlag` (if any) is in the active flag set,
  sorted by `order`.
- `selectVisibleQuestionIds(config, flags): Set<string>` — the visible questions' `q_…` IDs;
  **the single source of truth for visibility** that S-07 will re-run and diff.
- `visibleCountsByPart(config, flags): Record<"part2"|…|"part5", number>` — per-Part visible
  question counts for the nav.
- `resolveExplanation(ref): string | null` — `explanationRef` → `explanations[ref].text`
  (for S-05; S-04 only wires it).
- `activeFlagsFromInspection(row): Set<RuntimeFlag>` — builds the active-flag set the
  predicate consumes from the camelCased inspection row, via an **explicit column↔flag
  map** (not incidental casing agreement). This is the one place that bridges DB column
  names and catalogue flag names; see the casing note below.
- `relevantFlags(config): Set<RuntimeFlag>` — which equipment flags the config makes
  relevant, **derived from the catalogue** (Phase 4 toggle filter): a flag X is relevant iff
  some group with `requiresEquipmentFlag === X` becomes visible when X is forced active. Reuses
  `isGroupVisible`, so the toggle UI carries no hand-coded fuel rules to drift.
- Types `QuestionGroup`, `Question`, `RuntimeFlag`, and a `RuntimeFlags` set/record type.
  `config` is typed as `Pick<Part1Config, "fuelType"|"transmission"|"drive"|"bodyType">`
  (nullable-tolerant — a missing axis fails its predicate, never throws).
  The 5 flag names come from `visibilityModel.runtimeFlags`; reuse them, don't redeclare.

**Casing gotcha (the reason `activeFlagsFromInspection` uses an explicit map):** the catalogue

- PRD (FR-014) canonically spell one flag `importedFromEU` (all-caps EU), but its DB column
  `imported_from_eu` camelCases to `importedFromEu` — they do **not** match. The other 4 flags
  round-trip only by luck of having no acronym. So the active-flag set must be built through an
  explicit `{ chargingPortEquipped, evBatteryDocsAvailable, turboEquipped,
mechanicalCompressorEquipped, importedFromEu→"importedFromEU" }` column→flag map, NOT by
  reading `row[flagName]`. `importedFromEU` stays the single canonical spelling in the
  catalogue/schema/PRD; only this binding layer knows about the column-side `importedFromEu`.

Predicate core (the one non-obvious contract other phases + S-07 depend on):

```ts
// group visible iff every axis it names matches config, AND its flag (if any) is active
function isGroupVisible(group, config, activeFlags): boolean {
  for (const [axis, allowed] of Object.entries(group.visibleWhen)) {
    const v = config[axis];
    if (!v || !allowed.includes(v)) return false;
  }
  if (group.requiresEquipmentFlag && !activeFlags.has(group.requiresEquipmentFlag)) return false;
  return true;
}
```

#### 3. Engine unit tests

**File**: `tests/questions.test.ts`

**Intent**: Lock the predicate behavior against representative configs. Mirror the pure-unit
style of `tests/part1-config.test.ts`.

**Contract**: Assert: base groups (`visibleWhen: {}`) always visible; an axis match
includes/excludes the right groups; empty buckets (`2wd`, `sedan`/`hatchback`/`coupe`/
`other`) yield no extra groups; a `requiresEquipmentFlag` group is hidden until its flag is
active; the EV cross-case (electric ⇒ no turbo/compressor groups even if those flags were
somehow set, because the fuel axis already excludes them). Assert the frozen catalogue
parses and the counts/IDs are stable. **Flag-binding symmetry**: assert every
`visibilityModel.runtimeFlags` name has a backing column entry in the
`activeFlagsFromInspection` map and vice-versa (this is the guard that catches the
`importedFromEU`↔`importedFromEu` mismatch and any future flag drift), and that an
inspection row with `importedFromEu: true` activates the `importedFromEU` catalogue flag.

### Success Criteria:

#### Automated Verification:

- [ ] Unit tests pass: `npm test`
- [ ] Type checking + lint pass: `npm run lint` (runs `astro sync` first per CI)
- [ ] Production build passes (proves the module is server-safe / no Dexie leak): `npm run build`
- [ ] A deliberately malformed catalogue copy makes the Zod parse throw at module load (asserted in the test)

#### Manual Verification:

- [ ] Spot-check `selectVisibleGroups` for a known config (e.g. petrol/manual/2wd/sedan) returns the expected group IDs against the markdown source of truth
- [ ] Visible counts for an EV vs a petrol car differ in the expected direction

**Implementation Note**: After Phase 1 and all automated verification passes, pause for
human confirmation of the manual checks before Phase 2.

---

## Phase 2: Persistence — `global_notes` + equipment-flag columns

### Overview

Add the two new column groups the session screen writes to: the FR-010 global notes
document and the 5 equipment-flag booleans. Both scalar, both ride the existing sync path.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_inspections_session_fields.sql`

**Intent**: Add a `global_notes` text column and 5 nullable boolean equipment-flag columns
to `inspections`. Follow the S-03 config migration as the template (nullable, snake_case,
additive). No RLS change — the existing owner-scoped policies cover new columns.

**Contract**: Adds `global_notes text` and `charging_port_equipped`,
`ev_battery_docs_available`, `turbo_equipped`, `mechanical_compressor_equipped`,
`imported_from_eu` as `boolean` (nullable, no default — "unset" is meaningful vs explicit
false). Note `imported_from_eu` camelCases to `importedFromEu`, which the
`activeFlagsFromInspection` map (Phase 1 §2) binds to the catalogue's `importedFromEU` flag —
do not expect the column to match the catalogue name directly. The 10,000-char limit on
`global_notes` is enforced app-side (mirroring how Part 1
`notes` length is Zod-enforced, not a DB CHECK).

#### 2. Regenerated DB types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate so the Dexie `Inspection` type (`db.ts:14-15`) auto-tracks the new
camelCase fields with no hand-written interface.

**Contract**: `npm run db:types` output, committed. New keys appear as
`globalNotes`, `chargingPortEquipped`, … on the camelCased type.

#### 3. Extend the offline write path

**File**: `src/lib/sync.ts`

**Intent**: Let `saveInspection` carry the new fields so the session screen can persist
global notes and flag toggles through the existing outbox — **without clobbering** the
Part 1 config the session screen does not re-send.

**Contract**: Today `saveInspection` rebuilds a full row, defaulting every omitted
`CONFIG_FIELD` to `null`, then upserts the whole row (`sync.ts:78`) — so a sparse
`saveInspection({ id, globalNotes })` from the session screen would null `fuelType`/
`transmission`/`make`/… and destroy the config the engine reads (No-data-loss guardrail
violation). **Change `saveInspection` to read-merge**: inside the existing `rw`
transaction, read the current Dexie row (if any) and overlay only the caller-supplied
keys, so omitted fields keep their stored value instead of becoming `null`. First-write
(no existing row) keeps today's null-default behavior. The merged row is the outbox
payload, so the upsert still carries a complete row. Extend the recognized field set with
the 5 flag keys + `globalNotes`. Part1Form's full-config call is unaffected (a no-op under
merge). The sync endpoint needs **no change** — its top-level snake⇄camel transform
already handles any scalar column. Add a unit test asserting a notes-only save preserves a
pre-existing config.

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly against the local DB (`npx supabase db reset` or `migration up`)
- [ ] `src/db/database.types.ts` regenerated and includes the new columns
- [ ] Existing sync/RLS tests still pass: `npm test`
- [ ] A notes-only `saveInspection` preserves a pre-existing config (read-merge), asserted in a test
- [ ] Lint + build pass: `npm run lint && npm run build`

#### Manual Verification:

- [ ] A `saveInspection({ id, globalNotes, turboEquipped: true })` round-trips through `/api/inspections/sync` and the row reflects both fields (workerd dev runtime)
- [ ] RLS still isolates the new columns (a second account cannot read them)

**Implementation Note**: Pause for human confirmation of the manual sync/RLS checks before Phase 3.

---

## Phase 3: Session screen hub (FR-010)

### Overview

The user-visible heart of the slice: a new session route that loads config + catalogue
server-side, computes the visible set, and renders the FR-010 hub. Flags are off in this
phase (flag-gated groups simply hidden); toggles arrive in Phase 4.

### Changes Required:

#### 1. Session route

**File**: `src/pages/inspections/[id]/session.astro`

**Intent**: SSR-load the inspection under RLS (redirect to `/dashboard` if absent, per the
`[id].astro` template), `camelcaseKeys` it, import the catalogue **server-side**, compute
the visible set + per-Part counts, and pass the _filtered_ set + config + flags to a
`client:only` island. Gate access behind `isConfigUnlocked` — an inspection without a valid
config redirects back to the Part 1 form.

**Contract**: New route under the already-protected `/inspections` tree
(`middleware.ts:4`). Selects the config columns + `global_notes` + the 5 flag columns +
`name`/`status`. Passes to the island: `{ inspection, visibleGroupsByPart, visibleCounts,
totalVisible }`. The 80 KB bank never reaches the client.

#### 2. Session island

**File**: `src/components/inspections/SessionScreen.tsx` (+ extracted subcomponents as needed)

**Intent**: Render the FR-010 hub: session name; Part 1–5 navigation (free choice — Part 1
links back to the config form, Parts 2–5 to their routes with per-Part visible counts);
Total Score as a Yes/No/Don't-know distribution (empty/0% with no answers); a completion
indicator (0 of `totalVisible`); and the 10,000-char global notes textarea. Mount
`startAutoSync` on mount; persist notes via `saveInspection({ id, globalNotes })` (debounced) —
a safe sparse update now that `saveInspection` read-merges (Phase 2 §3), so it never
clobbers the config.

**Contract**: `client:only="react"` island (touches Dexie via `saveInspection`). Notes
input enforces the 10,000-char limit client-side with the same family of inline error copy
as Part 1. Total Score + completion read `totalVisible` as the denominator so they never
drift from what the nav shows. Uses `useLiveQuery` to reflect the locally-saved row.
**0-answer render (US-01, `prd.md:95` — score/completion reflect only answered questions):**
with no answer store yet, answered = 0, so completion renders `0 of {totalVisible}` and the
Total Score renders an empty Yes/No/Don't-know distribution (all three counts 0, denominator
`totalVisible`) — not a blank or a single "0%". S-05 fills the numerators; the layout stays.

#### 3. Placeholder Part 2–5 routes

**File**: `src/pages/inspections/[id]/parts/[part].astro` (or 4 explicit routes)

**Intent**: Give the nav real, non-broken targets before S-05 builds cards. Each renders a
Part header, the visible-question count for that Part, and a "question cards arrive next"
stub with a Back-to-session link.

**Contract**: Validates `part ∈ {2,3,4,5}` (redirect/404 otherwise), reuses the same
SSR-load + visibility computation, renders a static placeholder. S-05 replaces the body
with cards; the route + data contract stay.

#### 4. Entry point from Part 1

**File**: `src/components/inspections/Part1Form.tsx`

**Intent**: Wire `PartsNav` (`:512-553`) so the unlocked Part cards / a primary "Open
session" action route to `/inspections/[id]/session` instead of being inert.

**Contract**: Replace the inert buttons' no-op with navigation to the session route, gated
on `isConfigUnlocked(values)` (already computed at `:206`). No change to the locked-state
treatment.

### Success Criteria:

#### Automated Verification:

- [ ] Lint + build pass: `npm run lint && npm run build`
- [ ] Type check confirms the island receives the filtered set (no catalogue import in the island module)
- [ ] An e2e/route test (or existing suite) confirms `/inspections/[id]/session` redirects when config is invalid/absent

#### Manual Verification:

- [ ] Saving a valid Part 1 config and opening the session screen shows name, Part nav, Total Score (0%), completion (0 of N), and an editable notes box
- [ ] Per-Part counts differ between a petrol and an EV config (personalization visible)
- [ ] Editing global notes persists across reload and is distinct from Part 1 notes
- [ ] Tapping a Part 2–5 button lands on the placeholder Part screen; Back returns to the session
- [ ] Notes > 10,000 chars shows the inline limit error

**Implementation Note**: Pause for human confirmation of the manual checks before Phase 4.

---

## Phase 4: Equipment-flag toggles + recompute

### Overview

Add the relevance-filtered equipment toggles to the session screen and close the loop:
toggling a flag persists it and immediately recomputes the visible set, per-Part counts,
and Total Score denominator — the exact recompute path S-07 reuses.

### Changes Required:

#### 1. Relevance-filtered toggle group

**File**: `src/components/inspections/SessionScreen.tsx` (+ a small `EquipmentToggles.tsx`)

**Intent**: Render only the flags the current config makes relevant (e.g. hide
turbo/compressor for an EV, hide charging-port/EV-docs for a combustion car; `importedFromEU`
always shown). Each toggle persists via `saveInspection` and updates the active-flag set the
predicate consumes.

**Contract**: Flag relevance is **derived from the catalogue, not hand-coded.** Add a pure
engine helper `relevantFlags(config): Set<RuntimeFlag>` (Phase 1 §2) — a flag X is relevant
iff some group with `requiresEquipmentFlag === X` becomes visible when X is forced active
(its `visibleWhen` axes still evaluated against `config`). This reuses the existing
`isGroupVisible` logic, so there is **no second copy of the fuel-axis rules to drift** (the
duplication the plan's Open Risks flagged). An EV never sees a turbo toggle because the
turbo-gated groups' fuel axis already excludes electric — the same fact the visibility engine
already encodes. Toggling writes the boolean column (Phase 2) and recomputes visibility
**client-side** from the catalogue's group rules for the already-rendered set — counts +
denominator update without a server round-trip. (Because the island received the full per-Part
group set filtered only by config, flag re-filtering is a local set operation; alternatively
re-fetch — pick the local recompute to keep it instant.)

#### 2. Recompute wiring

**File**: `src/lib/questions.ts` (consume existing exports) / `SessionScreen.tsx`

**Intent**: Ensure the visible counts, Total Score denominator, and completion indicator all
read from `selectVisibleQuestionIds(config, activeFlags)` so a flag toggle moves every
dependent number at once.

**Contract**: No new engine API — `activeFlags` becomes reactive state in the island;
counts/denominator are `useMemo` over `(config, activeFlags)`. This is the same function
signature S-07 will call on a config change.

### Success Criteria:

#### Automated Verification:

- [ ] Unit test: toggling each flag in/out of the active set changes `selectVisibleQuestionIds` by exactly the flag-gated group's questions
- [ ] Lint + build pass: `npm run lint && npm run build`
- [ ] Full suite passes: `npm test`

#### Manual Verification:

- [ ] For a hybrid config, the charging-port / EV-docs / turbo / compressor toggles appear; for a petrol config only turbo / compressor / imported show; for an EV no turbo/compressor
- [ ] Enabling `turboEquipped` increases the Part 4 count and the Total Score denominator immediately, with no reload
- [ ] A toggled flag persists across reload (round-tripped to the DB) and re-hydrates the same visible set

**Implementation Note**: After Phase 4, pause for final human confirmation that the full
personalize → navigate → recompute loop works on the workerd dev runtime.

---

## Testing Strategy

### Unit Tests:

- `tests/questions.test.ts` — the visibility predicate across representative configs
  (base-only, each axis, empty buckets, each flag gate, EV cross-case), the frozen-catalogue
  parse, and the drift-guard throw on malformed data.
- Flag-toggle delta: `selectVisibleQuestionIds` changes by exactly the gated group on flag
  flip.

### Integration Tests:

- Reuse the existing `tests/inspections.sync.test.ts` / `inspections.rls.test.ts` patterns to
  confirm `global_notes` + flag columns round-trip and stay owner-isolated.
- Route guard: `/inspections/[id]/session` redirects when config is invalid/absent.

### Manual Testing Steps:

1. Save a valid petrol/manual/2wd/sedan config → open session → note the per-Part counts.
2. Edit config to electric/automatic → reopen session → counts shift (EV groups in, combustion groups out).
3. Toggle `turboEquipped` on a petrol car → Part 4 count + Total Score denominator rise instantly.
4. Type 10,001 chars in global notes → inline limit error; valid notes persist across reload.
5. Navigate Part 1 → session → Part 2 placeholder → back to session (free-choice nav works).
6. Confirm Part 1 `notes` and `global_notes` are independent documents.

## Performance Considerations

The 80 KB bank is parsed/frozen once at module load (server) and never shipped to the
client; only the filtered per-Part group set crosses to the island. Visibility recompute on
a flag toggle is an in-memory set operation over ≤54 groups — instant, no server round-trip.

## Migration Notes

Additive, nullable columns only — no backfill, no data migration. Existing rows get `null`
for the new columns (correct: notes empty, flags unset). After applying, run
`npm run db:types` and commit `src/db/database.types.ts`. As with prior slices, the migration
must also be pushed to hosted Supabase before this ships (`npx supabase db push`) — DB
migrations are not in the Cloudflare deploy pipeline (see S-02 deploy note).

## References

- Research: `context/changes/personalized-question-engine/research.md`
- Roadmap slice S-04: `context/foundation/roadmap.md:153-164`
- PRD FR-010 / FR-014: `context/foundation/prd.md:139,147`
- Route + casing template: `src/pages/inspections/[id].astro:18-44`
- Rules-as-data precedent: `src/lib/part1-config.ts:37-41,226-229`
- Offline write path: `src/lib/sync.ts:73-100,182-215`; sync boundary `src/pages/api/inspections/sync.ts:44-59`
- Catalogue: `idea/veriffica-questions-list/question-{bank,mapping-config}.json` (+ schemas)
- Casing rule: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Question catalogue module + visibility engine

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — 18ba8dd
- [x] 1.2 Type checking + lint pass: `npm run lint` — 18ba8dd
- [x] 1.3 Production build passes (module is server-safe): `npm run build` — 18ba8dd
- [x] 1.4 Malformed catalogue makes the Zod parse throw at module load (asserted) — 18ba8dd

#### Manual

- [x] 1.5 Spot-check `selectVisibleGroups` for a known config against the markdown source — 18ba8dd
- [x] 1.6 EV vs petrol visible counts differ in the expected direction — 18ba8dd

### Phase 2: Persistence — global_notes + equipment-flag columns

#### Automated

- [x] 2.1 Migration applies cleanly against the local DB
- [x] 2.2 `src/db/database.types.ts` regenerated, includes the new columns
- [x] 2.3 Existing sync/RLS tests still pass: `npm test`
- [x] 2.4 A notes-only `saveInspection` preserves a pre-existing config (read-merge), asserted in a test
- [x] 2.5 Lint + build pass: `npm run lint && npm run build`

#### Manual

- [x] 2.6 `saveInspection` round-trips `globalNotes` + a flag through `/api/inspections/sync`
- [x] 2.7 RLS still isolates the new columns from a second account

### Phase 3: Session screen hub (FR-010)

#### Automated

- [ ] 3.1 Lint + build pass: `npm run lint && npm run build`
- [ ] 3.2 Island receives the filtered set (no catalogue import in the island module)
- [ ] 3.3 `/inspections/[id]/session` redirects when config is invalid/absent

#### Manual

- [ ] 3.4 Session screen shows name, Part nav, Total Score (0%), completion, editable notes
- [ ] 3.5 Per-Part counts differ between petrol and EV configs (personalization visible)
- [ ] 3.6 Global notes persist across reload and are distinct from Part 1 notes
- [ ] 3.7 Tapping a Part 2–5 button lands on the placeholder; Back returns to session
- [ ] 3.8 Notes > 10,000 chars shows the inline limit error

### Phase 4: Equipment-flag toggles + recompute

#### Automated

- [ ] 4.1 Unit test: each flag toggle changes `selectVisibleQuestionIds` by exactly its gated group
- [ ] 4.2 Lint + build pass: `npm run lint && npm run build`
- [ ] 4.3 Full suite passes: `npm test`

#### Manual

- [ ] 4.4 Relevant toggles shown per config (hybrid vs petrol vs EV)
- [ ] 4.5 Enabling `turboEquipped` raises the Part 4 count + Total Score denominator instantly
- [ ] 4.6 A toggled flag persists across reload and re-hydrates the same visible set
