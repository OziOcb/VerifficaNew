---
date: 2026-06-27T14:42:04+0100
researcher: OziOcb
git_commit: fb0e647bdc3a66ed97e9a4484dec23d7e78ca517
branch: main
repository: VerifficaNew
topic: "Sync-endpoint server-trust — does the server reject oversized / cross-field-invalid domain writes?"
tags: [research, codebase, sync-endpoint, validation, server-trust, risk-6]
status: complete
last_updated: 2026-06-27
last_updated_by: OziOcb
---

# Research: Sync-endpoint server-trust (Test Plan Phase 3, Risk #6)

**Date**: 2026-06-27T14:42:04+0100
**Researcher**: OziOcb
**Git Commit**: fb0e647bdc3a66ed97e9a4484dec23d7e78ca517
**Branch**: main
**Repository**: VerifficaNew

## Research Question

Risk #6 from `context/foundation/test-plan.md`: the sync endpoint trusts the
client and may accept oversized or cross-field-invalid domain writes (a note
over the limit; Electric + Manual transmission set together). Ground, in the
live codebase, **whether the sync endpoint validates domain input at all
today, and where the note limits / cross-field rules are actually enforced** —
so an integration test can prove the server boundary holds (or expose that it
does not). Scope: current-state grounding for test design; remediation design
is left to `/10x-plan`.

## Summary

