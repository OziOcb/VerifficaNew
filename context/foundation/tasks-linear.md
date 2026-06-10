# Linear — Roadmap Migration

> Record of how `context/foundation/roadmap.md` was mirrored into Linear on
> **2026-06-10**. The roadmap remains the planning source of truth; Linear is an
> actionable tracker derived from it, created alongside the existing GitHub Issues
> tracker (see `tasks-github.md`). The two trackers mirror the same roadmap.

## Task-management system

**Linear** — workspace team **Veriffica** (team key `VER`), created via the Linear MCP
server. The roadmap is mirrored as **3 Projects (one per stream) + custom labels +
12 issues** with **native blocked-by relations** for dependencies.

- **Why Projects for streams:** the 3 roadmap streams (A/B/C) became 3 Linear
  **Projects** rather than Linear Milestones. Linear Milestones imply a sequence
  _within_ a project, but the streams are parallel tracks — Projects model that
  cleanly and give each stream its own board, progress, and timeline.
- **Dependencies are native.** Unlike GitHub (which has no native blocking relation
  and used `Depends on #N` body text), Linear has real **blocked-by / blocks**
  relations. Each roadmap prerequisite is a native relation (visible in the issue
  sidebar, gates ordering) **and** is restated as a `Depends on <ID> (VER-N)` line in
  the body for readers.
- **Issue numbering does not match GitHub.** Linear auto-numbered the issues
  **VER-5 … VER-16** (VER-1…4 predate this migration in the workspace), so the numbers
  do not line up 1:1 with GitHub's `#1–#12`. The **roadmap IDs** (F-01, S-01, …) in
  every title and body are the stable cross-reference between the two trackers.

## What was created

### 12 issues (`VER-5`–`VER-16`)

