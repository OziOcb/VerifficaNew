# GitHub Issues — Roadmap Migration

> Record of how `context/foundation/roadmap.md` was migrated into GitHub Issues on
> **2026-06-09**. The roadmap remains the planning source of truth; GitHub Issues is
> the actionable tracker derived from it.

## Task-management system

**GitHub Issues + Labels + Milestones** on repo
[`OziOcb/VerifficaNew`](https://github.com/OziOcb/VerifficaNew/issues).

- **GitHub Projects (Kanban board) is NOT used.** The current `gh` auth token lacks the
  `project` scope. To add a board later: `gh auth refresh -s project` — the labels and
  milestones below already make adding one trivial.
- **Dependencies** are expressed as `Depends on #N` text in each issue body. GitHub
  Issues has no native blocking/dependency relation without Projects, so this is the
  convention. References were resolved to real issue numbers at creation time.

## What was created

### 12 issues (`#1`–`#12`)

One issue per roadmap item, created in **dependency order** so each prerequisite issue
exists before its dependents (this also produced clean ascending numbering). Titles are
ID-prefixed and reuse the "Suggested issue title" column from the roadmap's Backlog
Handoff table.

| Issue | Roadmap ID | Title                                              | Stream | Status   | Depends on |
| ----- | ---------- | -------------------------------------------------- | ------ | -------- | ---------- |
| #1    | F-01       | Domain schema + RLS data-isolation contract        | A      | ready    | —          |
| #2    | F-02       | Offline-first persistence + Change Queue + sync    | A      | proposed | #1         |
| #3    | S-01       | Public home page (product description + auth CTAs) | B      | ready    | —          |
| #4    | S-02       | Dashboard + inspection lifecycle (CRUD + limit)    | A      | proposed | #1, #2     |
| #5    | S-03       | Part 1 config form, validation & Parts 2–5 unlock  | A      | proposed | #4         |
| #6    | S-04       | Session screen + personalized question generation  | A      | proposed | #5         |
| #7    | S-05       | Swipeable answer cards + education + notes         | A      | proposed | #6         |
| #8    | S-06       | Summary distribution, inline edit & finalize       | A      | proposed | #7         |
| #9    | S-07       | Smart Pruning on config change                     | A      | proposed | #6, #7     |
| #10   | S-08       | Offline inspection survival end-to-end             | A      | proposed | #2, #7     |
| #11   | S-09       | Password reset + account deletion                  | B      | proposed | #1         |
| #12   | S-10       | Settings & profile (font size, theme)              | C      | ready    | —          |

`#8` (S-06) additionally carries the **`north-star`** label — it is the validation
milestone (the full personalize → answer → aggregate loop).

**Issue body format** (per issue): Roadmap ID + Change ID + Stream header, then
`## Outcome`, `## PRD refs`, `## Prerequisites` (with `Depends on #N`),
`## Parallel with`, `## Unknowns`, `## Risk / rationale`, and a footer with
`Status`, `Ready for /10x-plan` (yes/no + the `/10x-plan <change-id>` command), and a
`Source: context/foundation/roadmap.md` pointer. All content was copied from the
matching roadmap section.

### 8 custom labels

| Label             | Color    | Meaning                                       |
| ----------------- | -------- | --------------------------------------------- |
| `kind:foundation` | `5319e7` | Roadmap foundation (F-xx) — applied to #1, #2 |
| `kind:slice`      | `1d76db` | Roadmap vertical slice (S-xx)                 |
| `status:ready`    | `0e8a16` | Ready to pick up / plan — #1, #3, #12         |
| `status:proposed` | `fbca04` | Proposed; not yet ready                       |
| `stream:A`        | `b60205` | Inspection core (north star)                  |
| `stream:B`        | `d93f0b` | Public surface & account                      |
| `stream:C`        | `c5def5` | UI personalization                            |
| `north-star`      | `fbe032` | North-star validation milestone — #8 only     |

(The 9 default GitHub labels remain untouched.)

### 3 milestones (one per stream)

| Milestone                                 | Issues                              | Count |
| ----------------------------------------- | ----------------------------------- | ----- |
| `Stream A — Inspection core (north star)` | #1, #2, #4, #5, #6, #7, #8, #9, #10 | 9     |
| `Stream B — Public surface & account`     | #3, #11                             | 2     |
| `Stream C — UI personalization`           | #12                                 | 1     |

## Not migrated (intentional)

- **`Parked` section** of the roadmap — explicit PRD non-goals; not work items.
- **`Done` section** — empty on first generation.

## How to use it

- **Filter by track:** `gh issue list --label stream:A`
- **Find startable work:** `gh issue list --label status:ready`
- **Inspect one:** `gh issue view <N>` (shows the `Depends on #N` prerequisites)
- **Plan a ready item:** the body's footer gives the exact `/10x-plan <change-id>` command
  (currently F-01, S-01, S-10 are marked ready for `/10x-plan`).

When status changes (e.g. an item becomes ready, or work starts), update the
`status:*` label on the issue — and keep `roadmap.md`'s `Status` field in sync, since
the roadmap is still the source of truth.

## Verification (run 2026-06-09)

- `gh issue list` → 12 issues, ID-prefixed, in order. ✓
- `gh label list` → 8 custom labels present. ✓
- `gh api repos/OziOcb/VerifficaNew/milestones` → 3 milestones, counts 9/2/1. ✓
- `gh issue view 8` → `north-star` + `status:proposed` + `stream:A` + Milestone A;
  body `Depends on #7 (S-05)` resolves correctly. ✓
- `gh issue list --label status:ready` → `#1, #3, #12`. ✓
