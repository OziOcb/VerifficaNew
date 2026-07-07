# Fix Lost Answers on Fast Clicking (Bug 1) Implementation Plan

## Overview

Rapidly tapping Yes/No/Don't-know through a Part (Parts 2–5) drops some answers. The
root cause (per `frame.md`, HIGH confidence) is a stale-read overwrite: both writers of
the `answers` jsonb build the next map from an `answers` value derived from an async
`useLiveQuery` that lags fast input, and `saveInspection` then **overwrites the entire
`answers` column**. A fast second tap persists a stale map that drops the previously-saved
key. This plan fixes the race at the single persistence choke point (`saveInspection`) with
a jsonb key-level merge, adds a regression test, and adds an in-flight tap guard as UX
defense-in-depth.

Scope: **Bug 1 only.** Bug 2 (mobile account-icon dropdown) is HELD pending a real-device
reproduction — see `frame.md` (its body-lock hypothesis was refuted by reproduction).

## Current State Analysis

- **`saveInspection` (`src/lib/sync.ts:109-151`)** read-merges at the **column** level: a
  sparse save overlays only the caller-supplied data fields onto the stored row. But for the
  jsonb `answers` field, "overlay" means **replace the whole object** (`sync.ts:122-129`,
  `merged = f in input ? input[f] : existing?.[f]`). There is no key-level merge.
- **Writer 1 — `QuestionCards.handleAnswer` (`src/components/inspections/QuestionCards.tsx:162-176`)**:
  builds `nextMap = { ...answers, [card.id]: answer }` where `answers` comes from
  `useLiveQuery(() => db.inspections.get(id))` (`:96-97`), then `saveInspection({ id, answers: nextMap })`
  and advances the card on resolve. The live query updates on a later tick, so a fast second
  tap reads a pre-write `answers` and its `nextMap` omits the just-saved key.
- **Writer 2 — `SummaryScreen.handleEditAnswer` (`src/components/inspections/SummaryScreen.tsx:292-303`)**:
  the S-06 inline edit-from-summary. Same shape — `saveInspection({ id, answers: { ...answers, [cardId]: value } })`
  from a live-row-derived `answers`. Its own comment notes it is "identical to
  QuestionCards.handleAnswer." Confirms the fix belongs at the shared boundary, not per-component.
- **Domain invariant**: there is no "unanswer" — a re-tap is a no-op (`SummaryScreen.tsx:293`
  guards it; `QuestionCards` only ever sets a value). So union-merging answer keys can never
  wrongly drop or resurrect a key.
- **Only `answers` is jsonb**: `JSONB_FIELDS = ["answers"]` (`sync.ts:78`). The merge change
  touches exactly one field's handling.
- **Test harness exists**: `tests/sync.test.ts` exercises `saveInspection` read-merge under
  `fake-indexeddb/auto` (`:3`), including an "answers-only save preserves config" case
  (`:88-98`). A stale-save regression test drops straight in.

## Desired End State

Answering fast through a Part persists every answer. Concretely: two sequential
`saveInspection` calls carrying answers for different questions both survive, even when the
second call's map does not include the first key (the stale-read case). Both the card deck
and the summary inline-edit inherit the fix because they share `saveInspection`. A regression
test in `tests/sync.test.ts` fails on the old whole-column overwrite and passes on the merge.
Rapidly double-tapping in the card deck no longer advances past a card before its save
resolves.

### Key Discoveries:

- Single choke point: both answer writers go through `saveInspection` (`sync.ts:109`).
- Whole-column overwrite is the defect: `sync.ts:122-129`.
- Union-merge is safe due to the no-unanswer domain invariant (`SummaryScreen.tsx:293`).
- Regression-test harness ready: `tests/sync.test.ts:3,88-98`.

## What We're NOT Doing

- **Not** touching Bug 2 (mobile account-icon dropdown) — HELD pending real-device repro.
- **Not** visibly disabling/dimming the answer buttons — the decision is an invisible
  in-flight guard (local Dexie writes are ~instant; a visible disabled flash reads as a glitch).