One issue per roadmap item, created in **dependency order** so each prerequisite issue
existed before its dependents (required, since native blocked-by relations reference
the prerequisite's identifier at creation time). Titles are ID-prefixed and reuse the
"Suggested issue title" column from the roadmap's Backlog Handoff table.

| Issue  | Roadmap ID | Title                                              | Stream / Project | State   | Blocked by     |
| ------ | ---------- | -------------------------------------------------- | ---------------- | ------- | -------------- |
| VER-5  | F-01       | Domain schema + RLS data-isolation contract        | A                | Todo    | —              |
| VER-6  | S-01       | Public home page (product description + auth CTAs) | B                | Todo    | —              |
| VER-7  | S-10       | Settings & profile (font size, theme)              | C                | Todo    | —              |
| VER-8  | F-02       | Offline-first persistence + Change Queue + sync    | A                | Backlog | VER-5          |
| VER-9  | S-09       | Password reset + account deletion                  | B                | Backlog | VER-5          |
| VER-10 | S-02       | Dashboard + inspection lifecycle (CRUD + limit)    | A                | Backlog | VER-5, VER-8   |
| VER-11 | S-03       | Part 1 config form, validation & Parts 2–5 unlock  | A                | Backlog | VER-10         |
| VER-12 | S-04       | Session screen + personalized question generation  | A                | Backlog | VER-11         |
| VER-13 | S-05       | Swipeable answer cards + education + notes         | A                | Backlog | VER-12         |
| VER-14 | S-06       | Summary distribution, inline edit & finalize       | A                | Backlog | VER-13         |
| VER-15 | S-07       | Smart Pruning on config change                     | A                | Backlog | VER-12, VER-13 |
| VER-16 | S-08       | Offline inspection survival end-to-end             | A                | Backlog | VER-8, VER-13  |

`VER-14` (S-06) additionally carries the **`north-star`** label — it is the validation
milestone (the full personalize → answer → aggregate loop).

**Issue body format** (per issue): a `**Roadmap ID** · **Change ID** · **Stream**`
header line, then `## Outcome`, `## PRD refs`, `## Prerequisites` (with
`Depends on <ID> (VER-N)`), optional `## Unlocks`, `## Parallel with`, `## Unknowns`,
`## Risk / rationale`, and a footer with `Status`, `Ready for /10x-plan` (yes/no + the
`/10x-plan <change-id>` command), and a `Source: context/foundation/roadmap.md`
pointer. All content was copied from the matching roadmap section.

### Status → Linear workflow state

Linear's native workflow states are used **in addition to** the `status:*` labels, so
the board is usable while staying an exact mirror of the roadmap's `Status` field:

| Roadmap status | Linear state | Issues              |
| -------------- | ------------ | ------------------- |
| `ready`        | **Todo**     | VER-5, VER-6, VER-7 |
| `proposed`     | **Backlog**  | VER-8 … VER-16      |

### 8 custom labels

Team-scoped to **Veriffica**, mirroring the GitHub label set and colors. (Linear's
3 default labels — Bug, Improvement, Feature — remain untouched.)

| Label             | Color    | Meaning                                       |
| ----------------- | -------- | --------------------------------------------- |
| `kind:foundation` | `5319e7` | Roadmap foundation (F-xx) — VER-5, VER-8      |
| `kind:slice`      | `1d76db` | Roadmap vertical slice (S-xx)                 |
| `status:ready`    | `0e8a16` | Ready to pick up / plan — VER-5, VER-6, VER-7 |
| `status:proposed` | `fbca04` | Proposed; not yet ready                       |
| `stream:A`        | `b60205` | Inspection core (north star)                  |
| `stream:B`        | `d93f0b` | Public surface & account                      |
| `stream:C`        | `c5def5` | UI personalization                            |
| `north-star`      | `fbe032` | North-star validation milestone — VER-14 only |

### 3 projects (one per stream)

GitHub's 3 per-stream milestones map to 3 Linear Projects. Each carries a summary, a
description with the dependency chain, and an icon.

| Project                                   | Icon | Issues                                                               | Count |
| ----------------------------------------- | ---- | -------------------------------------------------------------------- | ----- |
| `Stream A — Inspection core (north star)` | ⭐   | VER-5, VER-8, VER-10, VER-11, VER-12, VER-13, VER-14, VER-15, VER-16 | 9     |
| `Stream B — Public surface & account`     | 🌐   | VER-6, VER-9                                                         | 2     |
| `Stream C — UI personalization`           | 🎨   | VER-7                                                                | 1     |

## Not migrated (intentional)

- **`Parked` section** of the roadmap — explicit PRD non-goals; not work items.
- **`Done` section** — empty on first generation.

## How to use it

- **Filter by track:** open the `Stream A/B/C` project, or filter by the `stream:*` label.
- **Find startable work:** filter by state **Todo** (or the `status:ready` label) →
  VER-5, VER-6, VER-7.
- **Inspect dependencies:** a native **blocked-by** relation shows in each issue's
  sidebar; the body also restates it as `Depends on <ID> (VER-N)`.
- **Plan a ready item:** the body's footer gives the exact `/10x-plan <change-id>`
  command (currently F-01, S-01, S-10 are marked ready for `/10x-plan`).

When status changes (e.g. an item becomes ready, or work starts), move the issue's
**workflow state** and update the `status:*` label — and keep `roadmap.md`'s `Status`
field in sync, since the roadmap is still the source of truth. If you also maintain the
GitHub tracker, mirror the change there (`tasks-github.md`).

## Verification (run 2026-06-10)

- 8 custom labels created on team Veriffica, correct colors. ✓
- 3 projects created (Stream A/B/C), each scoped to team Veriffica. ✓
- 12 issues created VER-5 … VER-16 in dependency order. ✓
- Native blocked-by relations resolved to real issues at creation (e.g. VER-16 blocked
  by VER-8 and VER-13; VER-10 blocked by VER-5 and VER-8). ✓
- VER-14 (S-06) carries `north-star` + `status:proposed` + `stream:A`, in Project
  Stream A, Backlog state, blocked by VER-13. ✓
- `ready` items (VER-5, VER-6, VER-7) are in **Todo**; all others in **Backlog**. ✓
