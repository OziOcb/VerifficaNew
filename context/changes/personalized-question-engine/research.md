---
date: 2026-06-15T20:30:00-07:00
researcher: OziOcb
git_commit: f073873393dfb08067a1ac99d22a2cceadd1ed80
branch: feat/personalized-question-engine
repository: veriffica-z-ai-2
topic: "S-04 — Session screen + personalized question generation (FR-014 additive visibility)"
tags:
  [
    research,
    codebase,
    personalized-question-engine,
    question-catalogue,
    visibility-model,
    session-screen,
    offline-first,
  ]
status: complete
last_updated: 2026-06-15
last_updated_by: OziOcb
---

# Research: S-04 — Session screen + personalized question generation

**Date**: 2026-06-15T20:30:00-07:00
**Researcher**: OziOcb
**Git Commit**: f073873393dfb08067a1ac99d22a2cceadd1ed80
**Branch**: feat/personalized-question-engine
**Repository**: veriffica-z-ai-2

## Research Question

Ground the S-04 plan in what already exists and resolve the open design questions for
the FR-014 _additive visibility_ model (show only the questions that apply to **this**
car's saved Part 1 config). Five areas: (1) does a question catalogue exist and in what
shape; (2) the personalization/visibility model and how Part 1 config is persisted/read;
(3) the equipment-flag input affordance; (4) session-screen scaffolding and offline-store
composition; (5) forward-compat with S-05 (cards) and S-07 (smart pruning). Deliver
recommendations on (a) catalogue location/shape, (b) the visibility predicate design, and
(c) the flag affordance.

## Summary

**The biggest finding: the question catalogue already exists, fully normalized, with a
data-driven visibility model — and it is NOT yet wired into `src/`.** It lives at
`idea/veriffica-questions-list/` as two JSON files plus matching JSON-Schemas:

- **`question-bank.json`** — **206 questions** + **59 explanations**, each with stable IDs
  (`q_…`, `g_…`, `exp_…`), `part`/`section`/`subsection`/`label`/`order`, and `explanationRef`.
- **`question-mapping-config.json`** — **54 question groups**, each with a data-driven
  `visibleWhen` predicate (per-axis allow-lists), an optional `requiresEquipmentFlag`, a
  `dependsOnFields` array (built for S-07 pruning), and a global `order`.

So **authoring the catalogue is NOT in S-04 scope** — it is done. S-04's job is to (1)
**import/validate the catalogue into `src/`**, (2) **build the visibility predicate** that
filters groups against the saved Part 1 config + runtime flags, and (3) **build the session
screen** (FR-010: Part nav, Total Score, completion indicator, global notes).

The three requested decisions, recommended up front:

- **(a) Catalogue location/shape** → Copy the two JSON files into `src/data/questions/`,
  parse+freeze them through a Zod schema in a new `src/lib/questions.ts` module (mirroring
  the `src/lib/part1-config.ts` single-source-of-truth pattern). Import **server-side only**
  (in the `.astro` session route), pass the already-filtered set to the island as props —
  this keeps the 80 KB bank out of the client bundle and off the workerd concern list.
- **(b) Visibility predicate** → A **pure function** `selectVisibleGroups(config, flags)` over
  the **data-driven** `visibleWhen` rules. The rules are data; the evaluator is ~15 lines of
  pure code. This is the cleanest split and is exactly what S-07 will re-run.
- **(c) Flag affordance** → A **per-Part checklist of equipment toggles** (an "Equipment"
  affordance shown when the config makes a flag _relevant_), **not** inline gating questions.
  Recommended; rationale and the runner-up are in the dedicated section.

Critical data-model decisions to lock in S-04 so S-05/S-07 are cheap: **the catalogue's
stable `q_…`/`g_…`/`exp_…` IDs are the answer keys** (answers keyed `[inspectionId, questionId]`),
and **`dependsOnFields` + the flag set are the pruning triggers** for S-07. Both already exist
in the data.

## Detailed Findings

### 1. Question catalogue — exists, normalized, stable-IDed, UNWIRED

Source-of-truth markdown: `idea/veriffica-questions-list/list-of-questions.md` (530 lines) —
the human-readable inspection script with the "Normalized visibility model" section
(`list-of-questions.md:37-54`) the PRD FR-014 cites.

Two machine-readable artifacts derived from it, each with a JSON-Schema:

**`question-bank.json`** (2217 lines, ~80 KB) — `question-bank.schema.json`:

- `version`, `sourceFile`, `allowedAnswers: ["yes","no","dont_know"]`, `questions[]`, `explanations{}`.
- Each **question** (`questionItem`): `id` (`^q_.+$`), `groupId` (`^g_.+$`), `part`
  (`part2|part3|part4|part5`), `section`, `subsection` (nullable), `label`, `order`
  (multiple-of-10), optional `explanationRef` (`^exp_.+$`). — `question-bank.schema.json:74-116`
- **explanations** is a dictionary keyed `exp_NNN` → `{ legacyNumber, text }`
  (`question-bank.json` tail; `exp_001`…`exp_059`). The `explanationRef` on questions already
  wires FR-017's education pop-ups (S-05). Example: `"explanationRef": "exp_006"`.

**`question-mapping-config.json`** (747 lines, ~20 KB) — `question-mapping-config.schema.json`:

- `visibilityModel` (`question-mapping-config.json:5-30`): `type: "additive-buckets"`,
  `formula: [base, fuelType, transmission, drive, bodyType]`, `emptyBuckets`
  (`drive:[2wd]`, `bodyType:[sedan,hatchback,coupe,other]`), and the 5 `runtimeFlags`.
- `questionGroups[]` — **54 groups**, each: `id`, `part`, `order` (global 10…540),
  `section`, `subsection`, `dependsOnFields` (subset of `fuelType|transmission|drive|bodyType`),
  `visibleWhen` (the predicate), optional `requiresEquipmentFlag`. — schema at
  `question-mapping-config.schema.json:171-216`.

**Counts:** 206 questions, 54 groups, 59 explanations.

**Wiring status — definitive: NOT imported anywhere in `src/`.** A full repo search for
`question-bank`, `question-mapping`, `questionGroups`, `visibleWhen`, `groupId` returns zero
hits in `src/`, `astro.config.mjs`, `package.json`. Only `idea/` references in code are
`StartupInstructions.tsx` → `idea/veriffica-instruction.md` and `part1-config.ts` → the
validation-rules markdown (both in comments). The catalogue is a pure planning artifact today.

**What metadata each question carries (for the downstream slices):**

- _Visibility_ (group-level): `visibleWhen` + `requiresEquipmentFlag` + `dependsOnFields`.
- _Part assignment_: `part` on both group and question.
- _Ordering_: group `order` (global, 10-step) and question `order` (within group, 10-step).
- _Education copy_ (S-05/FR-017): `explanationRef` → `explanations[ref].text`.
- _Grouping/headers_ (S-05 card headers, FR-018 note headers): `section`/`subsection`/`label`.

### 2. Personalization / visibility model (FR-014)

**How Part 1 config is persisted and read (S-03, landed).**

- **Schema** — `supabase/migrations/20260615120000_inspections_part1_config.sql:1-35`: 15
  **discrete, nullable snake_case columns** added to `inspections` (NOT a jsonb blob). The four
  visibility-driving fields carry DB CHECK constraints with the exact lowercase keys:
  - `fuel_type check (… in ('petrol','diesel','hybrid','electric'))`
  - `transmission check (… in ('manual','automatic'))`
  - `drive check (… in ('2wd','4wd'))`
  - `body_type check (… in ('sedan','hatchback','suv','coupe','convertible','van','pickup','other'))`
    These **exactly match** the catalogue's `visibleWhen` enum values — no mapping layer needed.
- **Canonical enum constants in code** — `src/lib/part1-config.ts:37-41`: `FUEL_TYPES`,
  `TRANSMISSIONS`, `DRIVES`, `BODY_TYPES` as `as const` tuples. **These are the join key** to the
  catalogue. Reuse them; do not redeclare.
- **Typed read path** — two casing boundaries, both already built (per the
  `context/foundation/lessons.md` casing rule):
  1. **SSR read** at `src/pages/inspections/[id].astro:18-35`: `supabase.from("inspections")
.select("…fuel_type,transmission,drive,body_type,…").eq("id", id).maybeSingle()`, then
     `const inspection = camelcaseKeys(row, { deep: true })` → passed to the island as a
     camelCase prop. Redirects to `/dashboard` when the row is missing (RLS-safe).
  2. **Dexie/offline** type at `src/lib/db.ts:14-15`:
     `type Inspection = CamelCasedPropertiesDeep<InspectionRow> & { synced: 0 | 1 }`.
- **Validated config type** — `src/lib/part1-config.ts`: `Part1Config = z.infer<typeof
part1ConfigSchema>` (camelCase, narrowed enums). `validatePart1()`, `isConfigUnlocked()`
  exported (`part1-config.ts:207-229`).
- **Unlock gate (FR-013)** — **no DB column**; derived. `isConfigUnlocked(input)` returns
  `part1ConfigSchema.safeParse(input).success` (`part1-config.ts:226-229`), i.e. full schema
  incl. cross-field rule CF-1 (`electric` ⇒ `automatic`, `part1-config.ts:163-166`). The
  session screen must apply the **same** predicate to decide whether Parts 2–5 are reachable.

**Cleanest way to express the additive predicate — pure function over data-driven rules.**

The rules are already data (`visibleWhen`). The evaluator is a small pure function:

```ts
// group visible iff, for every axis present in visibleWhen, config[axis] ∈ allowed[],
// AND (no requiresEquipmentFlag OR that flag is active)
function isGroupVisible(group, config, activeFlags): boolean {
  for (const [axis, allowed] of Object.entries(group.visibleWhen)) {
    if (!config[axis] || !allowed.includes(config[axis])) return false;
  }
  if (group.requiresEquipmentFlag && !activeFlags.has(group.requiresEquipmentFlag)) return false;
  return true;
}
```

- **Base groups** have `visibleWhen: {}` → always pass the loop (vacuously true) → always visible.
  This is literally the "additive Base + …" model: empty predicate = the Base bucket.
- **Additive buckets**: each non-base axis contributes its matching groups; the union is the
  set. Because each group names only the axes it cares about, "additive" falls out of
  evaluating independent predicates — no explicit bucket-union code needed.
- **Empty buckets** (`2wd`, `sedan`, `hatchback`, `coupe`, `other`) simply have no groups that
  list them — the data already encodes this; the function needs no special case.
- **Recommendation: pure function over the data, not hand-coded per-config branches.** It is
  trivially unit-testable (feed a config, assert the visible group-id set), it is the _same_
  function S-07 re-runs on config change, and it keeps domain knowledge in the JSON (authorable)
  rather than in `if` ladders (not). This matches the `part1-config.ts` "rules as Zod data +
  thin API" precedent.

**Config-vs-flag layer separation — confirmed settled (FR-014), and where flags slot in.**

- The PRD (`prd.md:147`, `prd.md:259-264`) and roadmap (`roadmap.md:161-163, 256-260`) both
  state the layer separation is settled; only the _affordance_ is open.
- In the data: flags are a **separate AND-gate**, never a Part 1 field. `requiresEquipmentFlag`
  appears on exactly 6 groups and combines with `visibleWhen`:
  - `g_p2_fuel_hybrid_electric_charging_port_accessories` → `fuelType ∈ {hybrid,electric}` **AND**
    `chargingPortEquipped` (`question-mapping-config.json:264-279`).
  - `g_p2_fuel_combustion_mechanical_compressor` / `g_p4_…_mechanical_compressor` →
    `fuelType ∈ {petrol,diesel,hybrid}` **AND** `mechanicalCompressorEquipped`.
  - `g_p4_fuel_combustion_turbocharger` → combustion fuels **AND** `turboEquipped`.
  - `g_p5_fuel_hybrid_electric_battery_documents` → `{hybrid,electric}` **AND** `evBatteryDocsAvailable`.
  - `g_p5_runtime_imported_eu_*` (2 groups) → `visibleWhen: {}` (config-agnostic) **AND**
    `importedFromEU` (`question-mapping-config.json:726-745`).
- So a flag never _replaces_ config — it only further restricts a config-eligible group. Runtime
  flags live as a **separate piece of session state** (not Part 1 columns), fed into the same
  pure predicate. Where to persist that state is a real S-04 decision (see §4).

### 3. The one open unknown — equipment-flag input affordance

Only **5 flags**, each relevant to a narrow config slice:

| Flag                           | Relevant when                   | Gates groups   |
| ------------------------------ | ------------------------------- | -------------- |
| `chargingPortEquipped`         | fuel ∈ {hybrid, electric}       | 1 (Part 2)     |
| `evBatteryDocsAvailable`       | fuel ∈ {hybrid, electric}       | 1 (Part 5)     |
| `turboEquipped`                | fuel ∈ {petrol, diesel, hybrid} | 1 (Part 4)     |
| `mechanicalCompressorEquipped` | fuel ∈ {petrol, diesel, hybrid} | 2 (Parts 2, 4) |
| `importedFromEU`               | always (config-agnostic)        | 2 (Part 5)     |

**Options surveyed:**

- **(A) Inline gating question** — when the user reaches a flagged group, ask a Yes/No gate
  card first ("Does this car have a turbocharger?"). Fits the S-05 swipe-card model and asks
  only when relevant. _But_ it conflates an _equipment fact_ with an _inspection answer_ — the
  gate isn't a Yes/No/Don't-know inspection finding and wouldn't aggregate into the distribution;
  it muddies the answer store and the Total Score, and it makes S-07 pruning subtler (a gate
  answer would itself be an "answer" that changes visibility). It also can't be set ahead of the
  physical walk-through.
- **(B) Equipment checklist/toggles** — a small set of toggles surfaced on the session screen
  (or a one-time "Equipment" step), shown **only for flags the config makes relevant** (e.g.
  hide turbo/compressor toggles for an EV). Keeps flags cleanly in the separate layer the PRD
  mandates, sets them up-front so the personalized set is stable before answering begins, and
  makes S-07 trivial (a flag toggle is just another visibility-affecting input, same recompute
  path as a config change — and FR-016 already lists "an active runtime flag" as a pruning
  trigger).

**Recommendation: (B) — a relevance-filtered equipment toggle group on the session screen.**
It honors the settled config/flag separation, keeps the answer store pure (flags ≠ answers),
and reuses the exact Smart-Pruning trigger path S-07 needs. Persist active flags alongside the
inspection (see §4 for where). The runner-up (A) is viable only if we accept storing
equipment facts as pseudo-answers — which complicates S-05/S-06/S-07 — so it is not recommended.

> Affordance is explicitly non-blocking per the roadmap; this is a recommendation for
> `/10x-plan`, not a hard constraint.

### 4. Session screen scaffolding — mostly build-new on a proven template

**Routes today** — only `src/pages/inspections/[id].astro` exists (the Part 1 form host).
`PROTECTED_ROUTES = ["/dashboard", "/inspections"]` (`src/middleware.ts:4`) already gates the
whole tree; RLS is the real authorization (the SSR select silently filters non-owned rows).

**What exists and is reusable:**

- **SSR-load → camelCase → `client:only="react"` island** pattern (`[id].astro:18-44`) — the
  exact template for the session route. Islands touching Dexie _must_ be `client:only` (no
  IndexedDB on workerd — `src/lib/db.ts:1-4`).
- **`PartsNav`** placeholder (`Part1Form.tsx:512-553`) — a 4-card Parts 2–5 grid with
  locked/unlocked treatment driven by `isConfigUnlocked(values)` (`Part1Form.tsx:206`), lock
  icon, `opacity-50`, disabled buttons. **No routing target yet** (`:546` "no S-04 target yet").
  This is the seed of the session nav.
- **Offline write path** (`src/lib/sync.ts`): `saveInspection()` (atomic Dexie write + outbox
  enqueue, `:73-100`), `flushQueue()` (`:115-158`), `startAutoSync()` (`:182-215`). The sync
  endpoint `src/pages/api/inspections/sync.ts` does the camel↔snake boundary and stamps
  `owner_id` from the session. **Global notes can ride this unchanged** — it is just another
  `inspections` column update via `saveInspection({ id, globalNotes })`.
- **shadcn/ui present** (`src/components/ui/`): Button, Card, Input, Label, Select, Dialog,
  AlertDialog. **Missing and likely needed:** Tabs (or keep the card-grid nav), Progress (for
  completion indicator), a Textarea wrapper (Part 1 uses a raw `<textarea>`).

**What must be built for S-04:**

- A **session screen** route + component (FR-010): session name, Part 1–5 navigation (free
  choice), Total Score, completion indicator, one global notes document.
- **`global_notes`** storage — _does not exist_. FR-010 wants a distinct inspection-level notes
  doc (10,000-char), separate from the Part 1 `notes` field (vehicle-specific). Needs a new
  `global_notes` column (migration + `npm run db:types` + the camelCase type auto-tracks) and a
  Textarea synced via the existing outbox.
- The **questions module** (`src/lib/questions.ts`) + the **visibility predicate** (§2).
- Equipment-flag affordance + **where flags persist** (see below).

**Composition with the offline store — derive client-side, persist only the inputs.**

- **The personalized question set is DERIVED, never persisted.** It is a pure function of
  `(catalogue, config, flags)`. The catalogue is static; the config is already on the
  `inspections` row (and in Dexie). So the visible set is recomputed on read — there is nothing
  to store and nothing to migrate, and S-07 "recompute on change" is the same code path.
- **What must persist is the flag state** (and later the answers). Two viable homes for flags:
  1. **Columns on `inspections`** (one boolean per flag, or a small `equipment_flags` jsonb) —
     simplest; rides the existing single-record sync untouched. _If jsonb:_ remember the casing
     rule excludes jsonb contents from key-transform (`lessons.md:24-44`) — but these keys are
     already camelCase flag names, so prefer **discrete boolean columns** to stay scalar and
     dodge the jsonb-casing caveat entirely (the sync endpoint comment notes "scalar columns
     only (no jsonb yet)").
  2. A separate table — unnecessary at 5 flags; rejected.
     **Recommendation: 5 discrete nullable boolean columns on `inspections`** (or a single jsonb if
     the team prefers fewer columns — but scalar is the lower-risk default here).
- **No `answers`/`notes` table exists yet** — that is S-05's scope. But S-04 _defines the keys_
  S-05 will use (next section).

### 5. Forward-compat with S-05 (cards) and S-07 (pruning)

The catalogue's design already front-loads what those slices need; S-04 just has to _not break_
the contracts:

- **Stable IDs are the answer keys.** Questions have permanent `q_…` IDs and groups `g_…`. S-05
  should key answers `[inspectionId, questionId]` (the F-02 `dexie-reference.md` already suggests
  compound indexing). Because IDs are content-independent and stable, re-ordering or re-wording
  a label never orphans an answer. **S-04 must thread `questionId` (not array index) through the
  rendered set** so S-05 inherits stable keys for free.
- **Education pop-ups (FR-017) are pre-wired.** `explanationRef` → `explanations[ref].text` is in
  the bank. S-04's questions module should expose a resolver so S-05 only renders.
- **S-07 pruning is "re-run the predicate + diff."** On a visibility-affecting change
  (`fuelType|transmission|drive|bodyType` per `dependsOnFields`, or a flag toggle per FR-016),
  recompute the visible group/question-id set and drop answers whose `questionId` is no longer
  in it. `dependsOnFields` exists precisely to let S-07 know _which_ config edits can change
  visibility (cheap short-circuit). **S-04 decision that makes this cheap: expose
  `selectVisibleQuestionIds(config, flags): Set<string>` as the single source of truth for
  visibility**, so S-07 calls the same function and diffs.
- **Total Score / completion (FR-010, FR-019)** are over _answered ∈ visible_. Equal weighting,
  pure Yes/No/Don't-know distribution. S-04 can ship the indicator computing over the visible set
  with zero answers (0%); S-05 fills in answers; the math doesn't change. Keep the
  visible-set function the denominator source so the count never drifts from what's shown.

## Code References

- `idea/veriffica-questions-list/question-bank.json` — 206 questions + 59 explanations, stable
  `q_…`/`exp_…` IDs, `explanationRef` wiring (FR-017).
- `idea/veriffica-questions-list/question-bank.schema.json:74-131` — questionItem + explanationEntry shapes.
- `idea/veriffica-questions-list/question-mapping-config.json:5-30` — `visibilityModel` (formula, emptyBuckets, runtimeFlags).
- `idea/veriffica-questions-list/question-mapping-config.json:264-297, 608-642, 710-745` — the 6 flag-gated groups (AND semantics).
- `idea/veriffica-questions-list/question-mapping-config.schema.json:85-216` — `visibleWhen` + `questionGroup` (incl. `dependsOnFields`, `requiresEquipmentFlag`).
- `idea/veriffica-questions-list/list-of-questions.md:37-54` — the "Normalized visibility model" the PRD cites.
- `supabase/migrations/20260615120000_inspections_part1_config.sql:1-35` — 15 config columns; CHECK enums match catalogue exactly.
- `src/lib/part1-config.ts:37-41` — canonical `FUEL_TYPES/TRANSMISSIONS/DRIVES/BODY_TYPES` (the catalogue join key).
- `src/lib/part1-config.ts:163-166, 226-229` — CF-1 cross-field rule + `isConfigUnlocked()` (FR-013 gate).
- `src/pages/inspections/[id].astro:18-44` — SSR load → `camelcaseKeys` → `client:only` island (session-route template).
- `src/components/inspections/Part1Form.tsx:512-553` — `PartsNav` placeholder (locked/unlocked, no route target yet).
- `src/lib/db.ts:14-15, 29-40` — Dexie `Inspection` type + store schema (`inspections`, `changeQueue`).
- `src/lib/sync.ts:73-100, 115-158, 182-215` — `saveInspection` / `flushQueue` / `startAutoSync` (offline write path).
- `src/pages/api/inspections/sync.ts:44-59` — camel↔snake boundary, `owner_id` stamping, scalar-only upsert.
- `src/middleware.ts:4` — `PROTECTED_ROUTES` covers `/inspections`.
- `tsconfig.json:9-10` — `@/*` → `src/*`. `astro.config.mjs` — `output:"server"`, no content collections, env schema = server secrets only.
- `package.json` — `zod`, `type-fest`, `dexie`, `dexie-react-hooks` present; **no** ajv / json-schema validator.

## Architecture Insights

- **Rules-as-data is already the house style.** `part1-config.ts` keeps validation rules in Zod
  data with a thin exported API; the catalogue keeps visibility rules in JSON. The visibility
  predicate should follow suit: data in JSON, ~15-line pure evaluator in `src/lib/questions.ts`.
- **Two casing boundaries, never in between** (`lessons.md:24-44`): SSR read (`camelcaseKeys`)
  and the sync endpoint (`snakecaseKeys`/`camelcaseKeys`). Anything new (global notes, flag
  columns) inherits this automatically _if kept scalar_; jsonb would need the documented
  top-level-only transform caveat. Prefer scalar columns for flags.
- **Derived-not-stored** is the right default for the personalized set: it is a pure projection
  of static catalogue × persisted config × persisted flags, so it never needs sync, migration,
  or reconciliation — and S-07 is "recompute + diff," not "mutate a stored set."
- **Stable IDs everywhere** (`q_/g_/exp_`) are the linchpin that makes S-05 keying and S-07
  pruning cheap; S-04 must propagate `questionId`/`groupId`, never positional indices.
- **workerd / bundle**: `output:"server"`, no IndexedDB in SSR (`db.ts:1-4`), Dexie islands are
  `client:only`. The 80 KB bank should be imported **server-side** in the session route and the
  _filtered_ set passed to the island as props — avoids shipping the whole catalogue to the
  browser and keeps it off the client bundle.

## Historical Context (from prior changes)

- `context/archive/2026-06-14-part-1-config-validation/plan.md` — S-03: the 15-column config
  schema decision (scalar, nullable, CHECK enums), the SSR + sync casing boundaries, and the
  "unlock = full schema parse incl. CF-1" rule S-04 must reuse.
- `context/archive/2026-06-11-offline-first-persistence-layer/plan.md` + `dexie-reference.md` —
  F-02: the Dexie store + outbox + LWW sync contract; `useLiveQuery` read pattern; the
  compound-index suggestion (`[inspectionId, questionId]`) that S-05 answers should adopt.
- `context/foundation/lessons.md:24-44` — the camelCase/snake_case single-boundary rule (and the
  jsonb-contents exclusion) that constrains where global-notes and flag state should live.

## Related Research

- `context/archive/2026-06-11-offline-first-persistence-layer/research.md` — offline store
  contract and the single-writer/LWW rationale that the derived-set decision relies on.

## Open Questions

- **Equipment-flag persistence shape** — discrete boolean columns vs. a single `equipment_flags`
  jsonb on `inspections`. Recommendation: **discrete scalar booleans** (dodges the jsonb-casing
  caveat, rides existing sync). Confirm in `/10x-plan`.
- **Flag affordance placement** — a one-time "Equipment" step vs. always-visible toggles on the
  session screen. Recommendation: relevance-filtered toggles on the session screen (§3). Confirm
  with the user; non-blocking per roadmap.
- **Catalogue copy vs. reference** — copy the two JSON files into `src/data/questions/` (build it
  into the worker bundle, versioned with the app) vs. keep a single source in `idea/` and import
  across the boundary. Recommendation: **copy into `src/data/`** (idea/ is a planning area, not a
  runtime source) and add a tiny check (or a Zod parse at module load) so the in-app copy can't
  silently drift from the schema. Decide in `/10x-plan`.
- **Should S-04 ship a placeholder Total Score (0%) before S-05 answers exist?** Likely yes — the
  indicator computes over the visible set with zero answers and needs no rework when S-05 lands.
