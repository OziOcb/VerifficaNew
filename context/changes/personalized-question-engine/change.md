---
change_id: personalized-question-engine
title: Session screen + personalized question generation
status: new
created: 2026-06-15
updated: 2026-06-15
archived_at: null
---

## Notes

Implements roadmap **S-04** (`context/foundation/roadmap.md`). Prereq S-03 is done.

- **Outcome:** open the session screen (Part navigation, Total Score, completion indicator, global notes document) and see a question set personalized to this car's configuration.
- **PRD refs:** FR-010, FR-014, US-01.
- **Wedge:** the additive visibility model (FR-014) — questions are personalized to the saved Part 1 config rather than shown as a generic wall.
- **Open unknown (non-blocking):** runtime equipment-flag input affordance (inline gating question vs. toggle). The config/flag layer separation is settled per FR-014; only the affordance is a downstream detail.
- Trackers: GitHub #6, Linear VER-12. Branch `feat/personalized-question-engine`.
