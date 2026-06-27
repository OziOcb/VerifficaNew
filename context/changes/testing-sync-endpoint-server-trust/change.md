---
change_id: testing-sync-endpoint-server-trust
title: Sync-endpoint server-trust — prove the server rejects oversized / cross-field-invalid writes
status: impl_reviewed
created: 2026-06-27
updated: 2026-06-27
archived_at: null
---

## Notes

Rollout Phase 3 of context/foundation/test-plan.md: "Sync-endpoint server-trust".

Risks covered: #6 — the sync endpoint trusts the client; it may accept oversized or cross-field-invalid domain writes (a note over the limit; Electric + Manual set together).

Test types planned: integration.

Risk response intent: #6 — prove the server rejects oversized / cross-field-invalid payloads even when the client validator is bypassed. Challenge the assumption "client-side validation is enough" — the server must not trust the client. Avoid re-testing the client validator, and do NOT skip the case where the server does not validate at all (that absence is the finding).
