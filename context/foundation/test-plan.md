# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-23

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (single source root;
excludes `node_modules`, `dist`, `.astro`).

**Scope note — built vs. not-built.** As of writing, foundations and the
shipped slices (F-01, F-02, S-01–S-04) carry real test coverage; the core
interaction loop being built next — **S-05 answering, S-06 summary/scoring/
finalize, S-07 Smart Pruning** — is unbuilt and untested. This rollout
targets _built, under-tested, high-risk_ surfaces now and pre-declares the
pruning/scoring test intent (§2 Risk Response Guidance) so it becomes
non-negotiable when those slices ship. It does not invent tests for code
that does not yet exist.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives."

| #   | Risk (failure scenario)                                                                                                               | Impact | Likelihood | Source (evidence — not anchor)                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Answers/notes written offline mid-inspection vanish or fail to sync on reconnect (flow-level, multiple writes)                        | High   | Med-High   | interview Q1; PRD FR-023/US-03; roadmap S-08; hot-spot dir `src/lib/` (sync churn)                                                |
| 2   | Visibility engine emits the **wrong** question set for a config (missing or extra groups) → the checklist silently misleads the buyer | High   | Med        | interview Q3; PRD FR-014; roadmap S-04; existing `questions` test is happy-path-weighted                                          |
| 3   | Smart Pruning drops still-valid answers / keeps orphans / miscomputes score on a config change                                        | High   | High       | interview Q4; PRD FR-016/US-02 (PRD flags "bug-prone") — **S-07 not built; see Phase 1 proxy**                                    |
| 4   | Yes/No/Don't-know distribution or Total Score miscounts (counts unanswered, wrong per-part split)                                     | High   | Med        | PRD FR-019/FR-020; roadmap S-06 (north star) — **S-06 not built; deferred**                                                       |
| 5   | An SSR endpoint / service worker / env access diverges on deployed workerd vs `astro dev` → silent production breakage                | High   | Med        | interview Q2; `lessons.md` (workerd parity); roadmap F-02 deploy notes                                                            |
| 6   | The sync endpoint trusts the client — accepts oversized or cross-field-invalid domain writes (note over limit, Electric+Manual)       | Med    | Med        | PRD FR-012; PRD §Business Logic; abuse lens (untrusted input); existing sync test covers auth/owner-scoping, not input validation |

