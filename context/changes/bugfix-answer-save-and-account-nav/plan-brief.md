# Fix Lost Answers on Fast Clicking (Bug 1) — Plan Brief

> Full plan: `context/changes/bugfix-answer-save-and-account-nav/plan.md`
> Frame brief: `context/changes/bugfix-answer-save-and-account-nav/frame.md`

## What & Why

Rapidly tapping through a Part drops some answers. Per the frame brief (HIGH confidence):
the next answers map is built from an async `useLiveQuery` read that **lags the writes**, and
`saveInspection` **overwrites the whole `answers` jsonb column** — so a fast second tap saves
a stale map that drops the previous answer. We fix the race at the single persistence choke
point and add an invisible in-flight tap guard as UX defense-in-depth.

## Starting Point

Both answer writers — `QuestionCards.handleAnswer` (the card deck) and
`SummaryScreen.handleEditAnswer` (S-06 inline edit) — funnel through `saveInspection`, which
read-merges at the **column** level but **replaces** the whole `answers` object
(`sync.ts:122-129`). There is already a `fake-indexeddb` unit harness for `saveInspection`
in `tests/sync.test.ts`.

## Desired End State

Answering fast through a Part persists every answer; reloading shows none blank. The same fix
protects the summary inline-edit because both writers share `saveInspection`. Fast
double-tapping no longer advances past a card before its save resolves. A regression test
fails on the old overwrite and passes on the merge.

## Key Decisions Made

| Decision        | Choice                                              | Why (1 sentence)                                                      | Source |
| --------------- | --------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| Root cause      | Stale live-row read + whole-column jsonb overwrite  | Only-on-rapid-tapping + code evidence                                 | Frame  |
| Fix location    | Persistence boundary (`saveInspection`)             | Single choke point fixes both writers at once                         | Plan   |
| Merge semantics | Union answer keys (`{...existing, ...input}`)       | No "unanswer" in the domain, so union can't drop/resurrect a key      | Plan   |
| Button UX       | Invisible in-flight guard (ref), no visible disable | Local writes are ~instant; a disabled flash reads as a glitch         | Plan   |
| Test depth      | Unit regression test in `tests/sync.test.ts`        | Pins the exact bug at the boundary; e2e rapid-tap is flaky            | Plan   |
| Bug 2           | Out of scope / held                                 | Body-lock hypothesis refuted by reproduction; needs real-device repro | Frame  |

## Scope

**In scope:** jsonb key-merge in `saveInspection`; a stale-save regression test; an in-flight
tap guard in `QuestionCards`.

**Out of scope:** Bug 2 (mobile account dropdown); visible button disabling; e2e test;
`SummaryScreen` guard; any schema/sync-protocol change.

## Architecture / Approach

One change at the data boundary: `saveInspection` merges jsonb fields by key inside its
existing `rw` transaction, so correctness no longer depends on any component's render timing.
A ref-based guard in the card deck suppresses taps while a save is pending. `answers` is the
only jsonb field, so the merge branch touches exactly one field's handling.

## Phases at a Glance

| Phase              | What it delivers                                   | Key risk                                                                    |
| ------------------ | -------------------------------------------------- | --------------------------------------------------------------------------- |
| 1. Merge + test    | `saveInspection` unions `answers`; regression test | Merge branch must not regress scalar read-merge (covered by existing tests) |
| 2. In-flight guard | Card deck ignores taps mid-save (invisible)        | Flag must clear on both success and failure or buttons could wedge          |

**Prerequisites:** none (local Supabase not needed for the unit test; `npm run dev` for manual check).
**Estimated effort:** ~1 short session across 2 phases.

## Open Risks & Assumptions

- Assumes the no-"unanswer" domain invariant holds (verified: both writers no-op re-taps).
  If a future feature clears an answer, union-merge would need revisiting.
- Bug 2 remains unreproduced in automation; not addressed here.

## Success Criteria (Summary)

- Fast-tapping through a Part loses no answers (manual, after reload).
- New unit test fails on the old overwrite, passes on the merge; existing sync tests stay green.
- Normal answering, Back, and Next are unchanged.
