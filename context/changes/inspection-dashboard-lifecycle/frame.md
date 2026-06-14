# Frame Brief: S-02 dashboard + inspection lifecycle — what's the right scope to plan?

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

S-02 is roadmapped as a self-contained vertical slice — a tiled dashboard
(Draft/Completed), start + resume + hard-delete, and a 2-inspection limit —
with prerequisites listed as only F-01 + F-02 (both implemented). The S-02
research (`research.md`) surfaced three "structural gaps" and named building a
**server→local hydrate/list path** the "single biggest design decision / GAP 3."

## Initial Framing (preserved)

- **User's stated cause or approach**: Build S-02 from the roadmap on F-01/F-02;
  the roadmap treats it as routine CRUD that exercises both foundations end-to-end.
- **User's proposed direction**: Frame before planning — the research's open
  questions smell like scope/sequencing, not pure implementation detail.
- **Pre-dispatch narrowing**: Lead concern = _"not sure / all entangled — tell me
  which one forces the others."_ Resume target = _placeholder is acceptable_.
  Auto-naming = _defer to S-03_.

## Dimension Map

Where the framing "S-02 is straightforward CRUD on F-01/F-02" could break:

1. **Slice boundary (resume target + auto-naming)** — depends on S-03/S-04, which
   don't exist. ← initial framing leaned here; user defused it (placeholder resume +
   deferred naming both acceptable).
2. **Read model** — SSR-render the list (online) vs hydrate Dexie (offline-first).
   No server→local read path exists today; F-02 is push-only. ← suspected crux.
3. **Limit enforcement** — DB trigger (needs no read) vs endpoint/client guard
   (needs a count read). Looked _entangled_ with #2.
4. **Delete/mutation helper** — plumbing exists, helper missing. Pure
   implementation, not a framing breaker.

## Hypothesis Investigation

| Hypothesis                                                                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                       | Verdict                              |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| #2: Dashboard must be **offline-first**, so S-02 must build a server→local hydrate path (research's "GAP 3") | PRD offline clauses (FR-023 `prd.md:166`, US-03 `prd.md:109-118`, NFR §offline `prd.md:176-177`, Guardrail `prd.md:74-76`) are **all** scoped to "an inspection in progress" (Part 1/answers/notes/status/progress/Change Queue). None names dashboard/list/tiles. Roadmap puts offline survival in **S-08** (prereqs F-02 **+ S-05**, `roadmap.md:56,202-212`), not S-02. FR-006 (`prd.md:132`) carries no offline qualifier. | **NONE** (hydrate path not required) |
| #2 (alt): Dashboard is a **server-rendered online read** under RLS                                           | `.astro` frontmatter can call `createClient(Astro.request.headers, Astro.cookies)` and `from("inspections").select()` under RLS — the exact pattern middleware already uses (`src/middleware.ts:6-16`, `src/lib/supabase.ts:6-25`, RLS at `...create_inspections.sql:62-66`). Independent (no-preconception) agent landed here unprompted.                                                                                     | **STRONG**                           |
| #3: 2-limit belongs **server/DB-authoritative**, decoupled from the read                                     | A `BEFORE INSERT` trigger counting `owner_id` rows mirrors the established `set_updated_at` trigger (`...create_inspections.sql:19-26,42-45`); migration comment explicitly defers the limit to S-02 (`:13-14`). Client Dexie count is per-device/stale → unreliable. Trigger also catches a sync-time overflow.                                                                                                               | **STRONG**                           |
| #1: Slice boundary is wrong (resume/auto-naming entanglement forces a re-cut)                                | Resume screens (S-03/S-04) don't exist, and auto-name needs S-03 columns — but user accepts a placeholder resume + free-text `name` now; S-08 (offline) is the only hard downstream dep and it's correctly sequenced off S-05.                                                                                                                                                                                                 | **WEAK** (defused)                   |
| #4: Missing `deleteInspection` helper                                                                        | `src/lib/sync.ts` exports no delete; endpoint+outbox already handle `op:"delete"` (`sync.ts:37-42,111-118`).                                                                                                                                                                                                                                                                                                                   | n/a — implementation, not framing    |

