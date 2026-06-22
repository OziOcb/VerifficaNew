# Visibility-engine hardening — Plan Brief

> Full plan: `context/changes/testing-visibility-engine-hardening/plan.md`
> Research: `context/changes/testing-visibility-engine-hardening/research.md`

## What & Why

Harden `tests/questions.test.ts` so the FR-014 additive visibility engine is provably correct against the **independently-authored question catalogue** — never against its own output. This is Test Plan Phase 1, covering risk #2 (engine emits the wrong question set → the checklist silently misleads the buyer) and proxying risk #3 (Smart Pruning / S-07): pruning will re-run `selectVisibleQuestionIds` and diff, so it needs a trustworthy oracle first. This is the cheapest thing buildable today that de-risks #3.

## Starting Point

The engine (`src/lib/questions.ts`) is a pure, stateless, strictly-additive predicate filter, already shipped and frozen. The existing test is happy-path-weighted: all 3 fixtures pin `drive:"2wd"` + `bodyType:"sedan"` (both empty buckets), so `4wd` and the non-empty body types are never asserted visible — and its oracle is mixed (hand-written magic-number literals + same-JSON-as-engine derivations).

## Desired End State

The test reconciles the engine against a catalogue-derived oracle across the full axis matrix and per-flag layering, plus guards two drift surfaces and two trust boundaries. A future hand-edit that drops/adds a group, drifts `src/data` from `idea/`, or diverges metadata from data fails `npm test` loudly. No `src/`, schema, or data changes.

## Key Decisions Made

| Decision             | Choice                                              | Why (1 sentence)                                                               | Source   |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| Oracle strategy      | Derived matrix + literal anchors                    | Derived catches a traversal bug; retained literals catch a wrong manual count  | Plan     |
| Matrix size          | Full 128 axis-configs + focused per-flag pass       | Exhaustive on what matters; additivity makes the 4096-case product redundant   | Plan     |
| Drift guard          | Yes — one `toEqual` per file (`idea/` ↔ `src/data`) | Cheap insurance against the hand-copy silently drifting (currently unenforced) | Plan     |
| Trust-boundary cases | Both: metadata cross-check + garbage-config         | Each pins a real boundary in ~5 lines; documents the contract                  | Plan     |
| Engine code changes  | None                                                | Risk #2 is a test-coverage gap, not an engine defect — the engine is sound     | Research |

## Scope

**In scope:**

- A catalogue-derived oracle helper (`expectedGroupIds`/`expectedQuestionIds`) reading `mappingJson`/`bankJson` directly.
- Full 128 axis-config reconciliation (finally asserts `4wd`, `suv/van/pickup/convertible`).
- Per-relevant-flag layering across diverse configs; config-independent `importedFromEU` groups.
- `idea/` ↔ `src/data` equality guard; `formula`/`emptyBuckets` metadata cross-check; garbage-config robustness.

**Out of scope:**

- Any engine/`src/` change, schema, or data edit.
- Route-guard test for "redirects when config invalid" (carried-forward gap).
- S-07 Smart Pruning tests (code not built — anti-pattern).
- Full 4096-case cartesian (axis × all flag subsets).

## Architecture / Approach

One independent oracle helper at the top of the test reproduces the engine's predicate by reading the authored JSON — the anti-oracle-problem guard. The engine's emitted group-id set + order is reconciled against it across the 128 axis-config product (Phase 1), then a focused per-relevant-flag pass (Phase 2), then drift + trust-boundary guards (Phase 3). Existing magic-number literals stay as commented human canaries.

## Phases at a Glance

| Phase                            | What it delivers                                                       | Key risk                                                            |
| -------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1. Oracle + full axis matrix     | Independent oracle; 128-config reconciliation incl. 4wd/non-empty body | Oracle accidentally mirroring engine logic instead of authored data |
| 2. Flag layering reconciliation  | Per-relevant-flag pass on diverse configs; importedFromEU independence | Re-using the same-JSON `expectedFor` instead of the new oracle      |
| 3. Drift & trust-boundary guards | `idea/`↔`src/data` equality; metadata cross-check; garbage-config      | `idea/` JSON import path under test module resolution               |

**Prerequisites:** None — research complete; engine and catalogue already in the repo.
**Estimated effort:** ~1 session across 3 phases (single test file).

## Open Risks & Assumptions

- The oracle must consume authored JSON only; if it inadvertently encodes the same logic the engine has, both could be wrong together — mitigated by the Phase 1 negative check (mutate `visibleWhen`, see it diverge).
- Importing `idea/veriffica-questions-list/*.json` into the test may need a relative path rather than the `@/` alias (which maps to `src/`); the plan flags this.
- Assumes `idea/` stays in the repo as the authored source (it is a planning area, not a runtime source).

## Success Criteria (Summary)

- `npm test` green; the 128-config matrix shows the engine equals the catalogue oracle for every case.
- A deliberate single-group `visibleWhen` mutation makes the oracle assertion fail (the oracle has teeth).
- `src/data` ↔ `idea/` equality, metadata cross-check, and garbage-config robustness all asserted.
