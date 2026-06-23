---
change_id: testing-visibility-engine-hardening
title: Visibility-engine hardening — reconcile emitted question set against the authored catalogue
status: implemented
created: 2026-06-22
updated: 2026-06-22
archived_at: null
---

## Notes

Rollout Phase 1 of context/foundation/test-plan.md: "Visibility-engine hardening".

Risks covered: #2 (visibility engine emits the wrong question set for a config — missing/extra groups — silently misleading the buyer). This phase also proxies #3 (Smart Pruning), whose own slice S-07 is not built yet: hardening the engine that pruning will consume is the cheapest thing buildable today that de-risks it.

Test types planned: unit (pure function) + automated reconciliation of engine output against the authored question catalogue.

Risk response intent: prove that a given car config yields EXACTLY the groups the authored catalogue specifies — no missing, no extra — across the full axis (fuel/transmission/drive/body) + runtime-flag matrix. The oracle must come from the independently-authored catalogue, never from the engine's own output.
