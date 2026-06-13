# S-02 Dashboard + Inspection Lifecycle — Plan Brief

> Full plan: `context/changes/inspection-dashboard-lifecycle/plan.md`
> Frame brief: `context/changes/inspection-dashboard-lifecycle/frame.md`
> Research: `context/changes/inspection-dashboard-lifecycle/research.md`

## What & Why

Build Veriffica's first user-visible domain slice: a tiled dashboard where a signed-in user can see, start, resume, and hard-delete inspections, capped at 2 per account. It exercises the F-01 (owner-private `inspections` + RLS) and F-02 (sync endpoint) foundations end-to-end through a real lifecycle surface — validating both before deeper flow work.

Per the frame (Confidence **HIGH**): the dashboard is an **online, server-rendered read surface + synchronous lifecycle mutations** — explicitly **not** offline-first. Offline is scoped to the in-inspection flow (S-05→S-08), so building a server→local hydrate path now (research's "GAP 3") is out of scope.

## Starting Point

The `inspections` table, RLS policies, and `set_updated_at` trigger exist (F-01); the single-record sync endpoint and the Dexie outbox exist (F-02). The dashboard is a placeholder page. The 2-inspection limit was deliberately deferred to this slice, and a throwaway offline demo is the only current consumer of the F-02 layer.

## Desired End State

A user lands on `/dashboard`, sees their inspections grouped Draft/Completed (or an empty-state CTA), starts one (with a startup instruction pop-up + `Don't show again`), resumes or hard-deletes tiles after confirmation, and is blocked by a limit pop-up at the 3rd. The limit is DB-enforced, signout clears the local store, the demo is gone, and the migrations are live on hosted Supabase.

## Key Decisions Made

| Decision               | Choice                                                       | Why (1 sentence)                                                                          | Source |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------ |
| Read model             | SSR `.select()` under RLS, camelCase at the boundary         | Matches the stack's SSR-server-authoritative convention; no Dexie hydrate path            | Frame  |
| Limit enforcement      | `BEFORE INSERT` DB trigger (mirrors `set_updated_at`)        | Server-authoritative; client Dexie count is stale/untrusted; catches sync races           | Frame  |
| Mutation path          | Synchronous online (create + delete)                         | Immediate limit feedback; dashboard is an online surface; offline create has little value | Plan   |
| Create endpoint        | Dedicated `POST /api/inspections/create`; delete reuses sync | Server generates the row + maps trigger error → 409; delete plumbing already exists       | Plan   |
| Naming                 | Auto placeholder name now                                    | Zero-friction start; real auto-name from Make/Model lands in S-03                         | Plan   |
| Resume target          | Stub `inspections/[id].astro`                                | Real navigation + genuine resume target; S-03 replaces the stub body                      | Plan   |
| Startup pop-up trigger | On "Start" click; `Don't show again` → localStorage          | Contextual to starting; doesn't nag on resume/delete                                      | Plan   |

## Scope

**In scope:** limit trigger + test; synchronous create endpoint + client helpers; SSR dashboard with grouped tiles, empty state, startup/limit/delete dialogs; stub resume route; Dexie-wiping signout; delete the demo; hosted `db push`; close F-02 check 4.8.

**Out of scope:** server→local hydrate path; offline-first dashboard; outbox-based dashboard mutations; auto-naming from Make/Model; real Part 1/session screens; `resetLocalStoreOnUserChange` wiring (returns in S-05).

## Architecture / Approach

`dashboard.astro` frontmatter fetches + camelCases the list under RLS and computes the count → a single `client:load` `DashboardBoard` island owns all interactivity (tiles, dialogs, fetch mutations) and is **Dexie-free**. A separate `client:only` `SignOutButton` is the only Dexie consumer (it wipes the store on signout). Create is a synchronous `POST /api/inspections/create` (server-stamped row; trigger → 409 limit); delete is a synchronous call to the existing `/api/inspections/sync` `op:"delete"`. The split keeps Dexie-importing code off every SSR path.

## Phases at a Glance

| Phase                        | What it delivers                                          | Key risk                                                            |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| 1. DB limit trigger + tests  | Authoritative 2-limit trigger, proven by test (local)     | Trigger error message must be stable for the endpoint to map to 409 |
| 2. Mutation server layer     | Create endpoint (limit→409) + client fetch helpers        | Reusing sync endpoint for synchronous delete must stay clean        |
| 3. Dashboard UI + stub route | Tiles, dialogs, signout wipe, resume stub                 | SSR import discipline (no Dexie on SSR/`client:load` paths)         |
| 4. Cleanup, deploy & 4.8     | Demo removed, hosted `db push`, workerd parity smoke-test | First hosted migration push; deployed workerd round-trip unverified |

**Prerequisites:** F-01 + F-02 implemented (done). Hosted Supabase project ref + link access for Phase 4 `db push`.
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- The trigger's raised message (`inspection_limit_reached`) must surface intact through PostgREST/Supabase for the endpoint's 409 mapping — verify in Phase 1/2.
- F-02 check 4.8 can only be closed once Phase 4 pushes `inspections` to hosted Supabase and the app is deployed.
- Auto placeholder names mean two same-day drafts look alike until S-03's auto-naming.

## Success Criteria (Summary)

- A user can start, resume, and delete inspections from a grouped dashboard, blocked at 2 by a limit pop-up.
- The limit is DB-enforced; signout clears the local store; the foreign-inspection route redirects away.
- Migrations live on hosted Supabase; deployed `/api/inspections/sync` round-trips cleanly on workerd; F-02 4.8 closed and both F-02 and S-02 flipped to `implemented`.