## Narrowing Signals

- The "entanglement" was an artifact of one unstated assumption — _the dashboard must
  work offline_. The PRD does not require that (verbatim scope = the active inspection).
  Remove it and #2 (read) and #3 (limit) become **independent**, each with a natural
  convention-matching answer.
- The independent cross-system probe (Step 5, hypothesis not named) converged on the
  same SSR-read + DB-trigger architecture — confidence-raising, not confirmation bias.
- User's own narrowing (placeholder resume, defer auto-naming) already collapsed the
  slice-boundary dimension.

## Cross-System Convention

This stack is **SSR-server-authoritative**: RLS enforces isolation in Postgres, the
SSR client reads per-user data at render, and triggers govern row invariants. Reading
the dashboard server-side and enforcing the cap in a trigger both match how the
codebase already works. Dexie is the **optimistic write** layer (outbox), not a read
cache — using it as a dashboard read source would invent a new pattern the project
doesn't otherwise use.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: build S-02 as an **online, server-rendered
> read surface + lifecycle mutations** — SSR the inspection list under RLS, enforce the
> 2-per-owner cap with a DB `BEFORE INSERT` trigger, and wire create/delete through the
> existing F-02 push path — **explicitly NOT building a server→local hydrate path**,
> because the dashboard is not an offline-first surface (offline is scoped to the
> in-inspection flow, S-05→S-08).

The research framed the missing pull/hydrate path as S-02's central design decision.
That is a misframe: the PRD never asks the dashboard to work offline, so building the
"pull half of sync" now is scope creep that would also force the harder
SSR-read-vs-Dexie-read reconciliation. Dropping it makes read model (SSR) and limit
(DB trigger) independent, each solvable with an existing convention. The slice stays
self-contained with a placeholder resume target and free-text naming.

## Confidence

**HIGH** — verbatim PRD evidence scopes offline to the active inspection; the roadmap's
own S-08 sequencing agrees; an independent probe converged on the same architecture; and
both leading approaches match established codebase conventions.

## What Changes for /10x-plan

- **Do NOT build a server→local list/hydrate path** (research GAP 3 is out of scope).
  Read the dashboard list via SSR in `dashboard.astro` frontmatter under RLS.
- **Enforce the 2-limit in a DB trigger** (new migration, `set_updated_at` pattern),
  server-authoritative; surface the limit pop-up from the count the SSR page already has.
- **Open sub-question for the plan (mutation path):** because the limit is a trigger, an
  _offline-created_ 3rd inspection would persist locally then fail at sync — poor UX.
  The plan should decide whether **create/delete go through a synchronous online server
  call** (immediate limit feedback) vs the optimistic outbox. (Offline-first creation of
  a brand-new inspection has little value; the offline case that matters is _answering an
  existing_ inspection — S-05.) This is a /10x-plan decision, not a framing one.
- Still in scope per research: add a `deleteInspection` helper, delete the throwaway
  `/offline-demo` + `OfflineDemo.tsx`, hook a signout Dexie-wipe, push the F-01 migration
  to hosted Supabase, and close F-02 check 4.8.

## References

- Research: `context/changes/inspection-dashboard-lifecycle/research.md`
- PRD offline scope: `context/foundation/prd.md:166,109-118,176-177,74-76`; FR-006 `:132`
- Roadmap S-02 vs S-08: `context/foundation/roadmap.md:56,127-139,202-212`
- SSR read pattern: `src/middleware.ts:6-16`, `src/lib/supabase.ts:6-25`
- Trigger + RLS pattern: `supabase/migrations/20260610181920_create_inspections.sql:13-26,42-45,62-85`
- Push-only sync layer: `src/lib/sync.ts`, `src/pages/api/inspections/sync.ts`
- Investigation tasks: #5 (PRD offline scope), #6 (independent read+limit architecture)
