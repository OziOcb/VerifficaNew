# Part 1 Config Form, Validation & Parts 2–5 Unlock — Implementation Plan

## Overview

Build the Part 1 vehicle-configuration form for an inspection: persist 15 config fields, enforce the strict field-by-field + cross-field validation defined in `idea/veriffica-part-1-validation-rules.md`, and gate Parts 2–5 behind the six required fields. This is roadmap slice **S-03** (Stream A north-star chain), prerequisite for the S-04 personalized question engine. Implements FR-011, FR-012, FR-013 and the first half of US-01.

## Current State Analysis

- **`inspections` table is a lifecycle skeleton** — `id, owner_id, status, name, created_at, updated_at` only, no Part 1 columns (`supabase/migrations/20260610181920_create_inspections.sql:29`). It is the F-01 template: `owner_id = (select auth.uid())` RLS, the reusable `public.set_updated_at()` trigger, `on delete cascade` FK.
- **`src/pages/inspections/[id].astro` is a stub** rendering "Part 1 — coming in S-03." It already SSR-loads the inspection by id under RLS and redirects to `/dashboard` on a null (foreign/missing) id. Route is in `PROTECTED_ROUTES`.
- **F-02 local-first stack is ready** to carry domain writes:
  - Dexie store `@/lib/db` — `Inspection = CamelCasedPropertiesDeep<InspectionRow> & { synced: 0|1 }`, auto-derived from generated DB types; indexed fields only in `db.version(1).stores(...)` (`inspections: "id, ownerId, updatedAt, synced"`).
  - `@/lib/sync` — `saveInspection(input)` does an atomic optimistic Dexie write + outbox enqueue; `flushQueue`/`startAutoSync` drain the outbox FIFO to the sync endpoint and adopt the authoritative row.
  - `POST /api/inspections/sync` — the single camel⇄snake boundary (`snakecaseKeys`/`camelcaseKeys`), strips the local-only `synced`, stamps `owner_id` from the session. Comment at `sync.ts:46` notes "scalar columns only (no jsonb yet), so the top-level transform is sufficient."
- **The dashboard uses a separate synchronous path** (`@/lib/inspections.ts`, Dexie-free) for create/delete — not used here.
- **No `zod` / `react-hook-form`** installed. shadcn UI present: `button, card, dialog, alert-dialog` only — no `input/select/label`.
- **Existing tests**: `tests/inspections.rls.test.ts` (RLS isolation), `inspections.limit.test.ts`, `inspections.sync.test.ts`, `db.test.ts`. Runner: Vitest (`npm test`). `npm run db:types` regenerates `src/db/database.types.ts` from the local DB.

## Desired End State

Opening an inspection at `/inspections/:id` shows the Part 1 form. Editing a field validates on blur (inline English errors). On explicit Save, the whole form is validated: if invalid, the page scrolls to and focuses the first invalid field and Parts 2–5 stay locked; if the six required fields are valid (and CF-1 passes), the normalized config is persisted via the local-first outbox, the inspection is auto-named from Make/Model, and the disabled Part 2–5 placeholders flip to an unlocked (but not-yet-functional) state. Reloading the page shows the saved config. Verify: `npm test` (validation + RLS) green; manual fill/save/unlock/reload round-trip on `npm run dev`.

### Key Discoveries:

- The Dexie `Inspection` type and the sync endpoint's transform **auto-absorb new scalar columns** once the migration lands and `npm run db:types` runs — no Dexie schema bump is needed for non-indexed fields, and `sync.ts` needs no change for scalar config columns (`src/lib/db.ts:14`, `src/pages/api/inspections/sync.ts:46`).
- Enums are stored as **lowercase keys** (`hybrid`, `2wd`, `automatic`, `hatchback`) per the rules doc §8 payload; mirror the F-01 `status text ... check (...)` pattern, not native PG enum types.
- Casing lesson is satisfied for free: typed scalar columns mean the existing top-level `snakecaseKeys`/`camelcaseKeys` is sufficient; no jsonb-exclusion handling is needed (`context/foundation/lessons.md` "Field casing").
- Auto-name: `name = "${make} ${model}"` (rules doc CF-2 "session title"); FR-006 allows optionally appending Year/Reg — keep to Make/Model for this slice.

## What We're NOT Doing

