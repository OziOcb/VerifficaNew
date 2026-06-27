# Sync-endpoint Server-Trust — Implementation Plan

## Overview

Close the server-trust gap on `POST /api/inspections/sync` (Test Plan Phase 3,
Risk #6). Today the endpoint upserts the client payload **verbatim** — no domain
validation — so a caller bypassing the browser validators (curl / devtools) can
persist an oversized notes document or a cross-field-invalid config (Electric +
Manual). We add a **targeted, app-side validation guard** at the sync boundary
that rejects the unsafe bands the client already blocks, reusing the existing
validators as the single source of truth, and **prove it with integration
tests** that drive the real handler under RLS.

## Current State Analysis

- `POST /api/inspections/sync` ([sync.ts:23-59](../../../src/pages/api/inspections/sync.ts)) does auth (401), config (503), JSON-parse (400), strips the local-only `synced` flag, stamps `owner_id` from the session, `snakecaseKeys`, and upserts. **No Zod parse, no length check, no cross-field check.** `SyncOp` is a compile-time `interface` only; `body` is a bare cast of `request.json()`.
- The DB enforces single-column enums (`status`, `fuel_type`, `transmission`, `drive`, `body_type`) and scalar types → those bad writes already come back as a supabase error → 400. It does **not** enforce text length, cross-field rules, or numeric ranges (every text column is bare `text`; no multi-column CHECK).
- The two Risk #6 cases — **oversized note** and **Electric + Manual** — fall entirely in the unenforced band: today they return **200** and persist.
- The oracle already exists and is server-safe: `part1-config.ts` is camelCase throughout, imports only `zod`, and reads the year lazily (workerd-safe). It holds the CF-1 refine ([part1-config.ts:179-182](../../../src/lib/part1-config.ts)) and the Part-1 `notes ≤ 1000` rule ([part1-config.ts:169-173](../../../src/lib/part1-config.ts)). The `globalNotes ≤ 10000` cap + message live as local literals in the React island ([SessionScreen.tsx:30-31](../../../src/components/inspections/SessionScreen.tsx)).
- The sync endpoint legitimately receives **partial** payloads: a fresh draft has no config; a session update may carry only `{ id, globalNotes }`. `part1ConfigSchema` is all-or-nothing (requires `make`/`model`, input = raw strings via `rowToInput`), so it **cannot** be run wholesale on every sync write without rejecting valid partial saves.
- Test harness is ready-made: [tests/inspections.sync.test.ts](../../../tests/inspections.sync.test.ts) mocks `@/lib/supabase` to inject a real signed-in anon client (JWT → RLS applies), imports the route handler after the mock, and drives it through a fake `APIContext`.

### Key Discoveries:

- The endpoint already distrusts the client for **identity** (overwrites `ownerId`, [sync.ts:49](../../../src/pages/api/inspections/sync.ts)) but never for **content** — that's the seam Risk #6 names.
- `globalNotes` is **not** part of `part1ConfigSchema` — it needs its own shared constant/message (currently duplicated as island literals).
- FR-018's 500-char per-question note is **permanently out of scope** as a server field: per FR-018 it is _appended into the global notes document_, so its persisted form is `global_notes` — already covered by the `globalNotes ≤ 10000` case. It is not "deferred to retest after S-05."
- A 4xx for the two named cases proves the **server** guard specifically (the DB enforces neither), avoiding the "400 ambiguity" where a DB enum/type violation could pass a naive assertion for the wrong reason.

## Desired End State

A direct POST to `/api/inspections/sync` that bypasses the browser validators is
**rejected with 400** (and the row is not persisted) when it carries an oversized
`globalNotes`, an oversized Part-1 `notes`, or an Electric + non-Automatic
config — using the same user-facing messages the client shows. Legitimate
partial/draft writes still succeed (200). The behavior is locked by integration
tests in the existing sync harness, and the length/cross-field rules have a
single definition shared by client and server.

Verify: `npm test` passes including the new sync cases; a manual curl of an
oversized payload against `npm run dev` returns 400 with the message and writes
no row.

## What We're NOT Doing

- **No DB-level constraints / migration** — validation stays app-side at the sync boundary (honors the deliberate "DB carries only enums + types + RLS" design; lessons.md "Field casing").
- **No full Part-1 server validation** — we do not enforce required-field completeness or every field bound at the endpoint; the client + the unlock gate still own full validity. The guard only blocks the specific unsafe bands Risk #6 names.
- **No numeric-range guards** (negative price, out-of-range year/mileage/doorCount) — flagged by research as a cheap bonus, deferred to keep this phase scoped to the named risk.
- **No 422 / new status code** — reuse the endpoint's existing 400 convention; the client `drainQueue` need not learn a new code.
- **No FR-018 500-char per-question note test** — permanently out of scope as a server field (see Key Discoveries).
- **No change to `POST /api/inspections/create`** — it accepts no client payload, so it is not a tamper surface.

## Implementation Approach

Two phases. **Phase 1** is a pure refactor: lift the length caps, the CF-1
predicate, and the relevant messages out of `part1-config.ts` (and the island)
into shared, server-importable exports — no behavior change, existing tests stay
green. **Phase 2** adds a small validation guard that the endpoint runs on the
camelCase payload **before** snakecasing, rejecting present-field violations with
400 + the shared messages, and extends the sync test file to prove each
rejection (and that valid partial writes still pass).

## Critical Implementation Details

- **Ordering / casing**: the guard MUST run on the **camelCase** row (after stripping `synced`, before `snakecaseKeys`) and only on the `put` branch. This keeps all validation on the app side of the single casing boundary (lessons.md "Field casing").
- **Present-field semantics**: the guard inspects only keys actually present in the payload. Length caps apply when the field is a string; CF-1 applies only when **both** `fuelType` and `transmission` are present. An absent field is never a violation — this is what keeps partial/draft saves working.
- **workerd safety**: `part1-config.ts` is safe to import into the endpoint (zod-only, lazy year). Do **not** import `SessionScreen.tsx` (a React island that pulls in Dexie) into the server endpoint — move the `globalNotes` constant/message into the shared module instead.

## Phase 1: Extract shared validation primitives

### Overview

Make the length caps, the CF-1 rule, and their messages single-source and
server-importable, with no behavior change.

### Changes Required:

#### 1. Shared validation primitives

**File**: `src/lib/part1-config.ts`

**Intent**: Expose the rules the server will reuse so neither limit nor the
cross-field check is duplicated. Replace the inline literals in the schema with
the new named exports so the schema and the server guard share one definition.

**Contract**: Add and `export`:

- `MAX_PART1_NOTES_LENGTH = 1000` — used in the `notes` refine (replaces the `1000` literal at [part1-config.ts:172](../../../src/lib/part1-config.ts)).
- `MAX_GLOBAL_NOTES_LENGTH = 10_000` — new home for the island literal.
- `isElectricTransmissionValid(d: { fuelType?: string | null; transmission?: string | null }): boolean` — the CF-1 predicate `!(d.fuelType === "electric" && d.transmission !== "automatic")`, consumed by the schema's `.refine` ([part1-config.ts:179](../../../src/lib/part1-config.ts)) and by the server guard.
- The three messages the server returns: the existing `M.notes` and `M.crossFieldElectricTransmission`, plus a new `globalNotes` message `"Global notes cannot be longer than 10,000 characters."` (verbatim from [SessionScreen.tsx:31](../../../src/components/inspections/SessionScreen.tsx)). Export these as named constants (or export `M`) — keep the exact strings, as they are asserted verbatim in tests.

#### 2. Island consumes the shared constant

**File**: `src/components/inspections/SessionScreen.tsx`

**Intent**: Remove the duplicated `globalNotes` cap/message literals so the
island and the server enforce the identical limit.

**Contract**: Replace local `MAX_NOTES` / `NOTES_TOO_LONG` ([SessionScreen.tsx:30-31](../../../src/components/inspections/SessionScreen.tsx)) with imports of `MAX_GLOBAL_NOTES_LENGTH` and the `globalNotes` message from `@/lib/part1-config`. No behavior change to the over-limit gate.

### Success Criteria:

#### Automated Verification:

- Existing test suite passes (Part-1 validation + sync + RLS): `npm test`
- Type-checked lint passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- On the session screen, typing past 10,000 chars still disables save with the same message (no regression from moving the constant).

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Add the server guard + prove it

### Overview

Reject oversized / cross-field-invalid sync writes at the boundary with 400 +
shared messages, and lock the behavior with integration tests (including a
partial-draft regression guard).

### Changes Required:

#### 1. Sync payload validation guard

**File**: `src/lib/sync-payload-validation.ts` (new) — imported by the endpoint

**Intent**: A small pure function the endpoint runs on the camelCase payload to
catch the present-field violations Risk #6 names, returning the message to send.

**Contract**: `validateSyncPayload(payload: Record<string, unknown>): { ok: true } | { ok: false; message: string }`. Rules, each applied only when the field is present:

- `globalNotes` is a string with `length > MAX_GLOBAL_NOTES_LENGTH` → fail with the `globalNotes` message.
- `notes` is a string with `length > MAX_PART1_NOTES_LENGTH` → fail with `M.notes`.
- both `fuelType` and `transmission` present and `isElectricTransmissionValid` is false → fail with `M.crossFieldElectricTransmission`.
- otherwise `{ ok: true }`. Imports all rules/messages from `@/lib/part1-config`.

#### 2. Endpoint wiring

**File**: `src/pages/api/inspections/sync.ts`

**Intent**: Run the guard on the camelCase row before snakecasing; reject with
400 on failure, preserving the existing flow otherwise.

**Contract**: In the `put` branch, after `const { synced: _synced, ...row } = body.payload ?? {}` and **before** `snakecaseKeys`, call `validateSyncPayload(row)`; if not ok, `return new Response(result.message, { status: 400 })`. No change to auth/config/delete/owner-stamping/casing.

#### 3. Integration tests

**File**: `tests/inspections.sync.test.ts`

**Intent**: Prove the boundary rejects each named case (and persists nothing),
and that valid partial writes still pass — driving the real handler under RLS via
the existing harness.

**Contract**: Add cases under the existing `describe`:

- oversized `globalNotes` (length `MAX_GLOBAL_NOTES_LENGTH + 1`) → 400, body equals the `globalNotes` message; a subsequent `aClient` select by id returns **no row** (nothing persisted).
- oversized Part-1 `notes` (length `MAX_PART1_NOTES_LENGTH + 1`) → 400 with `M.notes`; no row persisted.
- CF-1 `{ fuelType: "electric", transmission: "manual" }` → 400 with `M.crossFieldElectricTransmission`; no row persisted.
- **partial-draft regression**: a valid partial write (e.g. `{ id, status: "draft", globalNotes: "ok", fuelType: "electric", transmission: "automatic" }`) → 200 and persists.
- **present-field rule**: electric with `transmission` absent → 200 (CF-1 only fires when both are present).

### Success Criteria:

#### Automated Verification:

- New + existing sync cases pass: `npm test`
- Type-checked lint passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- Against `npm run dev`, a signed-in `curl`/devtools POST to `/api/inspections/sync` with an oversized `globalNotes` returns 400 with the message and writes no row (verify via the dashboard / a follow-up read).
- The same bypass with `{ fuelType: "electric", transmission: "manual" }` returns 400.
- A normal inspection edit through the UI still saves (no false rejections).

**Implementation Note**: After Phase 2 automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Integration Tests (primary):

- Drive the real `POST` handler through the existing mock-`@/lib/supabase` harness under RLS — assert status, verbatim message, and persistence/non-persistence for each case.
- Cover both polarities: the three rejections **and** the partial/present-field passes, so the guard is proven not to over-reject.

### Manual Testing Steps:

1. `npm run dev`; sign in; capture the session cookie.
2. `curl` a `put` op with `globalNotes` of 10,001 chars → expect 400 + message; confirm no row.
3. `curl` a `put` op with `fuelType:"electric", transmission:"manual"` → expect 400.
4. Edit a real inspection's global notes within limits via the UI → saves normally.

## Performance Considerations

Negligible — the guard is a few in-memory length/equality checks on one payload per sync op (low QPS per PRD).

## Migration Notes

None — no schema change.

## References

- Research: `context/changes/testing-sync-endpoint-server-trust/research.md`
- Endpoint: `src/pages/api/inspections/sync.ts:23-59`
- Oracle: `src/lib/part1-config.ts:169-182`
- Island literal moved: `src/components/inspections/SessionScreen.tsx:30-31`
- Harness: `tests/inspections.sync.test.ts`
- Convention: `context/foundation/lessons.md` "Field casing"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract shared validation primitives

#### Automated

- [x] 1.1 Existing test suite passes: `npm test` — 38e9fff
- [x] 1.2 Type-checked lint passes: `npm run lint` — 38e9fff
- [x] 1.3 Production build passes: `npm run build` — 38e9fff

#### Manual

- [x] 1.4 Session screen over-limit gate unchanged after moving the constant — 38e9fff

### Phase 2: Add the server guard + prove it

#### Automated

- [x] 2.1 New + existing sync cases pass: `npm test` — 5169028
- [x] 2.2 Type-checked lint passes: `npm run lint` — 5169028
- [x] 2.3 Production build passes: `npm run build` — 5169028

#### Manual

- [x] 2.4 Bypassing curl with oversized `globalNotes` → 400 + message, no row persisted — 5169028
- [x] 2.5 Bypassing curl with electric + manual → 400 — 5169028
- [x] 2.6 Normal UI inspection edit still saves (no false rejection) — 5169028
