---
date: 2026-06-22T11:16:24+0100
researcher: OziOcb
git_commit: a5c7355e3efdec4de392e05bc78dcd9bdd221f99
branch: feat/testing-visibility-engine-hardening
repository: veriffica-z-ai-2
topic: "Visibility-engine hardening — reconcile emitted question set against the authored catalogue (Test Plan Phase 1, risk #2, proxies #3)"
tags: [research, codebase, visibility-engine, questions, catalogue, testing, risk-2]
status: complete
last_updated: 2026-06-22
last_updated_by: OziOcb
---

# Research: Visibility-engine hardening — reconcile emitted question set against the authored catalogue

**Date**: 2026-06-22T11:16:24+0100
**Researcher**: OziOcb
**Git Commit**: a5c7355e3efdec4de392e05bc78dcd9bdd221f99
**Branch**: feat/testing-visibility-engine-hardening
**Repository**: veriffica-z-ai-2

## Research Question

Phase 1 of `context/foundation/test-plan.md` ("Visibility-engine hardening"), covering risk **#2** (engine emits the wrong question set for a config — missing/extra groups — silently misleading the buyer) and proxying risk **#3** (Smart Pruning, S-07 not yet built). The test plan's Risk Response Guidance demands the research ground three things:

1. The additive visibility model's **source-of-truth catalogue**.
2. How the engine **computes the emitted question set** from a config.
3. How **runtime flags layer** onto the config axes.

And it pre-declares the anti-pattern to avoid: the **oracle problem** — asserting against the engine's _own output_ instead of the independently-authored catalogue.

## Summary

The visibility engine (`src/lib/questions.ts`) is a **pure, stateless, strictly-additive** filter: `visible set = union of every group whose `visibleWhen`axis-predicate matches the config AND whose optional`requiresEquipmentFlag` is active`. There is no subtraction, precedence, or bucket-union code — additivity is _emergent_ from evaluating independent per-group predicates. The catalogue is frozen data (`src/data/questions/*.json`), Zod-parsed and `deepFreeze`d at module load.