- **No S-04 session screen** (Part navigation, Total Score, completion indicator, global notes document, FR-010). Parts 2–5 are disabled placeholders only.
- **No question engine / personalization** (FR-014, S-04) — the unlock leads to stubs.
- **No Smart Pruning** on config change (FR-016, S-07) — re-saving config just overwrites; there are no answers to prune yet.
- **No runtime equipment flags** (`chargingPortEquipped`, etc., FR-014) — those are an S-04 layer, not Part 1 fields.
- **No autosave of partial drafts** — config is written only on a successful explicit Save (decision: explicit save only).
- **No new Playwright e2e** — validation is unit-tested; the form/unlock UX is manually verified.

## Implementation Approach

Bottom-up: land the schema + regenerated types first so every later layer (Dexie type, sync endpoint, Zod-inferred config type) compiles against real columns. Then encode the rules doc once as a Zod schema (single source of truth for shape, normalization, messages, and the unlock predicate) with exhaustive unit tests, since validation is the bug-prone core. Then extend the existing F-02 persistence path to carry config and add the shadcn form primitives. Finally build the React form island on `[id].astro` that composes all of it and renders the unlock state.

## Critical Implementation Details

- **Hydration source — SSR props, not Dexie (deliberate)**: the island is seeded from the SSR Supabase read (camelized per Phase 4 §1), not from the Dexie store. This gives an immediate first paint without waiting on IndexedDB. Caveat: F-02 makes Dexie the on-device source of truth, so if a prior Save is still **unsynced** (saved offline, outbox not yet drained), the SSR reload returns the older server row and the local edit won't show until the flush completes — a small coherence gap that is low-risk for this single-device, immediate-flush slice. Accepted for S-03; revisit if multi-device or longer offline windows arrive (a Dexie-first hydration with SSR props as first-paint fallback would close it, and would also make the F1 casing conversion unnecessary since Dexie rows are already camelCase).
- **Form island must be `client:only="react"`** — it imports `@/lib/sync` → `@/lib/db` (Dexie), which has no global on the workerd SSR runtime; a `client:load`/SSR mount throws at build/render (`src/lib/db.ts:1`). The SSR `[id].astro` frontmatter passes the loaded inspection (id, existing config, name) as props to the island.
- **Save → unlock ordering**: validate → on success write config to Dexie + enqueue (`saveInspection`) → trigger a flush → only then compute and render `configValid = true`. The unlock predicate is derived purely from the current config (full validation success), never from "a save happened," so a re-edit that invalidates a required field re-locks (CF-3). **Unlock must reflect _full_ validation, including the CF-1 cross-field rule** — not just the six required fields' individual validity: electric + manual passes per-field but is blocked at save, so a six-field-only predicate would wrongly show "unlocked" while editing. Define unlock as a successful full-schema parse (see Phase 2 §2).

## Phase 1: Schema + Types

### Overview

Add the Part 1 config columns to `inspections` and regenerate the typed DB client, then prove RLS still isolates the new columns owner-to-owner.

### Changes Required:

#### 1. Part 1 config migration

**File**: `supabase/migrations/<timestamp>_inspections_part1_config.sql` (new)

**Intent**: Add the 15 Part 1 fields as typed, nullable columns on `inspections`, following the F-01 conventions (snake_case, `text ... check (...)` for enums, no new RLS — the existing per-command policies already cover all columns). All nullable so the lifecycle-skeleton row created in S-02 stays valid; validity/required-ness is enforced in app code, not the DB.

**Contract**: Columns (snake_case): `price numeric(10,2)`, `make text`, `model text`, `year integer`, `registration_number text`, `vin text`, `mileage integer`, `fuel_type text`, `transmission text`, `drive text`, `color text`, `body_type text`, `door_count integer`, `address text`, `notes text`. CHECK constraints on the four (well, five incl. fuel) enum columns mirroring the rules doc lowercase keys: `fuel_type in ('petrol','diesel','hybrid','electric')`, `transmission in ('manual','automatic')`, `drive in ('2wd','4wd')`, `body_type in ('sedan','hatchback','suv','coupe','convertible','van','pickup','other')`. Each enum CHECK must allow `null` (nullable column with CHECK is null-permissive by default). No index needed (S-04 reads by inspection id, already the PK).

#### 2. Regenerate DB types

