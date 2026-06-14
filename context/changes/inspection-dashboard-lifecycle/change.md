---
change_id: inspection-dashboard-lifecycle
title: Dashboard + inspection lifecycle (create, resume, delete, 2-inspection limit)
status: implemented
created: 2026-06-13
updated: 2026-06-14
archived_at: null
---

## Notes

Roadmap slice **S-02** (`context/foundation/roadmap.md`). First user-visible domain slice; exercises F-01 (owner-private inspections) and F-02 (local-first persistence) end-to-end through a real create/resume/delete surface.

- **Outcome:** see a tiled dashboard (Draft vs Completed), start a new inspection (with the startup instruction pop-up), resume or hard-delete a tile, and hit the 2-inspection-limit pop-up.
- **PRD refs:** FR-006, FR-007, FR-008, FR-009, US-01
- **Prerequisites:** F-01, F-02 (both implemented)

**Deploy note (carried from roadmap):** F-01's `inspections` migration was applied **locally only** — DB migrations are not in the Cloudflare Workers deploy pipeline. As the first slice that reads/writes `inspections`, S-02 must apply it to the hosted project before its UI ships: `npx supabase link --project-ref <ref>` then `npx supabase db push`.

**Inherited from F-02 — close deferred check 4.8:** once S-02 deploys, run `npx wrangler tail` against the live `/api/inspections/sync` to confirm no Node-API runtime error on workerd, then check off F-02's manual item 4.8 and flip F-02 to `implemented`. (See `context/changes/offline-first-persistence-layer/change.md` Follow-ups.)
