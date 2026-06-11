---
change_id: offline-first-persistence-layer
title: Offline-first persistence + sync contract
status: new
created: 2026-06-11
updated: 2026-06-11
archived_at: null
---

## Notes

Roadmap item **F-02** (`context/foundation/roadmap.md`). Foundation: on-device store + Change Queue + background Last-Write-Wins sync; one domain record must survive a full offline → online cycle with no loss. PRD refs: FR-023, US-03, NFR §offline, Guardrail §No data loss on connectivity change. Prerequisite F-01 (`domain-schema-rls-isolation`) is implemented. Flagged as the #1 engineering blocker — scope-cap to the store/queue/sync contract round-tripping one record, not every entity's reconciliation.