Order: protect High × High first (#3, proxied by Phase 1), then the High ×
Med-High offline flow (#1). #4 is High-impact but its slice (S-06) is
unbuilt — deferred, not padded. #5 is High-impact but belongs to a deployed
smoke-test gate, not a unit test (see §3 Phase 4).

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                       | Must challenge                                                                   | Context `/10x-research` must ground                                                                         | Likely cheapest layer                                                 | Anti-pattern to avoid                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| #2   | A given car config yields _exactly_ the groups the authored question catalogue says — no missing, no extra — across the axis (fuel/transmission/drive/body) + runtime-flag matrix | "the engine already has a test, so it's covered" (the test is happy-path)        | the additive visibility model's source-of-truth catalogue; how runtime flags layer onto the config axes     | unit (pure function) + automated reconciliation against the catalogue | oracle problem: asserting the engine's _own output_ instead of the independently-authored catalogue                   |
| #1   | Several offline answers plus a note survive offline → reload → reconnect with zero loss; the Change Queue drains in order                                                         | "F-02's single-record round-trip proves the whole flow"                          | Change Queue seq/FIFO under multiple ops; partial-failure retry; what triggers the drain                    | integration (Dexie + outbox, no network) + extend the offline e2e     | happy-path-only (one record); treating a final 200 as proof every op landed                                           |
| #6   | The server rejects oversized / cross-field-invalid payloads even when the client validator is bypassed                                                                            | "client-side validation is enough" — the server must not trust the client        | whether the sync endpoint validates domain input at all today; where the 10k / 500-char limits are enforced | integration (endpoint)                                                | re-testing the client validator; skipping the case where the server does _not_ validate (that absence is the finding) |
| #5   | `/api/inspections/{create,sync}` and the SW behave identically on the deployed Worker as locally                                                                                  | "builds clean = runs on workerd"                                                 | which transitive deps reach for Node APIs; the secret/env access path                                       | deployed smoke-test / CI gate (**not** a unit test)                   | mocking workerd away — the real runtime _is_ the risk                                                                 |
| #3   | _(proxied via #2 until S-07 ships)_ pruning keeps valid answers, drops orphans, recomputes progress/score                                                                         | "pruning is correct if the visibility set is" — it needs a trustworthy set first | deferred to S-07's own change chain                                                                         | unit, when built                                                      | writing tests for code that does not exist yet                                                                        |
| #4   | _(deferred until S-06 ships)_ distribution counts only answered questions; correct per-part and global split                                                                      | equal weighting is trivial, but the per-part split has edge cases                | deferred to S-06's own change chain                                                                         | unit, when built                                                      | inventing scoring code in order to test it                                                                            |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                       | Goal (one line)                                                                                                                | Risks covered   | Test types                      | Status       | Change folder                                                   |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------- | ------------------------------- | ------------ | --------------------------------------------------------------- |
| 1   | Visibility-engine hardening      | Prove engine output matches the authored catalogue across the axis+flag matrix — a trustworthy oracle for future Smart Pruning | #2 (proxies #3) | unit + catalogue reconciliation | complete     | context/archive/2026-06-22-testing-visibility-engine-hardening/ |
| 2   | Offline durability at flow level | Multiple offline answers + a note survive offline → reload → reconnect; the queue drains in order                              | #1              | integration + e2e               | implementing | context/changes/testing-offline-durability/                     |
| 3   | Sync-endpoint server-trust       | The server boundary rejects malformed / oversized domain writes regardless of the client                                       | #6              | integration                     | not started  | —                                                               |
| 4   | workerd deployed smoke-gate      | A repeatable deployed `wrangler tail` smoke of sync/create + SW load, wired as a gate                                          | #5              | deployed smoke / CI gate        | not started  | —                                                               |

**Status vocabulary** (fixed — parser literals):

| Value           | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `not started`   | No change folder for this rollout phase yet.                        |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched`    | `research.md` exists in the change folder.                          |
| `planned`       | `plan.md` exists with a `## Progress` section.                      |
| `implementing`  | Progress has at least one `[x]` and at least one `[ ]`.             |
| `complete`      | Progress is fully `[x]`.                                            |

Order rationale: Phase 1 is the cheapest layer, addresses the highest user
anxiety (interview Q3), and de-risks the High × High Smart Pruning risk (#3)
before that slice is built. Phase 2 protects the #1 stated fear, extending
F-02's baseline rather than bootstrapping. Phase 3 is a small built abuse
surface. Phase 4 locks the floor against the dev/prod divergence the team
has been burned by.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                          | Tool                                 | Version | Notes                                                                                                                         |
| ------------------------------ | ------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| unit + integration             | Vitest                               | ^4.1.8  | `npm test` → `vitest run`; suite under `tests/` (RLS, sync, limit, validation, visibility, routes)                            |
| e2e                            | Playwright                           | ^1.60.0 | `npm run test:e2e`; builds + serves via `wrangler dev` for the offline round-trip (SW is build-only — see `lessons.md`)       |
| API / endpoint tests           | Vitest + Astro SSR handlers          | ^6.3.1  | endpoints tested by invoking the route handler under a session; no browser Supabase client                                    |
| local store                    | Dexie (fake-indexeddb in tests)      | ^4.4.3  | `db` test round-trips the on-device store + Change Queue                                                                      |
| PWA / service worker           | @vite-pwa/astro                      | ^1.2.0  | SW emitted only by `astro build`; exercise with `wrangler dev`, never `astro dev`                                             |
| accessibility                  | none yet                             | —       | not in scope for this rollout (see §7)                                                                                        |
| (optional) AI-native / runtime | Playwright MCP — checked: 2026-06-22 | n/a     | available as a verification layer for the future answer-card flow; do not use where a deterministic integration test suffices |

**Stack grounding tools (current session):**

- Docs: Context7 — available; use for current Astro 6 / Supabase / Vitest 4 / Playwright / Dexie / `@vite-pwa/astro` test APIs; checked: 2026-06-22
- Search: Exa.ai — available; use for current PWA/offline testing guidance and tool-status checks, then prefer official docs; checked: 2026-06-22
- Runtime/browser: Playwright MCP — available; possible verification layer for the answer-card flow (Phase 2+); not used for code anchors; checked: 2026-06-22
- Provider/platform: Supabase / Cloudflare / GitHub / Linear MCPs — available; relevant to Phase 4 (deployed smoke via Cloudflare/`wrangler tail`) and RLS log inspection; checked: 2026-06-22

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                                                              | Where                | Required?                 | Catches                                                               |
| ----------------------------------------------------------------- | -------------------- | ------------------------- | --------------------------------------------------------------------- |
| lint + typecheck (`astro sync` → ESLint type-checked → build)     | local + CI           | required                  | syntactic / type drift; React Compiler violations                     |
| unit + integration (`npm test`)                                   | local + CI           | required                  | logic regressions (RLS, sync, validation, visibility engine)          |
| e2e offline round-trip (`npm run test:e2e`)                       | local + CI           | required after §3 Phase 2 | broken offline persistence / sync flow                                |
| visibility-catalogue reconciliation                               | local + CI           | required after §3 Phase 1 | engine drift vs the authored question catalogue                       |
| sync-endpoint input validation                                    | local + CI           | required after §3 Phase 3 | server accepting malformed/oversized domain writes                    |
| deployed workerd smoke (`wrangler tail` on sync/create + SW load) | between merge + prod | required after §3 Phase 4 | runtime divergence that builds clean but fails on the deployed Worker |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, it reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Location**: `tests/<area>.test.ts` (flat under `tests/`).
- **Naming**: `<area>.test.ts`; pure-logic units (e.g. the visibility engine, Part 1 validation).
- **Reference test**: `tests/questions.test.ts` (visibility engine), `tests/part1-config.test.ts` (validation).
- **Run locally**: `npm test`.
- Pattern detail TBD — see §3 Phase 1 for the engine-vs-catalogue reconciliation pattern.

### 6.2 Adding an integration test

- **Mocking policy**: only mock at the network/DB edge (`fake-indexeddb` for Dexie, session injection for endpoints). Never mock internal modules.
- **Reference test**: `tests/db.test.ts` (Dexie store), `tests/inspections.sync.test.ts` (sync endpoint).
- **Run locally**: `npm test`.
- Offline-flow detail TBD — see §3 Phase 2; server-trust detail TBD — see §3 Phase 3.

### 6.3 Adding an e2e test

- **Location**: `tests/e2e/<flow>.spec.ts`.
- **Reference test**: `tests/e2e/offline-roundtrip.spec.ts`.
- **Run locally**: `npm run test:e2e` (builds + serves via `wrangler dev`; SW is build-only).
- Multi-write offline pattern TBD — see §3 Phase 2.

### 6.4 Adding a test for a new API endpoint

- **Test type**: integration (preferred).
- **Pattern**: invoke the Astro route handler under a stubbed session; assert response shape AND the owner-scoped DB side-effect. No browser Supabase client.
- **Reference test**: `tests/inspections.sync.test.ts`, `tests/inspections.rls.test.ts`.
- Server-side validation parity pattern TBD — see §3 Phase 3.

### 6.5 Adding a deployed smoke-test

- TBD — see §3 Phase 4 (`wrangler tail` against the live Worker; see `lessons.md` "Verify Cloudflare Workers runtime parity").

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the phase taught.)

## 7. What We Deliberately Don't Test

Exclusions for this rollout. The team stated no explicit no-go zone
(interview Q5: "I don't know"); the items below are proposed defaults —
re-confirm if budget tightens or the assumption changes.

- **Vendored shadcn/ui primitives** (`src/components/ui`) — the upstream library is the test; we test our composition, not the primitives. Re-evaluate if we fork/customize a primitive's behavior. (Source: proposed default; interview Q5 unanswered.)
- **Marketing / public home page snapshots** — visual snapshots break constantly and catch little; covered by lint/build only. Re-evaluate if the home page gains interactive logic. (Source: proposed default.)
- **Settings: theme + font size (S-10)** — low blast radius, eyeball it. Re-evaluate if settings start gating domain behavior. (Source: proposed default.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-22
- Stack versions last verified: 2026-06-22
- AI-native tool references last verified: 2026-06-22

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (e.g. **S-05/S-06/S-07 ship** — the deferred scoring/pruning/answering risks then become buildable test targets),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
