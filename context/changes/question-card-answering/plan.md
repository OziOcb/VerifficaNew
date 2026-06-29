# Question-Card Answering (S-05) Implementation Plan

## Overview

Build the answering surface for Parts 2–5: a full-screen card deck (one question per
screen) where the user taps `Yes` / `No` / `Don't know`, with mandatory answering,
lossless back-navigation, a per-Part progress indicator, a transition screen after each
Part, an educational `i`-popup, and a 500-char contextual note per question. Answers
persist immediately to a new `answers` JSONB map on the inspection row, riding the
existing offline outbox/sync machinery. Implements FR-015, FR-017, FR-018, US-01.

## Current State Analysis

- **Visibility engine is done (S-04).** `src/lib/questions.ts` already produces the
  personalized question set: `selectVisibleGroups`, `selectVisibleQuestionIds`,
  `visibleCountsByPart`, and `resolveExplanation(ref)` exist and are unit-tested
  (`tests/questions.test.ts`). The catalogue (206 questions, 172 explanations) is parsed,
  Zod-validated, and frozen at module load. This module is **server-safe / Dexie-free**.
- **The card screen is a placeholder.** `src/pages/inspections/[id]/session/part/[part].astro`
  (lines ~100–104) renders "Question cards arrive next." for Parts 2–5. The route already
  SSR-loads the inspection, validates config-unlock (`resolvePartScreen`), and computes the
  per-Part visible count — the body is the only thing S-05 swaps.
- **No answer store exists.** The whole app persists through a single `inspections` row →
  Dexie outbox (`src/lib/db.ts`) → `saveInspection`/`flushQueue` (`src/lib/sync.ts`) →
  `/api/inspections/sync` (`src/pages/api/inspections/sync.ts`). There is no `answers`
  table, Dexie store, or sync entity. The sync endpoint notes "scalar columns only
  (no jsonb yet)".
- **The optimistic write path is generic.** `saveInspection` does a read-merge over
  `DATA_FIELDS` and enqueues an outbox op atomically; a sparse `{ id, answers }` save will
  preserve every other column. The `Inspection` type is `CamelCasedPropertiesDeep<Row>` so
  it auto-tracks `npm run db:types` — adding the column regenerates the type with no
  hand-written mapper.
- **Contextual notes are not a new store.** FR-018 appends a note to the existing
  10,000-char `globalNotes` document with the question text as a header. The `globalNotes`
  column, its cap (`MAX_GLOBAL_NOTES_LENGTH`), and the sync-boundary guard already exist
  (`src/lib/part1-config.ts`, `src/lib/sync-payload-validation.ts`).
- **Session Total Score / Completion render hardcoded 0** by design
  (`SessionScreen.tsx:162–179`); lighting up those numerators is **deferred to S-06**.
- A `dialog` UI primitive exists (`src/components/ui/dialog.tsx`) for the education popup.

## Desired End State

A user with a valid Part-1 config can open any of Parts 2–5 from the session screen, land
on the first unanswered question, tap an answer to auto-advance through the personalized
deck, go Back losslessly (browser/OS Back or an in-card control) without re-answering, open
an `i`-popup on questions that have an explanation, attach a 500-char note that lands in the
global notes document under the question's header, and reach an "OK → session" transition
screen at the end of the Part. Every answer and note survives going offline and a reload,
and syncs automatically on reconnect. Verified by: the new unit/integration tests pass, the
existing sync/RLS suites stay green, and the manual card-flow checks below pass under
`wrangler dev`.

### Key Discoveries:

- Casing lesson + read-merge make a JSONB answers map nearly free to sync — but the deep
  key-case transforms **must not recurse into the map** (see Critical Implementation Details).
- `resolveExplanation` is server-only (imports the 80 KB catalogue) — explanation text must
  be resolved server-side in the route and passed into the island as part of the deck
  payload; the catalogue never reaches the client (`questions.ts:17–19`).
