# Visibility-engine hardening — reconcile emitted question set against the authored catalogue

## Overview

Harden `tests/questions.test.ts` so the FR-014 additive visibility engine (`src/lib/questions.ts`) is provably correct against the **independently-authored question catalogue** (`question-mapping-config.json` + `question-bank.json`) — never against the engine's own output. This is Test Plan **Phase 1** (`context/foundation/test-plan.md` §3), covering **risk #2** (engine emits the wrong question set → checklist silently misleads the buyer) and proxying **risk #3** (Smart Pruning, S-07): S-07 will re-run `selectVisibleQuestionIds` and diff, so it needs a trustworthy oracle first.

The change is confined to **one test file**. No `src/`, schema, or data changes. Per the `lessons.md` "Self-verify anything you can" rule (which cites this exact reconciliation), verification is fully agent-runnable via `npm test` — manual-verification surface is near-zero.

## Current State Analysis

The engine (`src/lib/questions.ts`) is a **pure, stateless, strictly-additive** filter. A group is visible iff every axis it names matches the config (AND across axes, OR within an axis's value array) AND its optional `requiresEquipmentFlag` is active (`isGroupVisible`, `questions.ts:197-208`). `selectVisibleGroups` is one `filter` + `sort((a,b)=>a.order-b.order)` (`:229-231`). "Additive" is **emergent** from N independent per-group predicates — there is no central merge to inspect, so the test must probe each axis independently _and_ in combination.

The catalogue is frozen data: `question-mapping-config.json` is a flat, enum-constrained predicate table (`visibleWhen` keys = the 4 axes, values = allowed-value arrays; optional `requiresEquipmentFlag`). The expected group set for any config is computable mechanically from this JSON **without running the engine** — a sound independent oracle (research §The Oracle).

The existing `tests/questions.test.ts` (274 lines) is happy-path-weighted in a fixable way:

- **All 3 fixtures pin `drive:"2wd"` + `bodyType:"sedan"` — both empty buckets** (`:30-32`). So `drive:"4wd"` (the only non-empty drive bucket) and the non-empty body types (`suv/van/pickup/convertible`) are **never asserted visible**.
- **The oracle is mixed.** Per-part totals are **hand-written magic-number literals** counted once against the markdown (`:107-118`); per-flag deltas derive from the **same JSON the engine reads** (`:204-209`) — catches traversal bugs, not a wrong catalogue.

Two real drift findings, both already true in live data:

- **`src/data/questions/*.json` is byte-identical to `idea/veriffica-questions-list/*.json` but nothing enforces it** — hand-copied. Zod-parse-at-load guards _shape_, not _equality with `idea/`_.
- **The catalogue grew 6→7 flag-gated groups** since the 2026-06-15 archive spec (`importedFromEU` now gates two groups). Concrete proof the contract evolves and must be pinned to the _catalogue_, not frozen prose.

## Desired End State

`tests/questions.test.ts` reconciles the engine against a catalogue-derived oracle across the full axis matrix and per-flag layering, and guards the two drift surfaces and two trust boundaries. `npm test` passes. A future hand-edit that makes the engine emit a missing/extra group, a drift between `src/data` and `idea/`, or a metadata/data divergence fails the suite loudly.

Verify: `npm test` green; deliberately mutating one group's `visibleWhen` in a `structuredClone` (negative check) makes the oracle assertion fail.

### Key Discoveries:

- The oracle predicate (research §The Oracle, derived from `question-mapping-config.json:5-32` + group `visibleWhen`):
  `expected(config,flags) = { g | (g.visibleWhen=={} OR ∀ axis k∈g.visibleWhen: config[k]∈g.visibleWhen[k]) AND (no requiresEquipmentFlag OR flags has it) }`, ordered by `g.order`.
- Axis values (`questions.ts:33-36`): `fuelType` {petrol,diesel,hybrid,electric}; `transmission` {manual,automatic}; `drive` {2wd(empty),4wd}; `bodyType` {sedan,hatchback,coupe,other (empty); suv,van,pickup,convertible (non-empty)}.
- 5 flags (`questions.ts:40-46`); **7** `requiresEquipmentFlag` groups (`question-mapping-config.json` lines 278,296,623,641,724,734,744); the two `importedFromEU` groups have `visibleWhen:{}` → gate purely on the flag.
- `relevantTogglesByFuel` assumes every flag-gated group depends only on `fuelType` — guarded by an existing invariant (`:177-184`); keep it.
- Test conventions (`tests/questions.test.ts:1-32`, sibling `tests/part1-config.test.ts:162-216`): pure synchronous unit test, no DB; catalogue via `@/data/questions/*.json`; `it.each` for matrices; `structuredClone` for negative tests; `toEqual` on sorted arrays/Sets. `part1-config.test.ts` is the cited template for exhaustive `it.each` tables.

## What We're NOT Doing

- No changes to `src/lib/questions.ts` or any engine code — this is a test-only hardening.
- No catalogue/data edits; no schema or migration changes.
- No route-guard test (the carried-forward "redirects when config invalid" gap, archive `plan.md:537-563`) — explicitly out of scope for this engine-reconciliation phase.
- No S-07 Smart Pruning tests (code not built yet — anti-pattern per test plan).
- No full 4096-case cartesian (axis × all 2^5 flag subsets) — additivity makes multi-flag combos the union of singletons, already proven; we drive 128 axis-configs + a focused per-flag pass instead.

## Implementation Approach

Add a single **catalogue-derived oracle helper** at the top of the test that reproduces the engine's predicate by reading `mappingJson` (groups) and `bankJson` (questions) directly — the independent oracle. Drive it across the **full 128 axis-config product** with empty flags (Phase 1), then a **focused per-relevant-flag pass** across diverse configs (Phase 2), then add **drift + trust-boundary guards** (Phase 3). Retain the existing magic-number literals as commented human-anchor canaries (belt-and-suspenders: derived catches a traversal bug, literals catch a wrong manual count).

## Phase 1: Catalogue-derived oracle + full axis matrix

### Overview

Introduce the independent oracle and reconcile the engine's emitted group set + order against it across every axis combination. This is where `4wd` and the non-empty body types finally get asserted visible.

### Changes Required:

#### 1. Catalogue-derived oracle helper

**File**: `tests/questions.test.ts`

**Intent**: Add a module-level `expectedGroupIds(config, flags)` helper that computes the expected visible group-id set **in `order`** purely from `mappingJson.questionGroups` — never calling the engine. This is the independent oracle the whole plan hangs on.

**Contract**: Signature `expectedGroupIds(config: VisibilityConfig, flags: ReadonlySet<RuntimeFlag>): string[]` returning ids sorted by `group.order`. Predicate per group: `(Object.keys(visibleWhen).length === 0 || every axis k in visibleWhen: config[k] != null && visibleWhen[k].includes(config[k])) && (!requiresEquipmentFlag || flags.has(requiresEquipmentFlag))`. Must read only `mappingJson` (and `bankJson` for the question-id variant) — asserting against engine output is the banned anti-pattern. A second helper `expectedQuestionIds(config, flags)` maps the group set through `bankJson.questions` by `groupId` for the `selectVisibleQuestionIds` comparison.

#### 2. Full axis-config matrix reconciliation

**File**: `tests/questions.test.ts`

**Intent**: Enumerate all 4×2×2×8 = 128 axis configs and assert, with `NO_FLAGS`, that `selectVisibleGroups(config).map(g=>g.id)` deep-equals `expectedGroupIds(config, NO_FLAGS)` — both already order-sorted, so order is reconciled too. Add the parallel `selectVisibleQuestionIds` vs `expectedQuestionIds` check.

**Contract**: Build the product from the four axis value arrays (lifted from the engine enums / catalogue schema, not hand-listed loosely). Drive via `it.each` over the 128 configs (the `part1-config.test.ts:162-216` table pattern). Assertion uses `toEqual` on the ordered id arrays. This single matrix subsumes the old empty-bucket no-op tests and the petrol↔diesel mirror, and is the first assertion that `4wd`/`suv`/`van`/`pickup`/`convertible` groups appear.

#### 3. Retain magic-number literals as commented anchors

**File**: `tests/questions.test.ts`

**Intent**: Keep the existing per-part total literals (petrol `{part2:86,part3:14,part4:18,part5:10}`, EV `{...}`, "20 base groups", turbo "+3", imported "+8") as a small set of human-readable canaries alongside the derived matrix, with a comment that they are a deliberate independent manual count (not engine-derived).

**Contract**: No new literals invented; preserve the existing `:39`, `:107-118` assertions and the `:22-25` header comment, updating the comment to state the relationship to the new derived oracle (literal = human canary, derived = matrix oracle).

### Success Criteria:

#### Automated Verification:

- [ ] Type checking + lint pass: `npm run lint`
- [ ] Unit suite passes: `npm test`
- [ ] The 128-config matrix runs and the engine equals `expectedGroupIds` for every case (visible in `npm test` output as 128 passing `it.each` rows)
- [ ] Negative check: temporarily mutating one group's `visibleWhen` in a `structuredClone` and feeding it to a local oracle makes the matrix assertion diverge (sanity-prove the oracle has teeth, then remove)

#### Manual Verification:

- [ ] None required — reconciliation is fully agent-runnable (`lessons.md` "Self-verify anything you can")

**Implementation Note**: After automated verification passes, no manual confirmation gate is needed for this phase (no UI/human-judgment surface); proceed to Phase 2.

---

## Phase 2: Flag layering reconciliation

### Overview

Prove the flag dimension layers correctly on top of the axis predicate across diverse configs — not just the 2wd/sedan fixtures — including the config-independent `importedFromEU` groups.

### Changes Required:

#### 1. Per-relevant-flag reconciliation across diverse configs

**File**: `tests/questions.test.ts`

**Intent**: For a small set of diverse fixtures spanning the matrix (at minimum: a `4wd` + non-empty-body config per fuel family, plus the existing PETROL/EV/HYBRID), assert that activating each _relevant_ flag makes `selectVisibleQuestionIds` equal `expectedQuestionIds(config, flags(thatFlag))` — exactly the gated group's questions added, purely additively, no axis-visible group lost.

**Contract**: Extend/replace the existing `it.each(RUNTIME_FLAGS)` Phase-4 block (`:197-219`) so its base config is no longer only HYBRID-at-2wd/sedan. Use the oracle (`expectedQuestionIds`) as the expectation rather than the same-JSON `expectedFor` helper, so a wrong catalogue is caught, not just a traversal bug. Assert `withFlag ⊇ base` (additive) and `withFlag.size === base.size + addedFromOracle.size`.

#### 2. Config-independent importedFromEU groups

**File**: `tests/questions.test.ts`

**Intent**: Assert the two `importedFromEU` groups (empty `visibleWhen:{}`) appear under _any_ axis config when the flag is active and disappear when it is not — proving they gate purely on the flag, config-independent.

**Contract**: Pick ≥2 structurally different configs (e.g. a petrol 4wd suv and an electric 2wd sedan); for each, `expectedGroupIds(config, flags("importedFromEU"))` minus `expectedGroupIds(config, NO_FLAGS)` must be the same two group ids, and the engine must agree. Reconcile the existing "+8 questions" literal (`:115-119`) against the oracle here.

#### 3. Cross-axis exclusion still holds under flags

**File**: `tests/questions.test.ts`

**Intent**: Keep/strengthen the EV cross-case (`:95-100`): activating turbo/compressor on an electric config adds nothing, because the fuel axis already excludes those groups — the flag cannot resurrect an axis-excluded group.

**Contract**: Assert via the oracle that for an electric config, `expectedQuestionIds(EV, flags("turboEquipped","mechanicalCompressorEquipped"))` equals `expectedQuestionIds(EV, NO_FLAGS)`, and the engine matches.

### Success Criteria:

#### Automated Verification:

- [ ] Unit suite passes: `npm test`
- [ ] Per-flag pass uses the catalogue oracle (`expectedQuestionIds`), not the same-JSON `expectedFor`, as its expectation
- [ ] `importedFromEU` config-independence asserted on ≥2 structurally different configs
- [ ] EV cross-axis exclusion under flags still green

#### Manual Verification:

- [ ] None required — fully agent-runnable

**Implementation Note**: After automated verification passes, proceed to Phase 3.

---

## Phase 3: Drift & trust-boundary guards

### Overview

Lock the two drift surfaces (hand-copy from `idea/`, descriptive-metadata vs data) and document the two trust boundaries (catalogue parse, garbage config).

### Changes Required:

#### 1. `src/data` ↔ `idea/` byte/deep-equality drift guard

**File**: `tests/questions.test.ts`

**Intent**: Assert the runtime catalogue copies equal their authored originals so a hand-copy drift fails loudly — the exact missing/extra-group surface risk #2 targets.

**Contract**: Import both `idea/veriffica-questions-list/question-mapping-config.json` and `question-bank.json` and assert `toEqual` against the `@/data/questions/*` copies — one assertion per file. Confirm the `idea/` JSON paths import cleanly under the test's module resolution (they are plain JSON; add a path/alias note if the import needs a relative path rather than the `@/` alias, which maps to `src/`).

#### 2. Descriptive-metadata cross-check

**File**: `tests/questions.test.ts`

**Intent**: Assert `visibilityModel.emptyBuckets` and `formula` actually match the groups' real `visibleWhen` coverage — catching metadata the engine ignores but humans trust when reading the catalogue.

**Contract**: For each axis value listed in `emptyBuckets` (`drive:["2wd"]`, `bodyType:["sedan","hatchback","coupe","other"]`), assert no group's `visibleWhen[axis]` includes that value (i.e. declared-empty buckets really are empty). Assert `formula` order `["base","fuelType","transmission","drive","bodyType"]` covers exactly the set of axes any group actually references (plus `base` for `visibleWhen:{}`).

#### 3. Garbage-config robustness

**File**: `tests/questions.test.ts`

**Intent**: Document the trust boundary that the engine does not runtime-validate config enums (it trusts the DB CHECK) — an out-of-enum value degrades gracefully to base groups, never throws.

**Contract**: Assert `selectVisibleGroups({ fuelType: "lpg" } as VisibilityConfig, NO_FLAGS)` returns exactly the base groups (those with `visibleWhen:{}` and no flag) and does not throw. A short comment names this as the documented DB-CHECK trust boundary.

#### 4. Preserve existing parse drift guard

**File**: `tests/questions.test.ts`

**Intent**: Keep the existing `parseCatalogue` malformed-catalogue tests (`:255-273`) — they guard shape; the new `idea/` equality guard guards copy-fidelity. Both stay.

**Contract**: No change to the three existing `parseCatalogue` assertions beyond co-locating them with the new drift block if helpful.

### Success Criteria:

#### Automated Verification:

- [ ] Unit suite passes: `npm test`
- [ ] `idea/` ↔ `src/data` `toEqual` guard green for both JSON files
- [ ] Metadata cross-check confirms declared-empty buckets are truly empty and `formula` matches referenced axes
- [ ] Garbage-config (`{fuelType:"lpg"}`) returns base groups only, no throw
- [ ] Lint + typecheck pass: `npm run lint`

#### Manual Verification:

- [ ] None required — fully agent-runnable

**Implementation Note**: After automated verification passes, the phase is complete. Update `change.md` status and the test-plan Phase 1 status.

---

## Testing Strategy

### Unit Tests:

- The whole change _is_ the unit test. The catalogue-derived oracle (`expectedGroupIds`/`expectedQuestionIds`) reconciles the engine across 128 axis-configs + a per-relevant-flag pass.
- Key edge cases: `4wd`, non-empty body types (`suv/van/pickup/convertible`), config-independent `importedFromEU` groups, EV cross-axis exclusion under flags, garbage config, declared-empty-bucket metadata.

### Integration Tests:

- None — the engine is DB-free and pure (`tests/helpers/supabase.ts` is deliberately not used).

### Manual Testing Steps:

1. None. Per `lessons.md`, this reconciliation is agent-runnable; the only gate is `npm test`.

## Performance Considerations

128 axis-configs × a handful of assertions each, plus a focused flag pass, is trivially fast for a pure synchronous function — well under the existing suite's runtime. The deliberately-avoided 4096-case product would add noise without signal (additivity proven).

## Migration Notes

None — test-only change, no data or schema impact.

## References

- Related research: `context/changes/testing-visibility-engine-hardening/research.md`
- Test plan spec: `context/foundation/test-plan.md` §2 (risk #2/#3), §3 Phase 1, Risk Response Guidance
- Engine: `src/lib/questions.ts:197-208` (`isGroupVisible`), `:229-231` (`selectVisibleGroups`), `:237-242` (`selectVisibleQuestionIds`)
- Existing test: `tests/questions.test.ts` (the file under hardening)
- Template for exhaustive `it.each` matrices: `tests/part1-config.test.ts:162-216`
- Catalogue: `src/data/questions/question-mapping-config.json:5-32`; flag-gated groups at lines 278,296,623,641,724,734,744
- Lesson: `context/foundation/lessons.md` "Self-verify anything you can"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Catalogue-derived oracle + full axis matrix

#### Automated

- [ ] 1.1 Type checking + lint pass: `npm run lint`
- [ ] 1.2 Unit suite passes: `npm test`
- [ ] 1.3 128-config matrix runs; engine equals `expectedGroupIds` for every case
- [ ] 1.4 Negative check: mutated `visibleWhen` makes the matrix assertion diverge (then removed)

### Phase 2: Flag layering reconciliation

#### Automated

- [ ] 2.1 Unit suite passes: `npm test`
- [ ] 2.2 Per-flag pass uses the catalogue oracle (`expectedQuestionIds`), not same-JSON `expectedFor`
- [ ] 2.3 `importedFromEU` config-independence asserted on ≥2 structurally different configs
- [ ] 2.4 EV cross-axis exclusion under flags still green

### Phase 3: Drift & trust-boundary guards

#### Automated

- [ ] 3.1 Unit suite passes: `npm test`
- [ ] 3.2 `idea/` ↔ `src/data` `toEqual` guard green for both JSON files
- [ ] 3.3 Metadata cross-check: declared-empty buckets truly empty; `formula` matches referenced axes
- [ ] 3.4 Garbage-config returns base groups only, no throw
- [ ] 3.5 Lint + typecheck pass: `npm run lint`