- **Not** changing `useLiveQuery` usage, the SSR-snapshot fallback, or the resume-index logic.
- **Not** changing the outbox/sync protocol, the sync endpoint, or the DB schema.
- **Not** adding an e2e rapid-tap Playwright test (unit test pins the mechanism; e2e timing is flaky).
- **Not** adding a guard to `SummaryScreen` (its edit doesn't advance and no-ops re-taps; the
  merge fix already covers its data-loss path).

## Implementation Approach

Fix at the persistence boundary first (Phase 1) so correctness is independent of any
component's render timing, and cover it with a regression test. Then add the UX guard in the
card deck (Phase 2) so the fast-tap gesture also feels right. Phase 1 is the load-bearing
correctness change and can ship on its own.

## Phase 1: Persistence-boundary jsonb key-merge + regression test

### Overview

Make `saveInspection` merge jsonb fields by key (`{ ...existing, ...input }`) instead of
replacing them, inside the existing `rw` transaction, and prove it with a stale-save test.

### Changes Required:

#### 1. jsonb key-level merge in `saveInspection`

**File**: `src/lib/sync.ts`

**Intent**: For a jsonb field present in the caller's input, merge its keys over the stored
row's existing object rather than replacing the whole object, so a sparse/stale `answers`
save unions with previously-persisted answers and cannot drop keys. Non-jsonb (scalar)
fields keep their current whole-value overlay. First-write and "field omitted" behavior are
unchanged (omitted jsonb still defaults to `{}`).

**Contract**: In the `DATA_FIELDS.map` overlay (`sync.ts:122-129`), branch on
`jsonbFields.includes(f)`: when the field is jsonb **and** present in `input`, produce
`{ ...(existing?.[f] ?? {}), ...input[f] }`; otherwise keep the current
`f in input ? input[f] : existing?.[f]` behavior. The merge reads `existing` from the same
`rw` transaction that already wraps the write (`sync.ts:112`), so it stays atomic. The
resulting merged row remains the outbox payload (the upsert still carries a complete
`answers` map). Merge is top-level-keys only (question-id → answer), consistent with the sync
endpoint excluding `answers` from deep key-casing.

```ts
// inside DATA_FIELDS.map((f) => { ... })
const isJsonb = jsonbFields.includes(f);
if (isJsonb && f in input) {
  return [f, { ...((existing?.[f] as object) ?? {}), ...(input[f] as object) }];
}
const merged = f in input ? input[f] : existing?.[f];
return [f, merged ?? (isJsonb ? {} : null)];
```

#### 2. Regression test: a stale answers-save must not drop a prior key

**File**: `tests/sync.test.ts`

**Intent**: Lock the exact bug — model the race where the second save carries a map that
omits the first key (what a lagging `useLiveQuery` produces) and assert both keys survive.

**Contract**: New `it(...)` in the existing `describe("saveInspection read-merge …")`. Save
`{ id, answers: { A: "yes" } }`, then `{ id, answers: { B: "no" } }` (deliberately omitting
A, simulating the stale snapshot). Assert `db.inspections.get(id)` has `answers` equal to
`{ A: "yes", B: "no" }`, and the last outbox op's `payload.answers` equals the same. Use
real catalogue-style question-id keys as in the existing `:91` case. This test fails on the
pre-merge whole-column overwrite (would yield `{ B: "no" }`) and passes after Change #1.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint` (runs `astro sync` + type-checked ESLint)
- New + existing sync tests pass: `npm test` (targeted: `npx vitest run tests/sync.test.ts`)
- The new stale-save test fails when Change #1 is reverted (confirms it pins the bug)

#### Manual Verification:

- None required for this phase — the unit test fully exercises the boundary. (Rapid-tap UI
  behavior is verified in Phase 2.)

**Implementation Note**: After completing this phase and all automated verification passes,
pause for the human to confirm before proceeding to Phase 2.

---

## Phase 2: In-flight tap guard in the card deck

### Overview