**File**: `src/db/database.types.ts` (regenerated)

**Intent**: Run `npm run db:types` after applying the migration locally so the generated `inspections` Row/Insert/Update gain the new columns; this auto-propagates to the Dexie `Inspection` type and the sync endpoint.

**Contract**: `Database["public"]["Tables"]["inspections"]["Row"]` includes the 15 new snake_case fields. Commit the regenerated file.

#### 3. Extend RLS test for config columns

**File**: `tests/inspections.rls.test.ts`

**Intent**: Add coverage that a second account cannot read another owner's Part 1 config (the new columns are subject to the same row-level isolation), and that an owner can write+read their own config. Follow the existing test's two-client setup.

**Contract**: New assertions selecting config columns across owners; reuses the existing helpers in `tests/helpers`.

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly: `npx supabase db reset` (or `db push` to local) succeeds
- [ ] `astro sync` passes after types regen: `npx astro sync`
- [ ] Type checking + lint pass: `npm run lint`
- [ ] RLS tests pass (incl. new config-column assertions): `npm test`

#### Manual Verification:

- [ ] `src/db/database.types.ts` diff shows the 15 new columns on `inspections` and is committed
- [ ] Enum CHECK constraints reject an out-of-range value when tested manually in `supabase studio`/psql

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Validation Module (Zod) + Unit Tests

### Overview

Encode `idea/veriffica-part-1-validation-rules.md` as a single Zod schema that validates, normalizes, and yields the typed config — plus the required-six unlock predicate — and unit-test it exhaustively.

### Changes Required:

#### 1. Add `zod` dependency

**File**: `package.json`

**Intent**: Add `zod` as a runtime dependency for shared client/server validation.

**Contract**: `zod` in `dependencies`; lockfile updated.

#### 2. Part 1 config validation schema

**File**: `src/lib/part1-config.ts` (new)

**Intent**: One module owning the config contract: per-field Zod rules with normalization (`trim`, collapse spaces, comma→dot for price, uppercase for VIN/registration, integer/decimal parsing, lowercase enum keys), the CF-1 cross-field refine (Electric ⇒ Automatic), the exact English error copy from rules doc §9, and a predicate that reports whether the six required fields (`make, model, fuelType, transmission, drive, bodyType`) are present and valid (drives unlock, CF-3). Export the inferred camelCase config type and a normalize-on-success path producing the persisted payload (rules doc §8 shape).

**Contract**: Exports (names illustrative): `part1ConfigSchema` (full Zod object incl. CF-1 `.superRefine`), `Part1Config` (inferred type, camelCase, matching the Dexie config fields), `validatePart1(input): { ok: true; config } | { ok: false; errors: Record<field,string> }`, and `isConfigUnlocked(config): boolean`. **`isConfigUnlocked` must run the _full_ schema** (`part1ConfigSchema.safeParse(...).success`), which includes the CF-1 `.superRefine` — not a separate six-field presence check. This makes unlock state exactly mirror "would a Save succeed," so an electric + manual edit (all six fields individually valid, but CF-1-blocked) correctly stays locked. Optional fields validate only when non-empty and persist as `null` when empty (rules doc §7). Field-level messages must be the exact strings in rules doc §9; CF-1 message: `Electric cars must use Automatic transmission.`

**Contract** (the two non-obvious patterns worth pinning down):

```ts
// VIN: optional, but exactly 17 chars from a restricted alphabet WHEN present.
// Excludes I, O, Q. Normalize (trim+uppercase) BEFORE the regex test.
vin: /^[A-HJ-NPR-Z0-9]{17}$/;
// year upper bound is dynamic: <= current year + 1
const maxYear = new Date().getFullYear() + 1; // lower bound 1886
```

#### 3. Validation unit tests

**File**: `tests/part1-config.test.ts` (new)

**Intent**: Exhaustively cover the rules doc — each field's accept/reject boundaries, every normalization, the CF-1 cross-field block, optional-empty→null behavior, and the `isConfigUnlocked` predicate (all six present/valid → true; any missing/invalid → false).

**Contract**: Vitest table-driven cases per field (valid boundary, invalid boundary, normalization assertion); explicit CF-1 case (electric+manual → blocked with the exact message); unlock predicate truth table (incl. an electric+manual case asserting `isConfigUnlocked === false` even though all six fields are individually present — the CF-1 guard).

