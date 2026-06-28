---
change_id: testing-workerd-deployed-smoke-gate
title: Deployed workerd smoke-gate for SSR endpoints and service worker (test-plan Phase 4)
status: implementing
created: 2026-06-27
updated: 2026-06-27
archived_at: null
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "workerd deployed smoke-gate".
Risks covered: #5 (an SSR endpoint / service worker / env access diverges on deployed workerd vs `astro dev` → silent production breakage).
Test types planned: deployed smoke / CI gate (wrangler tail against the live Worker on sync/create + SW load).
Risk response intent: prove /api/inspections/{create,sync} and the service worker behave identically on the deployed Cloudflare Worker as locally; the gate must exercise the real workerd runtime, not mock it away (the runtime divergence IS the risk).
After creating the folder, follow the downstream continuation rule.