Prevent a second answer tap from firing while a save is pending, so fast tapping can't
advance past a card before its write resolves. Invisible guard (no disabled styling).

### Changes Required:

#### 1. Ignore taps while a save is in flight

**File**: `src/components/inspections/QuestionCards.tsx`

**Intent**: Guard `handleAnswer` so that once a tap starts a save, further taps are ignored
until that save resolves or rejects and the deck has advanced — eliminating fast
double-advance/flicker. No visible disabled state (local writes are ~instant; a flash reads
as a glitch), so use a ref rather than render state.

**Contract**: Add a `useRef<boolean>` in-flight flag. At the top of `handleAnswer`
(`:162`), return early if the flag is set; otherwise set it, and clear it in **both**
settled branches of the existing `saveInspection(...).then(onFulfilled, onRejected)`
(`:166-175`) — success (after `setNavIndex`) and failure (alongside `setSaveError(true)`).
The existing advance-on-resolve and inline `saveError` behavior are otherwise unchanged. Keep
the pattern react-compiler-safe (a ref read/write in an event handler is fine; do not add the
flag to a dependency array).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Full unit suite passes: `npm test`

#### Manual Verification:

- On `npm run dev`, open an inspection → a Part with several questions; tap
  Yes/No/Don't-know as fast as possible to the end of the Part. Reload the page (or reopen
  the Part) and confirm **every** question retains the answer tapped — none blank.
- Repeat the fast run in the summary inline-edit (S-06) as a spot check that the shared merge
  fix holds there too.
- Confirm normal (non-fast) answering, Back, and Next still behave exactly as before (no
  stuck buttons, no missed advance).

**Implementation Note**: After automated verification passes, pause for the human to confirm
the manual rapid-tap check before considering the change complete.

---

## Testing Strategy

### Unit Tests:

- New `tests/sync.test.ts` case: stale answers-save unions rather than overwrites (the bug).
- Existing `tests/sync.test.ts` cases must stay green (scalar read-merge, first-write `{}`
  default, answers-only preserves config) — confirms the jsonb branch didn't regress scalars.

### Integration / E2E Tests:

- None added (per decision). The unit test pins the mechanism; e2e rapid-tap timing is flaky.

### Manual Testing Steps:

1. Fast-tap through a full Part; reload; verify no answer is blank.
2. Fast-edit answers in the S-06 summary modal; verify none are lost.
3. Verify normal answering / Back / Next are unchanged.

## Performance Considerations

Negligible. The merge adds one object spread over the already-read `existing` row inside the
existing transaction. `answers` holds at most a few dozen keys.

## Migration Notes

None. No schema change; no data migration. Existing rows are unaffected (merge only changes
how future writes combine with stored `answers`).

## References

- Frame brief: `context/changes/bugfix-answer-save-and-account-nav/frame.md`
- Defect: `src/lib/sync.ts:122-129`
- Writers: `src/components/inspections/QuestionCards.tsx:162-176`,
  `src/components/inspections/SummaryScreen.tsx:292-303`
- Live-row read (lag source): `src/components/inspections/QuestionCards.tsx:96-97`
- Test harness: `tests/sync.test.ts:3,88-98`
- Related lesson: read-merge / no-data-loss guardrail in `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Persistence-boundary jsonb key-merge + regression test

#### Automated

- [ ] 1.1 Type checking passes: `npm run lint`
- [ ] 1.2 New + existing sync tests pass: `npx vitest run tests/sync.test.ts` / `npm test`
- [ ] 1.3 New stale-save test fails when the merge is reverted (confirms it pins the bug)

### Phase 2: In-flight tap guard in the card deck

#### Automated

- [ ] 2.1 Type checking passes: `npm run lint`
- [ ] 2.2 Full unit suite passes: `npm test`

#### Manual

- [ ] 2.3 Fast-tap through a Part, reload, every answer retained (none blank)
- [ ] 2.4 Fast-edit in S-06 summary modal loses no answers
- [ ] 2.5 Normal answering / Back / Next unchanged (no stuck buttons, no missed advance)
