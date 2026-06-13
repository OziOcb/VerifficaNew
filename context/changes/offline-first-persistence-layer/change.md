---
change_id: offline-first-persistence-layer
title: Offline-first persistence + sync contract
status: implemented
created: 2026-06-11
updated: 2026-06-13
archived_at: null
---

## Notes

Roadmap item **F-02** (`context/foundation/roadmap.md`). Foundation: on-device store + Change Queue + background Last-Write-Wins sync; one domain record must survive a full offline → online cycle with no loss. PRD refs: FR-023, US-03, NFR §offline, Guardrail §No data loss on connectivity change. Prerequisite F-01 (`domain-schema-rls-isolation`) is implemented. Flagged as the #1 engineering blocker — scope-cap to the store/queue/sync contract round-tripping one record, not every entity's reconciliation.

## Follow-ups (for S-02 / S-08)

The Dexie store is keyed per browser **origin**, not per user, and nothing in the
auth flow clears it. Two related cases, surfaced while testing the Phase 3 demo:

- **User switch (handled in F-02):** `resetLocalStoreOnUserChange(userId)` in
  `src/lib/sync.ts` wipes `inspections` + `changeQueue` on load when the signed-in
  user differs from the last owner the store served (localStorage marker
  `veriffica:lastOwnerId`). RLS already protects the server; this guards the local
  optimistic cache on a shared device.
- **Logout (deferred):** a logged-out visitor still sees the last user's cached
  rows. **Not** fixed via the load-time guard on purpose — `locals.user === null`
  is ambiguous between "explicitly signed out" (safe to wipe) and "no session right
  now because offline / cookie expired" (must NOT wipe, or we destroy unsynced
  offline writes — the exact data loss F-02/S-08 prevent). The correct fix hooks the
  **explicit signout action** (unambiguous intent), not page load. Today signout is
  a plain server form (`src/pages/dashboard.astro` → `/api/auth/signout`) with no
  client hook; adding a `db.delete()` there belongs to S-02's real dashboard/signout
  UI or S-08's "no loss, no logout" work.
- **Throwaway demo:** `/offline-demo` + `src/components/offline/OfflineDemo.tsx` are
  temporary verification surfaces; remove when S-02's dashboard subsumes them.

- **Deferred check 4.8 (deployed workerd-parity smoke-test):** Phase 4's manual
  item 4.8 — smoke-test the deployed `/api/inspections/sync` with `npx wrangler
tail` — is **deferred to S-02**. F-02 round-trips against local Supabase; the
  `inspections` migration isn't pushed to hosted Supabase until S-02, so a full
  deployed round-trip isn't possible yet. Workerd parity is already evidenced
  locally (the endpoint ran on workerd via `wrangler dev` throughout the e2e).
  When S-02 pushes the migration and deploys, run `wrangler tail` against the
  live `/api/inspections/sync` to close 4.8. F-02 stays `status: implementing`
  until then.