- The route already narrows the inspection to non-null and computes config-unlock; the card
  body inherits that guard for free.

## What We're NOT Doing

- **Not** lighting up the session-screen Total Score / Completion numerators — they stay at
  their 0-state; full scoring + per-Part charts are **S-06** (`summary-scoring-finalize`).
- **Not** building the Summary page or inline answer editing (FR-019/FR-020) — **S-06**.
- **Not** implementing Smart Pruning on config change (FR-016) — **S-07**; this plan only
  ensures the answers map is the single structure S-07 will prune.
- **Not** adding a separate `answers` table, Dexie store, or sync entity.
- **Not** adding a touch-drag gesture library — "swipe" is a tap-driven slide animation.
- **Not** per-card URLs — card position lives in the island via the History API.
- **Not** new offline/sync end-to-end hardening (FR-023 flow-level) — **S-08**.

## Implementation Approach

Four phases, bottom-up: (1) add the `answers` column and make it sync correctly; (2) build
the pure, unit-tested answer/question/note logic; (3) build the card deck island and wire it
into the route; (4) layer the education popup and contextual notes onto the card. Each phase
is independently verifiable. The data and logic phases carry the correctness risk (casing,
ordering, persistence); the UI phases carry the UX-guarantee risk (mandatory answering,
lossless back).

## Critical Implementation Details

- **JSONB key-case exclusion (load-bearing).** Answers are keyed by opaque question IDs
  (`q_p2_base_car_body_corrosion_bonnet`) that **must stay verbatim** to match the catalogue.
  The sync endpoint hands the row back through `camelcaseKeys(data, { deep: true })`, and any
  `.astro` route that selects `answers` does the same — a deep transform would mangle the
  map's keys into `qP2BaseCarBodyCorrosionBonnet`. Exclude the `answers` field from the deep
  recursion via `camelcaseKeys`'s `stopPaths: ["answers"]` (camelcase-keys ^10 supports it).
  Outbound `snakecaseKeys(...)` in the endpoint is already shallow (default `deep: false`),
  so it leaves the map intact — keep it shallow. This is the casing lesson's explicit
  "exclude jsonb column contents" rule.
- **History API + mandatory answering interaction.** Auto-advance fires only on tapping an
  answer, so the first time a card is reached it has no forward affordance other than
  answering (this _is_ the mandatory-answer gate). A Back into an already-answered card must
  expose a Next control — the single rule is **Next is enabled iff the current card already
  has an answer**. Back maps to the History `popstate`; the first card's Back exits to the
  session screen. Persisting each answer before/at advance is what makes Back lossless.

---

## Phase 1: Answers data model & sync wiring

### Overview

Add the `answers` JSONB column, regenerate types, and make the existing outbox/sync path
carry it correctly — including the key-case exclusion so question IDs survive the round-trip.

### Changes Required:

#### 1. Migration — add the answers column

**File**: `supabase/migrations/<timestamp>_inspections_answers.sql`

**Intent**: Add a server-side store for answers on the existing owner-scoped row, defaulting
to an empty map so every existing inspection reads as "no answers" with no backfill.