### Success Criteria:

#### Automated Verification:

- [ ] Validation unit tests pass: `npm test`
- [ ] Lint + type check pass: `npm run lint`
- [ ] Every field rule, normalization, CF-1, and the unlock predicate have at least one accept and one reject case

#### Manual Verification:

- [ ] Spot-check the normalized output of a sample form matches rules doc §8 payload shape (enum keys lowercase, VIN/registration uppercased, price comma→dot)

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Persistence Plumbing + Form Primitives

### Overview

Extend the F-02 local-first path to carry config and add the shadcn form primitives the island needs. Most of this is type-level — the runtime sync endpoint needs no change for scalar columns.

### Changes Required:

#### 1. Extend `saveInspection` to carry config

**File**: `src/lib/sync.ts`

**Intent**: Widen the `SaveInput` type and the optimistic row builder so a save can include the Part 1 config fields (in addition to id/status/name). The Dexie `Inspection` type already gains the fields from the regenerated types (`src/lib/db.ts:15`), so this is extending the input projection and spreading the config into the `row` written + enqueued.

**Contract**: `SaveInput` gains `Partial<Pick<Inspection, <config fields>>>`; the `row` object in `saveInspection` includes those fields (defaulting unset ones to `null`). No Dexie `db.version` bump — config fields are non-indexed, so `stores(...)` is unchanged.

#### 2. Confirm sync endpoint handles config (no change expected)

**File**: `src/pages/api/inspections/sync.ts`

**Intent**: Verify the existing top-level `snakecaseKeys`/`camelcaseKeys` round-trips the new scalar columns correctly; update the `sync.ts:46` "no jsonb yet" comment if needed. No logic change anticipated.

**Contract**: `put` upserts a payload that now includes config columns; the authoritative camelCase row returned includes them. (If any field needs special handling it would surface here — none expected for scalars.)

#### 3. Add shadcn form primitives

**Files**: `src/components/ui/input.tsx`, `src/components/ui/label.tsx`, `src/components/ui/select.tsx` (new, generated)

**Intent**: Generate the missing shadcn "new-york" primitives matching `components.json` so the form uses the project's UI convention; `select` provides accessible enum dropdowns.

**Contract**: Standard shadcn components in `@/components/ui`; adds `@radix-ui/react-select` (+ its peers) to `dependencies`.

#### 4. Update `Inspection`-literal test fixtures for the widened type

**File**: `tests/db.test.ts` (and any other full-`Inspection` literal)

**Intent**: Once the regenerated types widen `Inspection` with the 15 config keys (nullable but still **required properties**), every full-`Inspection` literal must include them or the type-checked `npm run lint`/`npm test` fails. The `makeInspection` helper at `tests/db.test.ts:11` currently lists 7 fields.

**Contract**: Extend `makeInspection` (the single fixture builder; tests use `Partial` overrides on top of it) with the 15 config fields defaulted to `null`. `tests/inspections.sync.test.ts` payloads are plain objects (not typed `Inspection`), so they need no change — but grep for any other `Inspection` literal before assuming. This is the one place "reuse existing tests unchanged" does **not** hold.

### Success Criteria:

#### Automated Verification:

- [ ] Type check + lint pass with the widened `SaveInput` and new components: `npm run lint`
- [ ] Existing sync unit tests still pass: `npm test` (`tests/inspections.sync.test.ts`, `tests/db.test.ts`)
- [ ] `astro sync` passes: `npx astro sync`

#### Manual Verification:

- [ ] A scripted/console `saveInspection` with config fields, then `flushQueue`, produces a row in Supabase with the config columns populated (snake_case)

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Part 1 Form Island + Unlock

### Overview

Build the React form on `[id].astro` that composes the schema, persistence, and primitives, enforces the UX rules, and renders the derived unlock state.

### Changes Required:

#### 1. Pass loaded config from SSR into the page

**File**: `src/pages/inspections/[id].astro`

**Intent**: Extend the existing RLS-scoped SSR select to fetch the config columns alongside `id, name`, and mount the form island with the loaded inspection as props. Keep the null→redirect guard.

**Contract**: `.select(...)` widened to the config columns; render `<Part1Form client:only="react" inspection={...} />` inside the existing `Layout`. Frontmatter stays Dexie-free (island is `client:only`).