**The server does not validate domain shape at all.** `POST /api/inspections/sync`
([sync.ts:23-59](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/pages/api/inspections/sync.ts#L23-L59))
performs auth (401), config (503), JSON-parse (400), strips the local-only
`synced` flag, **stamps `owner_id` from the session**, converts camelCase→snake_case,
and upserts the payload verbatim. There is no Zod parse, no length check, no
cross-field check. **That absence is the finding** — exactly what Risk #6's
"do NOT skip the case where the server does not validate at all" anticipates.

But "trusts the client" needs one precise qualifier for a fair test: **the
database is not fully defenceless.** Postgres enforces, via CHECK constraints
and column typing, five single-column value enums (`status`, `fuel_type`,
`transmission`, `drive`, `body_type`) and basic types (uuid / numeric(10,2) /
integer / boolean). A bad enum or a non-numeric `year` therefore comes back as
a supabase error → the endpoint returns **400**. So the test must distinguish:

| Attack class                                                                 | Enforced today? | By what                                                 |
| ---------------------------------------------------------------------------- | --------------- | ------------------------------------------------------- |
| Invalid enum (e.g. `status:"bogus"`, `fuelType:"rocket"`)                    | **Yes**         | DB CHECK → 400                                          |
| Wrong scalar type (e.g. `year:"abc"`)                                        | **Yes**         | DB column type → 400                                    |
| Cross-owner write (`ownerId` spoof)                                          | **Yes**         | endpoint stamps `owner_id` + RLS (already tested)       |
| **Oversized text** (`globalNotes` > 10 000; `notes` > 1 000)                 | **No**          | columns are unbounded `text`                            |
| **Cross-field invalid** (CF-1: electric + non-automatic)                     | **No**          | each value is individually valid; no multi-column CHECK |
| Numeric out-of-range (negative `price`, absurd `mileage`/`year`/`doorCount`) | **No**          | only `numeric(10,2)` precision; no range CHECK          |

The two cases named in Risk #6 — **oversized note** and **Electric+Manual** —
both fall in the unenforced band. They are the high-signal test targets: each
is a domain rule the client validates, the server forwards untouched, and the
DB happily accepts.

**One scoping correction for the test:** the "limits" are _three distinct
rules_, not one, and only two are testable today:

- `globalNotes` — **10 000-char** cap, FR-010, enforced app-side only
  ([SessionScreen.tsx:30](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/components/inspections/SessionScreen.tsx#L30)). **Built — testable.**
- Part 1 `notes` — **1 000-char** cap, enforced app-side only
  ([part1-config.ts:172](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/lib/part1-config.ts#L172)). **Built — testable.**
- Per-question contextual note — **500-char** cap, FR-018. **NOT BUILT** (the
  question-card feature ships with S-05/S-06). The test plan's "500-char"
  reference is aspirational; do not invent a test for a field that has no
  column or code yet.

## Detailed Findings

### A. The server boundary: what it checks, what it forwards

`src/pages/api/inspections/sync.ts` is the **only** server write path that
accepts a client payload. The full validation surface:

- `503` if `createClient()` returns null (env unset) — [sync.ts:25](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/pages/api/inspections/sync.ts#L25)
- `401` if no cookie session (`context.locals.user`) — [sync.ts:27-28](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/pages/api/inspections/sync.ts#L27-L28)
- `400` "Invalid JSON body" on parse failure — [sync.ts:30-35](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/pages/api/inspections/sync.ts#L30-L35)
- `delete`: RLS-scoped delete, `204` — [sync.ts:37-42](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/pages/api/inspections/sync.ts#L37-L42)
- `put`: strip `synced`, stamp `ownerId: user.id`, `snakecaseKeys(...)`, upsert, `.select().single()`, return camelCased row — [sync.ts:48-59](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/pages/api/inspections/sync.ts#L48-L59)
- DB error from the upsert → `400` with `error.message` — [sync.ts:57](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/pages/api/inspections/sync.ts#L57)

`grep "Zod\|schema\|validate\|parse"` against the endpoint returns nothing.
The `SyncOp` `interface` (TS-only, [sync.ts:17-21](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/pages/api/inspections/sync.ts#L17-L21))
provides compile-time shape but **zero runtime guarantees** — `body` is a bare
cast of `request.json()`.

Key consequence for the test: a 400 can come from the **DB** (enum/type
violation), not from the endpoint. The interesting Risk #6 cases (oversized,
CF-1) produce a **200** today because nothing rejects them — _the test should
assert the failure that proves the gap (a 200 + persisted bad row), then will
flip to asserting a 4xx once server validation is added in the plan phase._

### B. Client-side validators the server does not mirror (the oracle)

All live in the browser and are bypassable via devtools / a direct POST:

- **CF-1 (Electric + Manual)** — object-level Zod refine:
  `!(d.fuelType === "electric" && d.transmission !== "automatic")`, message
  "Electric cars must use Automatic transmission.", surfaced on `transmission`
  — [part1-config.ts:179-182](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/lib/part1-config.ts#L179-L182).
  The code comment confirms the trap: _"electric + manual are each individually
  valid"_ — which is precisely why the DB enum CHECKs let it through.
- **Part 1 `notes` ≤ 1 000** — [part1-config.ts:169-173](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/lib/part1-config.ts#L169-L173).
- **`globalNotes` ≤ 10 000** — hand-rolled `overLimit` gate, not Zod —
  [SessionScreen.tsx:30-31](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/components/inspections/SessionScreen.tsx#L30-L31), [SessionScreen.tsx:79](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/components/inspections/SessionScreen.tsx#L79).
- Other Part 1 field bounds (also server-unmirrored): `make` ≤ 50, `model` ≤
  60, `color` ≤ 40, `address` 5–150, `registrationNumber` regex,
  `vin` 17-char regex, `year` 1886–currentYear, `mileage` 0–9 999 999,
  `price` 0–99 999 999.99, `doorCount` 0–7 — [part1-config.ts:134-173](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/lib/part1-config.ts#L134-L173).
  These are secondary; Risk #6 names only oversized-note and CF-1, so keep the
  test focused there (an extra negative-price case is a cheap bonus if desired).

### C. Database enforcement (migrations + live probe)

Probed the running local Supabase (`postgresql://postgres:postgres@127.0.0.1:54322`,
container `supabase_db_10x-astro-starter`); `information_schema.columns` and
`pg_constraint` match the migrations exactly, and `src/db/database.types.ts`
corroborates.

- **Enums enforced** (single-column CHECKs): `status in ('draft','completed')`
  ([create_inspections.sql:32](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/supabase/migrations/20260610181920_create_inspections.sql#L32));
  `fuel_type`, `transmission`, `drive`, `body_type`
  ([inspections_part1_config.sql:26-32](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/supabase/migrations/20260615120000_inspections_part1_config.sql#L26-L32)).
- **No length caps:** every text column (`name`, `notes`, `global_notes`,
  `address`, `make`, `model`, `vin`, …) is bare `text` (`character_maximum_length
= NULL`), no `varchar(N)`, no length CHECK. The migration header states this
  by design: _"The 10,000-char limit on global_notes is enforced app-side …
  not a DB CHECK"_ ([inspections_session_fields.sql:19-20](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/supabase/migrations/20260617120000_inspections_session_fields.sql#L19-L20)).
- **No cross-field CHECKs:** zero multi-column constraints — nothing ties
  `fuel_type='electric'` to `transmission`. Confirmed: `pg_constraint` returns
  exactly 7 rows (1 PK, 1 FK, 5 enum CHECKs).
- **No numeric range CHECKs:** `price numeric(10,2)` caps precision only;
  `year`/`mileage`/`door_count` are bare `integer` (negatives accepted).
- DB also enforces ownership (RLS, 4 owner policies) and the 2-per-owner
  cardinality cap (BEFORE INSERT trigger) — both govern _who/how-many_, not
  _domain shape_, and both are already covered by existing tests.

### D. How the payload reaches the server (tamper surface)

- `saveInspection()` read-merges the existing row + caller fields into a
  complete `Inspection` and enqueues `{op, entityId, payload: row}` to the
  Dexie `changeQueue` outbox — [sync.ts (lib):101-133](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/lib/sync.ts#L101-L133); outbox shape at [db.ts:20-31](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/lib/db.ts#L20-L31).
- `drainQueue()` POSTs the payload **verbatim** to `/api/inspections/sync` —
  [sync.ts (lib):169-173](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/lib/sync.ts#L169-L173).
  No validation before enqueue or before POST.
- A direct `fetch` to the endpoint (curl / devtools) bypasses every client
  validator — exactly the abuse lens Risk #6 assumes.
- `POST /api/inspections/create` is **not** a tamper surface: it accepts no
  client payload, hard-codes `status:'draft'` + a generated name, returns only
  the new `id` — [create.ts:17-40](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/pages/api/inspections/create.ts#L17-L40).
  So `sync.ts` is the sole endpoint worth testing for server-trust.

## Code References

- `src/pages/api/inspections/sync.ts:23-59` — the only validatable write boundary; no domain checks
- `src/pages/api/inspections/sync.ts:48-49` — owner_id stamping + snakecase transform (the only server-authority step)
- `src/lib/part1-config.ts:179-182` — CF-1 cross-field rule (client-only oracle)
- `src/lib/part1-config.ts:169-173` — Part 1 `notes` ≤ 1 000 (client-only)
- `src/components/inspections/SessionScreen.tsx:30,79` — `globalNotes` ≤ 10 000 (client-only)
- `supabase/migrations/20260615120000_inspections_part1_config.sql:26-32` — the 4 Part-1 enum CHECKs (DB does enforce these)
- `supabase/migrations/20260610181920_create_inspections.sql:32` — `status` enum CHECK
- `src/lib/sync.ts:169-173` — client POSTs payload verbatim
- `src/lib/db.ts:20-31` — `changeQueue` outbox stores payload verbatim
- `tests/inspections.sync.test.ts` — existing endpoint test (auth/owner-scoping/casing); the new test extends this harness

## Architecture Insights

- **Intentional layered split, by design.** The migration headers and
  `lessons.md` "Field casing" lesson both state the explicit convention:
  _required-ness and full validity live in app-side Zod; the DB carries only
  enums + types + RLS + the cardinality cap._ Risk #6 is the seam in that
  split — domain validity was never placed at the server boundary, only at the
  client and (partially) the DB. The test exposes that seam.
- **The endpoint already proves it does not trust the client for _identity_.**
  It overwrites `ownerId` from the session ([sync.ts:49](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/src/pages/api/inspections/sync.ts#L49)),
  and the existing test asserts a spoofed `ownerId` is ignored
  ([inspections.sync.test.ts:74-105](https://github.com/OziOcb/VerifficaNew/blob/fb0e647bdc3a66ed97e9a4484dec23d7e78ca517/tests/inspections.sync.test.ts#L74-L105)).
  The gap is that this distrust stops at identity and never extends to _content_.
- **Test-harness pattern is ready-made.** `tests/inspections.sync.test.ts`
  mocks `@/lib/supabase` to inject a real signed-in anon client (JWT → RLS
  applies), imports the route handler after the mock, and drives it with a fake
  `APIContext`. The new oversized/CF-1 cases slot directly into this file (or a
  sibling) — no new infrastructure. This matches Cookbook §6.4.
- **Mind the 400 ambiguity.** Because the DB returns enum/type violations as
  errors that the endpoint maps to 400, a naive "assert 400" test could pass
  for the _wrong reason_ (DB caught it) and give false confidence that the
  _server_ validates. The oversized-note and CF-1 cases avoid this trap: today
  they return **200** (nothing rejects them), so the test first documents the
  gap, then the plan adds server validation and the assertion flips to 4xx.

## Historical Context (from prior changes)

- `context/archive/2026-06-11-offline-first-persistence-layer/research.md:82-95`
  — Decision #2 that defined the endpoint's five responsibilities (401, strip
  `synced`, stamp `owner_id`, casing convert, put/delete). Domain validation
  was deliberately **not** among them; server authority was scoped to identity
  - casing only. This is the design the endpoint comment cites as "research
    Decision #2".
- `context/foundation/lessons.md:24-45` ("Field casing") — mandates the single
  snake↔camel boundary at the sync endpoint; the endpoint's transform line is
  the realization of this lesson. Relevant because any added server validation
  must sit on the **camelCase app side** of that boundary (before snakecasing).
- `context/foundation/lessons.md:113-133` ("BEFORE INSERT trigger fires on
  upsert") — confirms every sync write is `INSERT … ON CONFLICT DO UPDATE`;
  any DB-level constraint added later fires on edits too. Informs remediation
  (plan phase), not this test.
- `context/foundation/prd.md` FR-012 ("strict field-by-field validation … and
  cross-field blocks (e.g. Electric + Manual)"), FR-010 (10 000-char global
  notes), FR-018 (500-char per-question note) — the requirement the server is
  accused of not meeting. CF-1 definition: `idea/veriffica-part-1-validation-rules.md` §6.
- Phase-doc structure mirrored from
  `context/archive/2026-06-22-testing-visibility-engine-hardening/` and
  `context/archive/2026-06-24-testing-offline-durability/` (change.md →
  research.md → plan.md w/ Progress → reviews).

## Related Research

- `context/archive/2026-06-11-offline-first-persistence-layer/research.md` — sync endpoint origin (Decision #2/#3)
- `context/changes/testing-offline-durability/` — Phase 2, same test-rollout chain, same endpoint harness

## Open Questions

1. **Assertion polarity for the test** (plan-phase decision): write the test to
   assert the _current_ gap (200 + bad row persists) as a documented red, or
   write it red-against-future (assert 4xx) so it fails until server validation
   lands? The test plan's anti-pattern guidance ("the absence is the finding")
   favors making the gap explicit and visible. → for `/10x-plan`.
2. **Where server validation should live** (Zod at endpoint on the camelCase
   side vs DB length/cross-field CHECKs vs both) — explicitly out of scope here
   (current-state grounding only); this is the core `/10x-plan` decision.
3. The 500-char per-question note (FR-018) is unbuilt — confirm it is deferred
   to the S-05/S-06 change chain and **not** tested in this phase.