**The oracle is buildable and sound.** `question-mapping-config.json` is a flat, enum-constrained predicate table (`visibleWhen` keys = the 4 axes, values = allowed-value arrays with OR-semantics; optional `requiresEquipmentFlag`). The expected group set for any config can be computed mechanically from this JSON **without running the engine** — see the predicate in [Detailed Findings → The Oracle](#the-oracle-how-to-derive-expected-groups-without-the-engine). The original human source is the prose `idea/veriffica-questions-list/list-of-questions.md`; the JSON self-identifies as derived from it (`"sourceFile": ...`).

**Two real findings the test must lock, both already true in the live data:**

- **Drift surface is unenforced.** `src/data/questions/*.json` are currently byte-identical to `idea/veriffica-questions-list/*.json` (verified md5-equal), but nothing in the repo enforces this — they are maintained by hand-copy. A cheap drift guard is warranted.
- **The catalogue already grew past the archive's spec.** The 2026-06-15 archive plan asserted "exactly **6**" flag-gated groups; the live catalogue has **7** (`importedFromEU` is now on two groups). This is precisely the silent missing/extra-group drift risk #2 is about — and proof the engine's behavior must be pinned to the _catalogue_, not to prior prose.

**The existing test (`tests/questions.test.ts`) is happy-path-weighted in a specific, fixable way:** all three fixtures pin `drive:"2wd"` + `bodyType:"sedan"` — _both empty buckets_ — so the **only non-empty drive bucket (`4wd`)** and the **non-empty body types (`suv`, `van`, `pickup`, `convertible`)** are never asserted visible. And its oracle is mixed: per-part totals are **hand-written magic-number literals** (a one-time manual count against the markdown), while the per-flag deltas derive from the **same JSON the engine reads** (catches traversal bugs, not a wrong catalogue). The hardening work is: (a) drive the full axis×flag matrix, (b) replace/supplement magic numbers with a catalogue-derived oracle, (c) cover `4wd` and non-empty body types.

## Detailed Findings

### The visibility engine — `src/lib/questions.ts`

**Entry points** (all pure, all `(config, flags) → derived set`):

- `selectVisibleGroups(config, flags): QuestionGroup[]` — `src/lib/questions.ts:229-231`. The whole merge is one `Array.filter` + `sort((a,b) => a.order - b.order)`.
- `selectVisibleQuestionIds(config, flags): Set<string>` — `src/lib/questions.ts:237-242`, documented in-code as **"the single source of truth for visibility"**. S-07 Smart Pruning is designed to call this same function and diff (per archive `plan.md:162-163`).
- `visibleCountsByPart(config, flags): Record<PartId, number>` — `:245-250` (per-Part nav counts).
- `relevantFlags(config)` — `:276-285`; `relevantToggles` / `relevantTogglesByFuel` — `:298-313`; `sessionCounts(config)` — `:322-335`.
- Adapters from a DB row: `configFromInspection(row)` — `:219-226` (`null` → `undefined`); `activeFlagsFromInspection(row)` — `:262-268`.

**Inputs:** `config: VisibilityConfig = Partial<Pick<Part1Config, "fuelType"|"transmission"|"drive"|"bodyType">>` (`:122`) — nullable-tolerant. `flags: ReadonlySet<RuntimeFlag>`.

**The matching predicate** — `isGroupVisible` (`src/lib/questions.ts:197-208`):

```ts
for (const [axis, allowed] of Object.entries(group.visibleWhen)) {
  const v = config[axis as keyof VisibilityConfig];
  if (!v || !(allowed as string[]).includes(v)) return false; // :204 — AND across axes, OR within an axis
}
if (group.requiresEquipmentFlag && !activeFlags.has(group.requiresEquipmentFlag)) return false; // :206
return true;
```

Semantics: a group is visible **iff every axis it names matches** (AND across axes; OR within an axis's value array) **AND its flag, if any, is active**. A group with `visibleWhen: {}` has no axis to fail → **always-visible base group** (subject only to a flag gate if present).

**Additive, not subtractive** — confirmed in code (`:230` is pure `filter`) and declared in data (`visibilityModel.type: "additive-buckets"`, `question-mapping-config.json:6`). The `formula` order `["base","fuelType","transmission","drive","bodyType"]` and `emptyBuckets` (`:7-24`) are schema-validated **descriptive metadata only** — the runtime never reads them for matching. They can drift from the actual `visibleWhen` data with no runtime consequence (a candidate cross-check for the test).

### Config axes and allowed values

Zod enums in the engine (`src/lib/questions.ts:33-36`), mirrored in `part1-config.ts:38-41`, the DB CHECK constraints, and the catalogue schema (`question-mapping-config.schema.json:39-63`). **These three must stay byte-identical — the match _is_ the join, there is no mapping layer** (archive `research.md:130-138`):

| Axis           | Allowed values                                                                | Non-empty?                                                                        |
| -------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `fuelType`     | `petrol`, `diesel`, `hybrid`, `electric`                                      | all non-empty                                                                     |
| `transmission` | `manual`, `automatic`                                                         | —                                                                                 |
| `drive`        | `2wd`, `4wd`                                                                  | **`2wd` is empty; only `4wd` has groups**                                         |
| `bodyType`     | `sedan`, `hatchback`, `suv`, `coupe`, `convertible`, `van`, `pickup`, `other` | **empty: `sedan/hatchback/coupe/other`; non-empty: `suv/van/pickup/convertible`** |

`emptyBuckets` (`question-mapping-config.json:14-24`) declares `drive:["2wd"]` and `bodyType:["sedan","hatchback","coupe","other"]` as intentionally zero-group. **Parts** are `part2`–`part5` (`:32`); Part 1 is the config itself, not inspected.

### Runtime flags and how they layer

Five flags (engine enum `:40-46`; data `question-mapping-config.json:25-31`): `chargingPortEquipped`, `evBatteryDocsAvailable`, `turboEquipped`, `mechanicalCompressorEquipped`, `importedFromEU`.

- **A flag is a second AND-gate on top of the axis predicate, and is purely additive — it can only ADD groups, never remove one.** A flag-gated group stays hidden unless its `visibleWhen` matches AND the flag is active.
- **7 groups carry `requiresEquipmentFlag`** (verified in live data at `question-mapping-config.json` lines 278, 296, 623, 641, 724, 734, 744): `chargingPortEquipped`(1), `mechanicalCompressorEquipped`(2), `turboEquipped`(1), `evBatteryDocsAvailable`(1), `importedFromEU`(**2**). ⚠️ The archive plan said "6" — the catalogue has since grown to 7. The two `importedFromEU` groups (`:727-745`) have empty `visibleWhen:{}` → they gate **purely** on the flag, config-independent.
- **Casing bridge — the headline gotcha.** Flags activate via the explicit `FLAG_COLUMN_MAP` (`:170-176`), NOT `row[flagName]`. Reason (`:164-169`): DB column `imported_from_eu` camelCases to `importedFromEu`, but the canonical flag is `importedFromEU` (caps EU) — they don't match. The other 4 round-trip "only by luck of having no acronym." `activeFlagsFromInspection` activates a flag only when its column is **exactly `true`** (`:265`); `null`/`false`/missing are inert. This is guarded by `tests/questions.test.ts:129-160`.
- `relevantTogglesByFuel` (`:298-313`) **assumes every flag-gated group depends only on `fuelType`** — not enforced by the engine, only by a unit-test invariant (`tests/questions.test.ts:177-184`). A future group gating a flag on `drive`/`bodyType` would make this helper silently misreport.

### The catalogue — source of truth and oracle

**Lineage:** prose `idea/veriffica-questions-list/list-of-questions.md` = human origin (conditions as headings, e.g. `### Fuel: Petrol / Diesel / Hybrid`). `question-mapping-config.json` = the **machine-readable source of truth for visibility** — it restates every heading as an explicit `visibleWhen` predicate. Both JSON files declare `"sourceFile": ".ai/veriffica-questions-list/list-of-questions.md"` (mapping `:4`, bank `:4`).

**Shape:** `questionGroups[]` entries carry `id` (`^g_.+$`), `part`, `order` (int ×10), `section`, `subsection` (nullable), `dependsOnFields` (metadata only — runtime reads `visibleWhen`, not this), `visibleWhen`, optional `requiresEquipmentFlag`. Questions live in `question-bank.json` (`id` `^q_.+$`, `groupId` FK, `label`, `order`, optional `explanationRef`); visibility is inherited entirely from the group via `groupId`.

**Counts (verified live):** **54 groups**, **206 questions**, full 1:1 coverage (every group referenced, no orphans, no dangling `groupId`).

**Drift status:** `src/data/questions/{question-mapping-config,question-bank}.json` are **byte-identical** to the `idea/` copies (md5 `bf4e2cdc…` and `658b9117…` respectively; `diff` exit 0). Schemas (`*.schema.json`) live **only** under `idea/`. Nothing enforces the copy — it is hand-maintained, so future drift is possible. The engine Zod-parses + freezes the `src/data` copy at module load (`:158`), which guards _shape_ but not _equality with `idea/`_.

#### The Oracle: how to derive "expected groups" without the engine

Computable purely from `question-mapping-config.json` (no engine code):

```
expected(config, flags) = { g ∈ questionGroups |
    (g.visibleWhen == {}  OR  ∀ axis k ∈ g.visibleWhen: config[k] ∈ g.visibleWhen[k])
    AND (g.requiresEquipmentFlag absent  OR  flags[g.requiresEquipmentFlag] === true) }
ordered by g.order
```

This reproduces the additive-bucket union declared in `visibilityModel.formula`. Because it is a flat, enum-constrained predicate table, it is a **sound independent oracle** — it consumes raw authored data, never engine output. The test should assert the engine's emitted group-id set (and order) equals `expected(...)` across the **cartesian product of axis values × flag subsets**.

### Existing test audit — `tests/questions.test.ts` (274 lines, 11 describe blocks)

**What it covers well:** base groups (20 at empty config, `:34-54`), single-axis petrol↔diesel mirror (`:56-72`), empty-bucket no-ops (`:74-82`), single-flag deltas (turbo +3, `:84-101`), the flag-casing symmetry guard (`:129-160`), `relevantFlags`/`relevantTogglesByFuel` (`:162-195`), the per-flag `it.each` delta loop (`:197-220`), `sessionCounts ⇄ countsForFlags` equivalence (`:222-253`), and a catalogue drift guard that asserts malformed JSON throws at `parseCatalogue` (`:255-273`).

**Why it's happy-path-weighted (the gaps to close):**

- Only **3 fixtures** (`:30-32`): `PETROL`, `EV`, `HYBRID` — **all pin `drive:"2wd"` + `bodyType:"sedan"` (both empty buckets)**. So:
  - **`drive:"4wd"`** (the only non-empty drive bucket) is **never** asserted visible.
  - Non-empty body types (`suv`, `van`, `pickup`, `convertible`) are **never** exercised; body/drive appear only in their no-op form.
  - `diesel` is a one-line inline spot-check (`:59`), never a full fixture.
  - **Multi-axis × multi-flag combinations** beyond single-flag additive deltas are untested.
  - Runtime robustness to a **garbage config enum value** passed to `selectVisibleGroups` is untested (the drift guard catches a malformed _catalogue_, not a malformed _config_).

**Oracle status (mixed — the core finding):**

- **Magic-number literals** (no independent oracle): per-part totals `{part2:86,part3:14,part4:18,part5:10}` petrol / `{part2:72,part3:8,part4:21,part5:10}` EV (`:107-108`), "20 base groups" (`:39`), turbo "+3" (`:92`), imported "+8" (`:118`). Header comment (`:22-25`) says these were counted once against the markdown and "lock the predicate behavior." If the original manual count was wrong, the test enshrines the wrong number.
- **Catalogue-derived** (engine-independent within the test): the Phase-4 `expectedFor(flag)` helper (`:204-209`) filters `bankJson`+`mappingJson` directly — but from the **same JSON the engine reads**, so it catches predicate/traversal bugs, not a wrong catalogue.
- **Self-consistency**: `sessionCounts ⇄ visibleCountsByPart` (`:222-253`) only proves two code paths agree.

**Conventions to follow** (`:1-32`): pure synchronous unit test, no DB/Supabase; catalogue imported via `@/data/questions/*.json`; module-level `VisibilityConfig` fixtures + `NO_FLAGS`/`flags(...)` Set helpers; `it.each` for matrices; `structuredClone` to mutate a copy for negative tests; `toEqual` on sorted arrays / Sets. Sibling `tests/part1-config.test.ts` is the cited template and is exhaustive on boundaries via `it.each` accept/reject tables (`:162-216`) — the model for full-matrix coverage here. `tests/helpers/supabase.ts` is **not** used (engine tests are DB-free).

## Code References

- `src/lib/questions.ts:197-208` — `isGroupVisible`: the AND-across-axes + flag-gate predicate (the behavior under test).
- `src/lib/questions.ts:229-231` — `selectVisibleGroups`: filter + sort-by-order (the additive merge).
- `src/lib/questions.ts:237-242` — `selectVisibleQuestionIds`: "single source of truth for visibility"; S-07's diff target.
- `src/lib/questions.ts:33-36` — the four axis enums (allowed values).
- `src/lib/questions.ts:40-46`, `:161` — runtime flag enum + `RUNTIME_FLAGS`.
- `src/lib/questions.ts:164-176`, `:262-268` — `FLAG_COLUMN_MAP` + `activeFlagsFromInspection` (the `importedFromEU` casing bridge).
- `src/lib/questions.ts:138`, `:158` — `parseCatalogue` (exported for tests) + module-load freeze (drift guard for shape).
- `src/data/questions/question-mapping-config.json:5-32` — `visibilityModel` (type/formula/emptyBuckets/runtimeFlags).
- `src/data/questions/question-mapping-config.json` lines 278, 296, 623, 641, 724, 734, 744 — the **7** `requiresEquipmentFlag` groups (two are `importedFromEU`).
- `idea/veriffica-questions-list/question-mapping-config.schema.json:39-77` — authoritative axis/value/flag enums (`$defs`).
- `idea/veriffica-questions-list/list-of-questions.md:39-54` — prose declaration of the additive model + empty buckets.
- `tests/questions.test.ts:30-32` — the 3 happy-path fixtures (all 2wd/sedan).
- `tests/questions.test.ts:22-25`, `:107-118` — magic-number oracle comment + the locked count literals.
- `tests/questions.test.ts:204-209` — `expectedFor`: catalogue-derived (but same-JSON) oracle.
- `tests/part1-config.test.ts:162-216` — exhaustive `it.each` boundary-table template.

## Architecture Insights

- **Rules-as-data + thin pure evaluator** is the house style (shared with `part1-config.ts`). The visibility set is a _derived projection_ of `(frozen catalogue × persisted config × persisted flags)` — never persisted, nothing to migrate (archive `plan.md:118-121`). This is exactly why a pure-unit reconciliation test is the right (cheapest) layer for risk #2.
- **"Additive" is emergent, not coded** — there is no bucket-union logic, just N independent predicates filtered. A test should therefore probe _each axis independently_ and _combinations_, since there's no central merge to inspect.
- **The catalogue is the contract; the engine is a faithful evaluator of it.** The correct oracle is the authored mapping-config, derived independently — never the engine's own output (the explicit anti-pattern in the test plan). The catalogue-already-grew-to-7-flag-groups finding is concrete proof the contract evolves and must be pinned by a _catalogue-derived_ expectation, not frozen prose constants.
- **Three artifacts must stay byte-identical** (no mapping layer): engine axis enums ↔ DB CHECK constraints ↔ catalogue-schema enums. A divergence is a silent missing/extra-group bug — in scope for risk #2's "must challenge."

## Historical Context (from prior changes)

From `context/archive/2026-06-15-personalized-question-engine/`:

- `research.md:159-182` — engine designed as a ~15-line pure `isGroupVisible`; additivity emergent from `visibleWhen:{}` base groups; empty buckets are pure data (no special case). This is _why_ the fixtures use 2wd/sedan and why switching them is a no-op.
- `plan.md:162-163`, `plan-brief.md:36` — `selectVisibleQuestionIds` is the single visibility source of truth precisely so **S-07 Smart Pruning re-runs the same function and diffs**. Hardening this engine is the cheapest thing that de-risks #3 (the change.md rationale).
- `plan.md:135-156`, `research.md:382-386` — catalogue copied into `src/data/questions/`, Zod-parsed + frozen as a drift guard; schemas stay in `idea/` as source of truth; `idea/` is a planning area, not a runtime source.
- `plan.md:181-189` — the `importedFromEU` ↔ `importedFromEu` casing mismatch and the explicit-column-map fix; the other 4 flags round-trip "only by luck of having no acronym."
- `plan-brief.md:79-81`, `plan.md:441-454` — flag-relevance was an Open Risk (duplicating the catalogue's fuel-axis knowledge); resolved by deriving `relevantFlags` from the catalogue, with the `relevantTogglesByFuel` test invariant as the guard.
- `plan.md:537-563` + `reviews/impl-review.md` — three shipped divergences (always-on session hub; equipment toggles committed via Part 1 Save; client recompute = `base + Σ flag-deltas` via the unplanned `session-counts.ts`). Criteria 3.3 ("redirects when config invalid") stays checked but **no automated route-guard test was added** — a carried-forward gap, but **out of scope** for this engine-reconciliation phase.

## Related Research

- `context/archive/2026-06-15-personalized-question-engine/research.md` — the original engine-design research (this phase hardens what it built).
- `context/foundation/test-plan.md` §2 (risk #2/#3) and Risk Response Guidance — the frozen spec this phase executes.
- `context/foundation/lessons.md` — "Self-verify anything you can" lesson cites _this exact reconciliation_ as agent-runnable, not a manual spot-check.

## Open Questions

1. **Magic numbers vs. derived oracle.** Should the hardened test _replace_ the hand-written per-part total literals with fully catalogue-derived counts, or _keep both_ (literals as a human-readable canary + derived as the matrix oracle)? Keeping both catches a wrong manual count AND a traversal bug; deriving-only is cleaner but loses the human anchor. (Recommendation: derive the matrix oracle from the catalogue; keep a small number of literal sanity-anchors with a comment.)
2. **Drift guard scope.** Add a test asserting `src/data/questions/*.json` equals `idea/veriffica-questions-list/*.json`? Currently identical but unenforced. Cheap insurance against the hand-copy drifting. (Recommendation: yes — one `toEqual` per file.)
3. **`formula`/`emptyBuckets` metadata cross-check.** Worth asserting the descriptive `visibilityModel.emptyBuckets` actually matches the groups' real `visibleWhen` coverage (i.e. no group secretly references a "declared-empty" value)? This would catch metadata/data drift the runtime ignores.
4. **Matrix size.** Full cartesian product is 4×2×2×8 = 128 configs × 2^5 = 32 flag subsets = 4096 cases. Is the full product wanted, or a reduced pairwise/relevant-flag-only matrix (flags only matter for fuel-relevant groups)? (Recommendation: iterate the full 128 axis-configs with empty flags for the group-set oracle, then a focused per-relevant-flag pass — avoids 4096 while still exhaustive on what matters.)
5. **Garbage-config robustness.** Should the test assert `selectVisibleGroups({fuelType:"lpg"})` (an enum value the engine does _not_ validate at runtime — it relies on the DB CHECK) yields only base groups without throwing? Documents the trust boundary.