**Contract**: `alter table inspections add column answers jsonb not null default '{}'::jsonb;`
No new RLS (inherits the row's owner policy). Follow the existing migration header/comment
style.

#### 2. Regenerate DB types

**File**: `src/db/database.types.ts` (generated)

**Intent**: Pick up the new column so `Inspection` (`CamelCasedPropertiesDeep<Row>`) gains
`answers` with no hand edit.

**Contract**: Run `npm run db:types`; commit the regenerated file. `answers` types as `Json`.

#### 3. Carry answers through the optimistic write path

**File**: `src/lib/sync.ts`

**Intent**: Let a sparse `saveInspection({ id, answers })` persist + enqueue the map while the
read-merge preserves it across other sparse saves (e.g. `globalNotes`).

**Contract**: Add `"answers"` to `SESSION_FIELDS` (or a sibling data-field list) so it joins
`DATA_FIELDS`. `answers` is a non-indexed property → **no Dexie `db.version` bump**. Confirm
the `SaveInput`/`Pick<Inspection, DataField>` types accept the map.

#### 4. Exclude the answers map from deep key-casing at the sync boundary

**File**: `src/pages/api/inspections/sync.ts`

**Intent**: Keep question-ID keys verbatim on the row returned to the client.

**Contract**: Change the return transform to
`camelcaseKeys(data, { deep: true, stopPaths: ["answers"] })`. Leave the outbound
`snakecaseKeys(...)` shallow (it already is). Add a one-line comment citing the casing lesson.

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly against local Supabase (`npx supabase db reset` or project migrate script)
- [ ] `npm run db:types` produces a diff containing `answers` and the tree is clean after commit
- [ ] Type checking passes: `npm run lint` (after `npx astro sync`)
- [ ] Existing sync/round-trip tests pass: `npm test` (`tests/sync.test.ts`, `tests/inspections.sync.test.ts`, `tests/sync.drain.test.ts`)
- [ ] New test: a payload whose `answers` map has `q_…` keys round-trips through the endpoint's transform with keys **unchanged** (asserts the `stopPaths` exclusion)

#### Manual Verification:

- [ ] After a `saveInspection({ id, answers })` then `flushQueue`, the Supabase row's `answers` column shows the map with original `q_…` keys (checked via Studio or `wrangler dev` round-trip)

**Implementation Note**: After automated verification passes, pause for manual confirmation
before Phase 2.

---

## Phase 2: Pure answer / question / note logic

### Overview

Build the framework-free, unit-tested core the card island consumes: the answers model, the
ordered per-Part deck (with explanation text + display header resolved), and the
note append/replace helper. No UI.

### Changes Required:

#### 1. Answers model module

**File**: `src/lib/answers.ts` (new)

**Intent**: Own the answer value domain and the small aggregations the card flow needs now
and S-06 reuses later, with no Dexie/React import (server-safe, testable).

**Contract**: Export `Answer = "yes" | "no" | "dont_know"` and `AnswersMap = Record<string, Answer>`
(align with the catalogue's `allowedAnswers`). Export helpers: `answeredCount(ids, answers)`,
`firstUnansweredIndex(orderedIds, answers)` (returns the resume index; `-1`/length when all
answered), and `distribution(ids, answers)` → `{ yes, no, dontKnow }`. Pure functions over a
plain map.

#### 2. Ordered per-Part deck + card payload in the engine

**File**: `src/lib/questions.ts`

**Intent**: Give the route a single call that returns the ordered visible questions for one
Part, each with its display header and resolved explanation text, so the island needs neither
the catalogue nor `resolveExplanation`.

**Contract**: Add `selectVisibleQuestions(config, flags, part)` returning the visible
`Question[]` for that Part ordered by group `order` then question `order`. Add a
`cardPayload`-style builder (or extend the above) that maps each question to
`{ id, header, label, section, subsection, explanation: string | null }`, where `explanation`
comes from `resolveExplanation(explanationRef)` and `header` is the FR-018 note header
(composed from section / subsection / label). Keep the module Dexie-free.

#### 3. Note append/replace helper

**File**: `src/lib/answers.ts` (or a `notes` helper colocated)

**Intent**: Implement FR-018 with the decided "replace that question's block" semantics so a
re-note overwrites rather than duplicates.

**Contract**: `upsertNoteBlock(globalNotes, header, note)` → new document string. A block is a
header line (the question header) followed by the note body; the function replaces an existing
block with the same header in place, or appends a new block if absent, and removes the block
when `note` is empty. Deterministic, idempotent, total length still bounded by the existing
10,000-char guard. Pick an unambiguous header delimiter so blocks parse back reliably.

### Success Criteria:

#### Automated Verification:

- [ ] Unit tests for `answers.ts`: `answeredCount`, `firstUnansweredIndex` (empty / partial / full), `distribution`
- [ ] Unit tests for `upsertNoteBlock`: insert, replace-same-header (no duplication), empty-note removal, ordering preserved
- [ ] Unit tests for `selectVisibleQuestions` / card payload: correct order, explanation resolved for questions with `explanationRef` and `null` otherwise, reconciled against the catalogue source of truth
- [ ] Type check + lint pass: `npm run lint`
- [ ] Full suite green: `npm test`

#### Manual Verification:

- [ ] Spot-check the composed note header for a representative question reads naturally (agent reconciles against `list-of-questions.md`)

**Implementation Note**: After automated verification passes, pause for manual confirmation
before Phase 3.

---

## Phase 3: Card deck island & answer flow

### Overview

Build the full-screen card deck and wire it into the Part route: tap-to-answer with optimistic
persist and auto-advance, slide animation, Back/Next navigation via the History API, per-Part
progress, resume at the first unanswered card, and the end-of-Part transition screen. (Education
popup and contextual notes land in Phase 4.)

### Changes Required:

#### 1. Card deck island

**File**: `src/components/inspections/QuestionCards.tsx` (new)

**Intent**: Render one question at a time and drive the whole answering interaction client-side,
persisting each answer through the existing optimistic path.

**Contract**: `client:only="react"` (imports `@/lib/sync` → Dexie). Props: the inspection `id`,
the ordered card payload from Phase 2, and the initial `answers` map. State: current card index
(initialized to `firstUnansweredIndex`), local answers overlay backed by `useLiveQuery(db.inspections.get(id))`
so an offline answer reflects without a server round-trip (mirror the `SessionScreen` live-row
pattern). Tapping an answer calls `saveInspection({ id, answers: nextMap })` then `flushQueue`,
and auto-advances. Per-Part progress shows `current / total`. **Next enabled iff the current card
has an answer**; **Back always present** (first card's Back → session screen). Run `startAutoSync()`
in an effect (as `SessionScreen` does). All `setState` happens outside the effect body
(React-Compiler constraint).

#### 2. History API wiring for Back

**File**: `src/components/inspections/QuestionCards.tsx`

**Intent**: Make the browser/OS Back button (and back gesture) step one card back losslessly,
then exit to the session screen past the first card — without per-card URLs.

**Contract**: Push a history entry per forward card move; handle `popstate` to decrement the
index; guard against double-push. Because each answer is already persisted, stepping back never
loses an answer. Contain all history logic in this component.

#### 3. Transition screen

**File**: `src/components/inspections/QuestionCards.tsx` (sub-view or sibling)

**Intent**: FR-015's end-of-Part transition: after the last card, show a confirmation with `OK`
that returns to the session screen.

**Contract**: A simple full-screen panel with an `OK` action linking/navigating to
`/inspections/{id}/session`. Reached when advancing past the final card.

#### 4. Swap the island into the Part route

**File**: `src/pages/inspections/[id]/session/part/[part].astro`

**Intent**: Replace the "Question cards arrive next." placeholder with the real deck, resolving
the deck payload + initial answers server-side.

**Contract**: For Parts 2–5, build the card payload via the Phase-2 engine call from the loaded
config/flags, read the inspection's `answers` map (selecting `answers` and applying
`camelcaseKeys(..., { stopPaths: ["answers"] })`), and render
`<QuestionCards client:only="react" id=… cards=… initialAnswers=… />`. Keep the existing
config-unlock redirect guard. The 80 KB catalogue stays server-side.

### Success Criteria:

#### Automated Verification:

- [ ] Component/logic tests for navigation: cannot advance an unanswered card; Next gated on answered; Back decrements; resume index honored
- [ ] Type check + lint pass: `npm run lint`
- [ ] Full suite green: `npm test`
- [ ] Production build succeeds: `npm run build`

#### Manual Verification (under `npm run build && npx wrangler dev --port 4321`):

- [ ] Opening a Part lands on the first unanswered card; answered Parts open with answers pre-selected and Next available
- [ ] Tapping an answer records it and auto-advances; cannot advance without answering
- [ ] Back (in-card control AND browser/OS Back) returns to the prior card with its answer intact; Back on the first card returns to the session screen
- [ ] Per-Part progress shows correct `current / total`
- [ ] End-of-Part transition screen appears; `OK` returns to the session screen
- [ ] Reload mid-Part resumes at the right card with all answers intact (offline-safe)

**Implementation Note**: After automated verification passes, pause for manual confirmation
before Phase 4.

---

## Phase 4: Education popup & contextual notes

### Overview

Layer the FR-017 educational `i`-popup and the FR-018 500-char contextual note onto the card.

### Changes Required:

#### 1. Education `i`-popup

**File**: `src/components/inspections/QuestionCards.tsx`

**Intent**: Show the linked explanation for questions that have one, without shipping the
catalogue to the client.

**Contract**: Render an `i` icon only when the card payload's `explanation` is non-null; clicking
opens the existing `dialog` primitive with that text. No icon when there is no explanation.

#### 2. Contextual note on the card

**File**: `src/components/inspections/QuestionCards.tsx`

**Intent**: FR-018 — a per-question note (≤500 chars) that lands in the global notes document
under the question header, replacing any prior note for that question.

**Contract**: A note affordance on the card with a 500-char limit and counter (mirror the
global-notes limit UX in `SessionScreen`). On save, compute the new document with
`upsertNoteBlock(globalNotes, header, note)` (Phase 2) and persist via
`saveInspection({ id, globalNotes })` → `flushQueue`. Pre-fill the field from the existing block
for that question (parsed back from the document) so editing replaces rather than duplicates.
Enforce the 500-char cap client-side; the existing 10,000-char server guard still bounds the doc.

### Success Criteria:

#### Automated Verification:

- [ ] Test: a note save produces the expected global-notes document (insert + replace-same-question via `upsertNoteBlock`)
- [ ] Test: education icon presence maps to explanation presence
- [ ] Type check + lint pass: `npm run lint`
- [ ] Full suite green: `npm test`
- [ ] Production build succeeds: `npm run build`

#### Manual Verification (under `wrangler dev`):

- [ ] `i` icon appears only on questions with an explanation; the popup shows the correct text
- [ ] Adding a note appends a headed block to the global notes document (visible on the session screen)
- [ ] Re-noting the same question replaces its block (no duplicate header); clearing the note removes the block
- [ ] The 500-char limit is enforced on the note field; the document still respects the 10,000-char cap
- [ ] Notes added offline survive reload and sync on reconnect

**Implementation Note**: After automated verification passes, pause for final manual
confirmation.

---

## Testing Strategy

### Unit Tests:

- `answers.ts`: `answeredCount`, `firstUnansweredIndex`, `distribution`, `upsertNoteBlock`
- `questions.ts`: `selectVisibleQuestions` order + card payload + explanation resolution
- Sync boundary: `answers` map keys survive the `stopPaths` transform unchanged

### Integration Tests:

- Existing `tests/sync.*` / `tests/inspections.sync.test.ts` stay green with the new column
- An end-to-end optimistic-write → flush → adopt cycle carrying an `answers` map

### Manual Testing Steps:

1. Under `npm run build && npx wrangler dev --port 4321`, open a Part and answer through it
   (mandatory answering, auto-advance, Back, transition screen).
2. Go offline (DevTools), answer + note several questions, reload — confirm no loss; go online
   and confirm sync.
3. Open the education popup on a question that has one and one that doesn't.
4. Re-note the same question and confirm the block is replaced, not duplicated.

> SW/offline behavior must be exercised under `wrangler dev`, never `astro dev` (lessons.md
> "Service worker is build-only"). Discard the registered SW afterward.

## Performance Considerations

Whole-map answer writes are trivial at ~206 keys; debounce is optional. Score/progress
recompute is client-side from the in-memory map, well within the <200 ms perceived-update NFR.

## Migration Notes

`answers jsonb not null default '{}'` needs no backfill — existing rows read as an empty map.
The column is additive and owner-scoped via the inherited RLS policy.

## References

- Change identity: `context/changes/question-card-answering/change.md`
- PRD: FR-015, FR-017, FR-018, US-01 (`context/foundation/prd.md`)
- Roadmap slice: S-05 (`context/foundation/roadmap.md:166`)
- Visibility engine: `src/lib/questions.ts`
- Optimistic sync path: `src/lib/sync.ts`, `src/pages/api/inspections/sync.ts`
- Casing rule: `context/foundation/lessons.md` ("Field casing", jsonb exclusion)
- Card route placeholder: `src/pages/inspections/[id]/session/part/[part].astro:100`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Answers data model & sync wiring

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase — 2d4a787
- [x] 1.2 `npm run db:types` diff contains `answers`; tree clean after commit — 2d4a787
- [x] 1.3 Type checking passes: `npm run lint` — 2d4a787
- [x] 1.4 Existing sync/round-trip tests pass: `npm test` — 2d4a787
- [x] 1.5 New test: `answers` `q_…` keys round-trip the endpoint transform unchanged — 2d4a787

#### Manual

- [x] 1.6 Supabase row `answers` shows the map with original `q_…` keys after save + flush — 2d4a787

### Phase 2: Pure answer / question / note logic

#### Automated

- [x] 2.1 Unit tests for `answers.ts` (`answeredCount`, `firstUnansweredIndex`, `distribution`)
- [x] 2.2 Unit tests for `upsertNoteBlock` (insert, replace-same-header, empty removal, ordering)
- [x] 2.3 Unit tests for `selectVisibleQuestions` / card payload (order, explanation resolution)
- [x] 2.4 Type check + lint pass: `npm run lint`
- [x] 2.5 Full suite green: `npm test`

#### Manual

- [x] 2.6 Composed note header reads naturally (reconciled vs `list-of-questions.md`)

### Phase 3: Card deck island & answer flow

#### Automated

- [ ] 3.1 Navigation tests: no advance unanswered; Next gated on answered; Back decrements; resume index honored
- [ ] 3.2 Type check + lint pass: `npm run lint`
- [ ] 3.3 Full suite green: `npm test`
- [ ] 3.4 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.5 Part opens at first unanswered card; answered Parts pre-select with Next available
- [ ] 3.6 Tap records + auto-advances; cannot advance without answering
- [ ] 3.7 Back (in-card and browser/OS) is lossless; first-card Back → session screen
- [ ] 3.8 Per-Part progress correct; transition screen `OK` → session
- [ ] 3.9 Reload mid-Part resumes correctly with answers intact

### Phase 4: Education popup & contextual notes

#### Automated

- [ ] 4.1 Test: note save produces expected document (insert + replace via `upsertNoteBlock`)
- [ ] 4.2 Test: education icon presence maps to explanation presence
- [ ] 4.3 Type check + lint pass: `npm run lint`
- [ ] 4.4 Full suite green: `npm test`
- [ ] 4.5 Production build succeeds: `npm run build`

#### Manual

- [ ] 4.6 `i` icon only on questions with an explanation; popup text correct
- [ ] 4.7 Note appends a headed block to the global notes document
- [ ] 4.8 Re-noting replaces the block (no duplicate); clearing removes it
- [ ] 4.9 500-char note cap enforced; document respects 10,000-char cap
- [ ] 4.10 Offline notes survive reload and sync on reconnect