**Casing — second read boundary (do not skip)**: supabase-js returns the row in **snake_case** (`fuel_type`, `body_type`, `door_count`, `registration_number`, …), but `Part1Config` / the Dexie `Inspection` type are **camelCase**. The existing stub only selected `id,name` (identical in both cases), so there is no camelize call to copy and the lessons.md "single boundary" rule does not yet cover this path. The SSR page load is a **second read boundary out of supabase-js** and must convert: run the loaded row through the generic `camelcaseKeys(row, { deep: true })` in the frontmatter before passing it as props (same generic, table-agnostic helper the sync endpoint already uses at `sync.ts:59` — not a per-table mapper, so it stays lesson-compliant). Without this, the camelCase form fields bind to undefined and the saved config renders blank on reload (would fail Manual Verification 4.7).

#### 2. Part 1 form island

**File**: `src/components/inspections/Part1Form.tsx` (new)

**Intent**: Controlled React form for all 15 fields using the shadcn primitives (selects for the enums). Blur validation per field (inline error under the field, UX-1); explicit Save runs `validatePart1`; on failure, scroll to + focus the first invalid field (UX-2/UX-3) and keep Parts 2–5 locked; on success, call `saveInspection` with the normalized config + auto-name, trigger a flush, and reflect the unlocked state. Soft on-input formatting hints only (no blocking on input, rules doc §2). All copy English (FR-024).

**Contract**: Props: the loaded inspection (id, existing config, name, **`createdAt`, `status`**). Uses `validatePart1`/`isConfigUnlocked` from `@/lib/part1-config` and `saveInspection`/`flushQueue` from `@/lib/sync`. **Preserve `created_at`/`status` on save**: `saveInspection` builds a full row and the endpoint upserts `created_at` explicitly (`sync.ts:54`, `sync.ts:49`) with no protective trigger — so the Save MUST pass the loaded `createdAt` and `status` through to `saveInspection` (both already accepted by `SaveInput`, `sync.ts:39`). Omitting them defaults `createdAt` to `now` (clobbering the original creation timestamp) and `status` to `"draft"`. `updated_at` is safe — the `set_updated_at` trigger overrides it. Auto-name: `name = \`${make} ${model}\``. First-invalid focus uses a ref map keyed by field id; scroll via `scrollIntoView`. On mount, run `resetLocalStoreOnUserChange` is NOT this island's job (dashboard owns it) — assume the store is already scoped.

#### 3. Disabled Parts 2–5 placeholder + unlock affordance

**File**: `src/components/inspections/Part1Form.tsx` (or a sibling `PartsNav.tsx`)

**Intent**: Render Parts 2–5 as visibly disabled placeholders while `isConfigUnlocked` is false (UX-5), flipping to an enabled-but-inert state (links/buttons that are present but lead to the S-04 stub) once config is valid and saved. The lock state is derived from the current valid config, not a "saved" flag.

**Contract**: A small presentational block reading the unlock boolean; disabled state has an explanatory line ("Save the required Part 1 fields to unlock Parts 2–5."). No navigation target beyond the existing stub.

### Success Criteria:

#### Automated Verification:

- [ ] Lint + type check pass: `npm run lint`
- [ ] `astro sync` + build succeed: `npx astro sync && npm run build`
- [ ] Full test suite green: `npm test`

#### Manual Verification:

- [ ] Filling only some required fields and clicking Save scrolls to + focuses the first invalid field and shows inline English errors; Parts 2–5 stay disabled
- [ ] Entering Electric + Manual and saving shows `Electric cars must use Automatic transmission.` and stays locked (CF-1)
- [ ] Filling all six required fields validly and saving unlocks Parts 2–5 and sets the inspection name to `Make Model`
- [ ] Reloading `/inspections/:id` shows the saved, normalized config (VIN/registration uppercased, enum selects pre-selected)
- [ ] Optional fields left empty persist as null and do not block save; an invalid optional field (e.g. bad VIN) blocks save with its message
- [ ] Dashboard tile reflects the new auto-name after save

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation. This completes the slice.

---

## Testing Strategy

### Unit Tests:

- `tests/part1-config.test.ts` — every field's accept/reject boundary, all normalizations, CF-1 cross-field block, optional-empty→null, and the `isConfigUnlocked` required-six predicate.
- Reuse the existing sync/db tests to guard the persistence path. **One exception**: the `makeInspection` fixture in `tests/db.test.ts` must gain the 15 config fields (defaulted to `null`) because the widened `Inspection` type makes them required keys (Phase 3 §4) — the rest of the sync/db tests are unchanged.

### Integration Tests:

- `tests/inspections.rls.test.ts` extended so the new config columns are covered by the owner-isolation contract.

### Manual Testing Steps:

1. Start `npm run dev`, open an inspection from the dashboard.
2. Click Save with empty form → first required field focused, inline errors shown, Parts 2–5 disabled.
3. Fill all six required fields validly + an invalid optional VIN → save blocked on VIN.
4. Fix VIN (or clear it) → save succeeds, name becomes `Make Model`, Parts 2–5 enable.
5. Set fuel Electric + transmission Manual → save blocked with CF-1 message.
6. Reload the page → normalized config persists; reload dashboard → tile shows the new name.

## Performance Considerations

Trivial — one short form, one local write + one single-record sync POST. No hotspots.

## Migration Notes

The new migration must be applied to **hosted Supabase before this slice deploys** (DB migrations are not in the Cloudflare Workers deploy pipeline — see the S-02 deploy note in `roadmap.md` and README "Database schema & migrations"): `npx supabase db push` against the linked project. Existing skeleton rows remain valid because all new columns are nullable.

## References

- Validation rules: `idea/veriffica-part-1-validation-rules.md`
- Roadmap slice S-03: `context/foundation/roadmap.md`
- Migration template: `supabase/migrations/20260610181920_create_inspections.sql`
- Persistence path: `src/lib/sync.ts`, `src/lib/db.ts`, `src/pages/api/inspections/sync.ts`
- Casing rule: `context/foundation/lessons.md` "Field casing"
- Form home: `src/pages/inspections/[id].astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema + Types

#### Automated

- [x] 1.1 Migration applies cleanly (`supabase db reset`/push to local) — f3b05eb
- [x] 1.2 `astro sync` passes after types regen — f3b05eb
- [x] 1.3 Type checking + lint pass (`npm run lint`) — f3b05eb
- [x] 1.4 RLS tests pass incl. new config-column assertions (`npm test`) — f3b05eb

#### Manual

- [x] 1.5 `database.types.ts` diff shows 15 new columns and is committed — f3b05eb
- [x] 1.6 Enum CHECK constraints reject out-of-range values — f3b05eb

### Phase 2: Validation Module (Zod) + Unit Tests

#### Automated

- [x] 2.1 Validation unit tests pass (`npm test`) — 89fa2b5
- [x] 2.2 Lint + type check pass (`npm run lint`) — 89fa2b5
- [x] 2.3 Every field rule, normalization, CF-1, and unlock predicate have accept + reject cases — 89fa2b5

#### Manual

- [x] 2.4 Normalized sample output matches rules doc §8 payload shape — 89fa2b5

### Phase 3: Persistence Plumbing + Form Primitives

#### Automated

- [x] 3.1 Type check + lint pass with widened `SaveInput` + new components (`npm run lint`) — 9dc74f7
- [x] 3.2 Existing sync/db unit tests still pass (`npm test`) — 9dc74f7
- [x] 3.3 `astro sync` passes — 9dc74f7

#### Manual

- [x] 3.4 `saveInspection` with config + `flushQueue` writes config columns to Supabase — 9dc74f7

### Phase 4: Part 1 Form Island + Unlock

#### Automated

- [ ] 4.1 Lint + type check pass (`npm run lint`)
- [ ] 4.2 `astro sync` + build succeed (`npx astro sync && npm run build`)
- [ ] 4.3 Full test suite green (`npm test`)

#### Manual

- [ ] 4.4 Save with missing required fields scrolls to + focuses first invalid; inline errors; Parts 2–5 disabled
- [ ] 4.5 Electric + Manual save shows CF-1 message and stays locked
- [ ] 4.6 All six required valid → save unlocks Parts 2–5 and sets name to `Make Model`
- [ ] 4.7 Reload shows saved normalized config (uppercased VIN/registration, enums pre-selected)
- [ ] 4.8 Empty optional persists null; invalid optional blocks save with its message
- [ ] 4.9 Dashboard tile reflects the new auto-name
