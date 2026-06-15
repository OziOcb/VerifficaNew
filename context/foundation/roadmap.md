---
project: Veriffica
version: 1
status: draft
created: 2026-06-09
updated: 2026-06-15
prd_version: 1
main_goal: quality
top_blocker: skills
---

# Roadmap: Veriffica

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Veriffica turns an expert's mental model of a used-car inspection into a step-by-step
guide a layperson can follow at the seller's location: a checklist personalized to
_this specific car_ (fuel / transmission / drive / body + equipment exceptions) and
ordered to match the physical inspection (standstill → engine → drive → documents),
recording every answer and note so nothing is lost. It is explicitly a helper tool,
not a replacement for a professional inspection. The product **wedge** — the one trait
that, if removed, leaves a generic checklist — is that the question set is personalized
to _this_ car's declared configuration rather than shown as a wall of generic questions.

## North star

**S-06: user reaches a finalized Summary for a personalized inspection** — reaching the
Summary (with the Yes/No/Don't know distribution) and explicitly finalizing to
`Completed` proves the full personalize → answer → aggregate loop works end-to-end,
which is the core product hypothesis. Tied to the quality goal: the validation milestone
is the _complete, reliable_ loop, not a partial demo.

> "North star" here means the smallest end-to-end slice whose successful delivery would
> prove the core product hypothesis — everything else only matters if this works, so its
> dependency chain (S-02 → S-06) is sequenced first. It is reached as early as
> Prerequisites allow because all non-core surface (account recovery, settings) is
> deferred behind it.

## At a glance

| ID   | Change ID                       | Outcome (user can …)                                                          | Prerequisites | PRD refs                               | Status      |
| ---- | ------------------------------- | ----------------------------------------------------------------------------- | ------------- | -------------------------------------- | ----------- |
| F-01 | domain-schema-rls-isolation     | (foundation) owner-private domain data persists, invisible to other accounts  | —             | Access Control, FR-006, FR-011         | implemented |
| F-02 | offline-first-persistence-layer | (foundation) local-first store + Change Queue + LWW sync round-trips a record | F-01          | FR-023, US-03                          | implemented |
| S-01 | public-home-page                | view a public home page describing the inspection, with log in / register     | —             | FR-005, FR-024                         | implemented |
| S-02 | inspection-dashboard-lifecycle  | see, start, resume, and delete inspections; hit the 2-inspection limit        | F-01, F-02    | FR-006, FR-007, FR-008, FR-009, US-01  | implemented |
| S-03 | part-1-config-validation        | fill & validate Part 1 config and unlock Parts 2–5                            | S-02          | FR-011, FR-012, FR-013, US-01          | done        |
| S-04 | personalized-question-engine    | open the session screen and see questions personalized to their car           | S-03          | FR-010, FR-014, US-01                  | proposed    |
| S-05 | question-card-answering         | answer Parts 2–5 as swipeable cards, with education pop-ups and notes         | S-04          | FR-015, FR-017, FR-018, US-01          | proposed    |
| S-06 | summary-scoring-finalize        | view the Summary distribution, edit inline, and finalize to Completed         | S-05          | FR-019, FR-020, FR-021, US-01          | proposed    |
| S-07 | config-change-smart-pruning     | change config and keep valid answers while orphans are pruned (recompute)     | S-04, S-05    | FR-016, US-02                          | proposed    |
| S-08 | offline-inspection-survival     | lose/regain connectivity mid-inspection with no loss and no logout            | F-02, S-05    | FR-023, US-03                          | proposed    |
| S-09 | account-recovery-deletion       | reset a forgotten password and permanently delete their account               | F-01          | FR-001, FR-002, FR-003, FR-004, FR-025 | proposed    |
| S-10 | settings-profile                | view their profile and control font size and theme                            | —             | FR-022                                 | ready       |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                        | Chain                                                                                             | Note                                                                             |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A      | Inspection core (north star) | `F-01` → `F-02` → `S-02` → `S-03` → `S-04` → `S-05` → `S-06` (+ `S-07`, `S-08` branch off `S-05`) | The north-star chain; foundations sequenced eagerly per the quality goal.        |
| B      | Public surface & account     | `S-01` ; `S-09`                                                                                   | `S-09` joins on `F-01`; runs parallel to Stream A, deferred behind north star.   |
| C      | UI personalization           | `S-10`                                                                                            | Standalone, no data dependency; ready anytime, deprioritized behind reliability. |

## Baseline

What's already in place in the codebase as of `2026-06-09` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4, shadcn/ui; auth pages and a `dashboard.astro` scaffold (`src/pages/`, `src/components/`).
- **Backend / API:** partial — Astro server endpoints for auth only (`src/pages/api/auth/{signin,signup,signout}.ts`); no domain API yet.
- **Data:** partial — Supabase configured locally (`supabase/config.toml`) but **no migrations or domain tables**; auth uses `auth.users` only.
- **Auth:** present — Supabase Auth (sign-in / sign-up / confirm-email, `src/middleware.ts` with `PROTECTED_ROUTES`, `src/lib/supabase.ts`). Password reset (FR-025) is **not** yet built.
- **Deploy / infra:** present — Cloudflare Workers + wrangler, CI (`.github/workflows/ci.yml`), auto-deploy via Workers Builds.
- **Observability:** absent — none; explicitly a non-goal for the MVP (PRD §Non-Goals).
- **PWA / offline:** absent — no service worker or manifest; this is the dominant engineering item (FR-023) and is addressed by F-02.

## Foundations

### F-01: Domain schema + RLS isolation contract

- **Outcome:** (foundation) Supabase domain schema baseline landed with Row-Level Security enforcing per-account isolation; the first owner-private record persists and is provably invisible to other accounts.
- **Change ID:** domain-schema-rls-isolation
- **PRD refs:** Access Control §Data isolation, Guardrail §Strict data isolation, NFR §isolation, FR-006, FR-011
- **Unlocks:** S-02 (owner-private inspections), S-09 (cascade account deletion), and the strict-data-isolation guardrail verification path.
- **Prerequisites:** — (Supabase Auth + deploy already present per Baseline)
- **Parallel with:** S-01, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced first because every domain slice writes owner-private data; establishing the RLS isolation contract once (not per-slice) is the cheapest way to honor the absolute data-isolation guardrail. Scope is the minimal inspections table + policy pattern — later slices add tables following it, not a whole schema built ahead.
- **Status:** implemented (PR #13; migration applied locally only — prod `db push` deferred to S-02)

### F-02: Offline-first persistence + sync contract

- **Outcome:** (foundation) On-device store, Change Queue, background Last-Write-Wins sync, **and the `@vite-pwa/astro` service-worker shell** landed as the local-first persistence contract; one domain record survives a full offline → online cycle with no loss, and the app shell loads on a real offline reload (not just data persisting).
- **Change ID:** offline-first-persistence-layer
- **PRD refs:** FR-023, US-03, NFR §offline, Guardrail §No data loss on connectivity change
- **Unlocks:** S-08 (offline survival end-to-end), the no-data-loss guardrail verification path, and local-first persistence for every domain slice (S-02 … S-07).
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-10
- **Blockers:** —
- **Unknowns:**
  - ~~Reconciliation edge cases under Last-Write-Wins / Client-Wins (e.g. concurrent edits to the global notes document)~~ — **Resolved** (research `context/changes/offline-first-persistence-layer/research.md`). Veriffica is single-device / single-writer (multi-device realtime sync is a non-goal), so plain LWW via an `updated_at` timestamp is adequate and **no CRDT is needed**. Only two real residual edges, both fixable without CRDTs: (1) **multi-tab on one device** → single-leader guard (Web Locks / BroadcastChannel); (2) **global notes blob** → store notes at row/field-level granularity so independent edits never collide ("design to avoid conflicts"). Text CRDTs (Yjs/Automerge) parked — only needed for collaborative editing, which contradicts the non-goals.
- **Risk:** This is the #1 blocker (unfamiliar tech, no starter per `tech-stack.md`) and the dominant engineering item. Sequenced eagerly — before the domain slices — so they are built local-first from day one and never need an online-first → offline retrofit (quality goal: no reliability rework). Scope cap: the store/queue/sync contract round-tripping one record, not every entity's reconciliation. **De-risked** (see research) by assembling proven, stack-compatible parts rather than building from zero: `@vite-pwa/astro` (Workbox SW shell; exclude Supabase `/api/auth/*` + `PROTECTED_ROUTES` from caching) + **Dexie** (on-device store) + a **hand-rolled outbox** (or `@tanstack/offline-transactions` if multi-tab leader election is wanted for free). RxDB + Supabase replication surveyed and rejected — it pulls in Supabase Realtime, a non-goal.
- **Decisions** (bind `/10x-plan`; full rationale in `context/changes/offline-first-persistence-layer/research.md`): (1) **LWW = server-authoritative** — F-01's `set_updated_at()` trigger stamps `updated_at`; client adopts the returned row. (2) **Sync endpoint = single-record upsert** — `POST /api/inspections/sync`, one op at a time, under RLS (mirrors `/api/auth/*`; no browser Supabase client / no client-exposed key). (3) **Field casing = camelCase across all app layers, snake_case only in Postgres + the one sync endpoint**, via a generic key-transform + `type-fest` `CamelCasedPropertiesDeep` types — now a project-wide rule in `context/foundation/lessons.md`. (4) **Service worker = in F-02** (`@vite-pwa/astro`; auth routes excluded from caching), so the foundation survives a real offline reload.
- **Status:** implemented — all 4 plan phases implemented, verified locally on branch `feat/offline-first-persistence-layer` (Dexie store, sync endpoint, client outbox + `startAutoSync`, `@vite-pwa/astro` SW shell, Playwright offline round-trip e2e), and impl-reviewed (`reviews/impl-review.md`, verdict APPROVED). **Deferred follow-up now closed (2026-06-14):** manual check **4.8** — the deployed `wrangler tail` workerd-parity smoke-test of `/api/inspections/sync` — was **closed by S-02**, which pushed both migrations to hosted Supabase, deployed, and confirmed clean `/api/inspections/{create,sync}` round-trips on the deployed Worker with no Node-API runtime error.

## Slices

### S-01: Public home page

- **Outcome:** user can view a public home page describing the 5-part inspection, with log in / register actions.
- **Change ID:** public-home-page
- **PRD refs:** FR-005, FR-024
- **Prerequisites:** —
- **Parallel with:** F-01, F-02, S-09, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Standalone entry surface with no data dependency; also lands the English-only UI convention (FR-024). Low risk; placed early as a quick independent win that doesn't compete with the north-star chain.
- **Status:** implemented

### S-02: Dashboard + inspection lifecycle

- **Outcome:** user can see a tiled dashboard (Draft vs Completed), start a new inspection (with the startup instruction pop-up), resume or hard-delete a tile, and hit the 2-inspection-limit pop-up.
- **Change ID:** inspection-dashboard-lifecycle
- **PRD refs:** FR-006, FR-007, FR-008, FR-009, US-01
- **Prerequisites:** F-01, F-02
- **Parallel with:** S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** First user-visible domain slice; exercises F-01 (owner-private inspections) and F-02 (local-first persistence) end-to-end through a real create/resume/delete surface, validating both foundations before deeper flow work.
- **Deploy note:** F-01's `inspections` migration was applied **locally only** — DB migrations are not in the Cloudflare Workers deploy pipeline. As the first slice that reads/writes `inspections`, S-02 must apply it to the hosted project before its UI ships: `npx supabase link --project-ref <ref>` then `npx supabase db push`. (See README → "Database schema & migrations".)
- **Inherited from F-02 — closed deferred check 4.8 (2026-06-14):** F-02 had deferred its deployed workerd-parity smoke-test because the `inspections` table wasn't on hosted Supabase until this slice's `db push`. S-02 pushed both migrations to hosted Supabase and deployed; `npx wrangler tail` showed clean `/api/inspections/{create,sync}` round-trips on the deployed Worker with no Node-API runtime error, closing F-02's manual item 4.8. (See `context/changes/offline-first-persistence-layer/change.md` Follow-ups.)
- **Status:** implemented

### S-03: Part 1 config + validation + unlock

- **Outcome:** user can fill the Part 1 vehicle-configuration form with field-by-field validation, and on saving the six required fields, unlock Parts 2–5.
- **Change ID:** part-1-config-validation
- **PRD refs:** FR-011, FR-012, FR-013, US-01
- **Prerequisites:** S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Validation (FR-012) is detailed and rule-driven; gating Parts 2–5 here (FR-013) is the precondition for the personalization engine, so it must be correct before S-04.
- **Status:** done

### S-04: Session screen + personalized question generation

- **Outcome:** user can open the session screen (Part navigation, Total Score, completion indicator, global notes document) and see a question set personalized to their car's configuration.
- **Change ID:** personalized-question-engine
- **PRD refs:** FR-010, FR-014, US-01
- **Prerequisites:** S-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Runtime equipment-flag input affordance (inline gating question vs. toggle) — Owner: user/team. Block: no. (The config/flag layer separation is settled per FR-014; only the affordance is a downstream detail.)
- **Risk:** This is the product wedge made real — the additive visibility model (FR-014) is the one trait that makes Veriffica more than a generic checklist; sequenced right after Part 1 because the saved config drives visibility. Carries the only open implementation detail (flag affordance), which is non-blocking.
- **Status:** proposed

### S-05: Answer the personalized questions

- **Outcome:** user can answer Parts 2–5 as full-screen swipeable cards (Yes/No/Don't know) with mandatory answers, lossless back-navigation, per-Part progress, education pop-ups, and per-question contextual notes.
- **Change ID:** question-card-answering
- **PRD refs:** FR-015, FR-017, FR-018, US-01
- **Prerequisites:** S-04
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The core interaction surface; mandatory answering and lossless back-navigation are the UX guarantees the completion-rate success metric depends on. Sequenced after the question set exists (S-04) so there is a real personalized set to answer.
- **Status:** proposed

### S-06: Summary, scoring distribution & finalize

- **Outcome:** user can view the Summary (per-Part and global Yes/No/Don't know distribution + Total Score), edit answers inline, and explicitly finalize the inspection to `Completed` as a read-only report.
- **Change ID:** summary-scoring-finalize
- **PRD refs:** FR-019, FR-020, FR-021, US-01
- **Prerequisites:** S-05
- **Parallel with:** S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The validation milestone (north star) — reaching a finalized Summary proves the full personalize → answer → aggregate loop works end-to-end. Sequenced as the culmination of the north-star chain; everything after it is refinement or non-core surface. The pure distribution (no weighting/verdict) is a deliberate liability-bounding choice, not an oversight.
- **Status:** proposed

### S-07: Config-change Smart Pruning

- **Outcome:** user can change a visibility-affecting Part 1 field and keep still-valid answers while orphaned answers are pruned and progress / Total Score recompute immediately, after a warning.
- **Change ID:** config-change-smart-pruning
- **PRD refs:** FR-016, US-02
- **Prerequisites:** S-04, S-05
- **Parallel with:** S-06, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Subtle reconciliation logic (the PRD flags it as bug-prone); deferred just past the core loop so the visibility model (S-04) and the answer store (S-05) it operates on already exist and are verified.
- **Status:** proposed

### S-08: Offline survival end-to-end

- **Outcome:** user can lose and regain connectivity mid-inspection without being logged out or interrupted, and all offline answers and notes sync automatically from the Change Queue on reconnect.
- **Change ID:** offline-inspection-survival
- **PRD refs:** FR-023, US-03
- **Prerequisites:** F-02, S-05
- **Parallel with:** S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Validates the no-data-loss guardrail across the real inspection flow (not just F-02's single-record round-trip). Sequenced after answering exists (S-05) so there is genuine offline state to survive; F-02 already de-risked the core sync mechanism, keeping this slice about flow-level hardening.
- **Status:** proposed

### S-09: Account recovery & deletion

- **Outcome:** user can reset a forgotten password via an email link and permanently delete their profile and all associated data after explicit confirmation.
- **Change ID:** account-recovery-deletion
- **PRD refs:** FR-001, FR-002, FR-003, FR-004, FR-025
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Registration / login / email-verification (FR-001/002/003) are baseline-present; this slice completes the account surface with the two missing pieces — password reset (independent of F-01) and cascade account deletion (needs F-01's schema to erase all domain data). Deferred behind the north star per the quality goal's core-loop-first focus.
- **Status:** proposed

### S-10: Settings & profile

- **Outcome:** user can view a profile page and control font size and theme (dark/light, following the device system setting by default until overridden).
- **Change ID:** settings-profile
- **PRD refs:** FR-022
- **Prerequisites:** —
- **Parallel with:** F-01, F-02, S-01, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** No data dependency and off the core loop; ready anytime but deprioritized behind reliability and the north star per the quality goal.
- **Status:** ready

## Backlog Handoff

| Roadmap ID | Change ID                       | Suggested issue title                              | Ready for `/10x-plan` | Notes                                                          |
| ---------- | ------------------------------- | -------------------------------------------------- | --------------------- | -------------------------------------------------------------- |
| F-01       | domain-schema-rls-isolation     | Domain schema + RLS data-isolation contract        | yes                   | Run `/10x-plan domain-schema-rls-isolation`                    |
| F-02       | offline-first-persistence-layer | Offline-first persistence + Change Queue + sync    | yes                   | Implemented — check 4.8 (deployed smoke-test) deferred to S-02 |
| S-01       | public-home-page                | Public home page (product description + auth CTAs) | yes                   | Run `/10x-plan public-home-page`                               |
| S-02       | inspection-dashboard-lifecycle  | Dashboard + inspection lifecycle (CRUD + limit)    | no                    | Needs F-01, F-02                                               |
| S-03       | part-1-config-validation        | Part 1 config form, validation & Parts 2–5 unlock  | in progress           | S-02 done; branch `feat/part-1-config-validation`              |
| S-04       | personalized-question-engine    | Session screen + personalized question generation  | no                    | Needs S-03                                                     |
| S-05       | question-card-answering         | Swipeable answer cards + education + notes         | no                    | Needs S-04                                                     |
| S-06       | summary-scoring-finalize        | Summary distribution, inline edit & finalize       | no                    | North star; needs S-05                                         |
| S-07       | config-change-smart-pruning     | Smart Pruning on config change                     | no                    | Needs S-04, S-05                                               |
| S-08       | offline-inspection-survival     | Offline inspection survival end-to-end             | no                    | Needs F-02, S-05                                               |
| S-09       | account-recovery-deletion       | Password reset + account deletion                  | no                    | Needs F-01                                                     |
| S-10       | settings-profile                | Settings & profile (font size, theme)              | yes                   | Run `/10x-plan settings-profile`                               |

## Open Roadmap Questions

None outstanding. The PRD's two `## Open Questions` were resolved before this roadmap
was generated (runtime-flag layer separation → FR-014; password reset in scope → FR-025).
The only residual unknown — the runtime equipment-flag _input affordance_ — is non-blocking
and lives in S-04, not here.

## Parked

- **Interface languages other than English** — Why parked: PRD §Non-Goals (single-language UI keeps copy and the question catalogue tractable; FR-024 fixes English-only).
- **Photo system (capture / upload / galleries)** — Why parked: PRD §Non-Goals.
- **Export or sharing (PDF, report links)** — Why parked: PRD §Non-Goals.
- **External verification (VIN-based history lookup)** — Why parked: PRD §Non-Goals.
- **Native apps (App Store / Google Play)** — Why parked: PRD §Non-Goals; MVP ships as a PWA only.
- **Social login (Google / Apple)** — Why parked: PRD §Non-Goals; email + password only for v1.
- **Report comparator (side-by-side reports)** — Why parked: PRD §Non-Goals.
- **"Deal-breaker" auto-disqualification system** — Why parked: PRD §Non-Goals; bounds liability of the helper-tool framing.
- **Fault weighting / weighted scoring** — Why parked: PRD §Non-Goals; all questions weighted equally (Business Logic).
- **Payments or subscriptions** — Why parked: PRD §Non-Goals; the 2-inspection cap is a demand signal, not a paywall.
- **Negotiation / pricing advice** — Why parked: PRD §Non-Goals; Veriffica structures the inspection only.
- **In-app support / help desk** — Why parked: PRD §Non-Goals; help is the static instruction + educational pop-ups.
- **Advanced error monitoring / observability** — Why parked: PRD §Non-Goals (non-functional) for the first MVP phase.
- **Multi-device real-time sync guarantee** — Why parked: PRD §Non-Goals; offline-first covers a single device reconciling with the central copy.

## Done

- **S-01: user can view a public home page describing the 5-part inspection, with log in / register actions.** — Archived 2026-06-13 → `context/archive/2026-06-13-public-home-page/`. Lesson: —.
- **S-02: user can see a tiled dashboard (Draft vs Completed), start a new inspection (with the startup instruction pop-up), resume or hard-delete a tile, and hit the 2-inspection-limit pop-up.** — Archived 2026-06-14 → `context/archive/2026-06-13-inspection-dashboard-lifecycle/`. Lesson: count-based DB-trigger limits aren't concurrency-safe; type-checked ESLint can crash on `.astro` frontmatter (see `context/foundation/lessons.md`).
- **F-02: (foundation) on-device store, Change Queue, background Last-Write-Wins sync, and the `@vite-pwa/astro` service-worker shell landed as the local-first persistence contract; one record survives a full offline → online cycle with no loss, and the app shell loads on a real offline reload.** — Archived 2026-06-14 → `context/archive/2026-06-11-offline-first-persistence-layer/`. Deferred check 4.8 (deployed workerd-parity smoke-test) closed by S-02. Lesson: verify Cloudflare Workers runtime parity on the live URL; SW is build-only — test with `wrangler dev` (see `context/foundation/lessons.md`).
- **F-01: (foundation) Supabase domain schema baseline landed with Row-Level Security enforcing per-account isolation; the first owner-private record persists and is provably invisible to other accounts.** — Archived 2026-06-14 → `context/archive/2026-06-10-domain-schema-rls-isolation/`. Established the snake_case migration + `owner_id = (select auth.uid())` RLS template every later table copies. Lesson: field casing — camelCase in app code, snake_case in Postgres, convert at one boundary (see `context/foundation/lessons.md`).
- **S-03: fill & validate Part 1 config and unlock Parts 2–5** — Archived 2026-06-15 → `context/archive/2026-06-14-part-1-config-validation/`. Lesson: —.
