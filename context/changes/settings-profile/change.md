---
change_id: settings-profile
title: Settings & profile — view profile, control font size and theme
status: planned
created: 2026-07-01
updated: 2026-07-01
archived_at: null
---

## Notes

Roadmap **S-10** (Stream C, standalone — no data dependency). Outcome: user can view a
profile page and control font size and theme (dark/light, following the device system
setting by default until overridden).

- PRD ref: **FR-022**
- Roadmap: `context/foundation/roadmap.md` → S-10
- GitHub issue: **#12**
- Linear issue: **VER-7**
- Prerequisites: none.

### Added scope: reset the startup-instruction "Don't show this again"

Settings should include a control to re-enable the "Start new inspection" startup
instruction pop-up after the user dismissed it via "Don't show this again".

- The preference is a **device-local** `localStorage` flag: `veriffica:hideStartupInstructions:<userId>` = `"1"`
  (`hideStartupKey()` in `src/lib/inspections.ts`; written/read in `src/components/dashboard/DashboardBoard.tsx`).
- Re-enabling = removing (or setting `"0"`) that key so `handleStart()` shows the pop-up again.
- Keep it **device-local** (not DB-backed) to match the current per-user/per-browser scoping;
  don't promote to a roaming profile setting — that would exceed FR-022's font/theme scope.
