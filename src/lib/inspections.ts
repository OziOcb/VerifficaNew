// Thin, Dexie-FREE fetch wrappers for the dashboard's SYNCHRONOUS mutation path
// (S-02), distinct from the F-02 outbox (@/lib/sync). This file must stay free of
// any @/lib/db / @/lib/sync import so it is safe to pull into a `client:load`
// island — Dexie has no global on workerd/SSR (see src/lib/db.ts). Same-origin
// fetch so the Supabase auth cookie rides along automatically.
import type { CamelCasedPropertiesDeep } from "type-fest";
import type { Database } from "@/db/database.types";

// The DB widens `status` to `string`; the app only ever stores these two values
// (the F-01 CHECK constraint guarantees it). Narrow for grouping logic; treat any
// unknown value as a draft defensively.
export type InspectionStatus = "draft" | "completed";

// SSR-read shape handed to the dashboard island: a camelCase projection of the
// generated snake_case Row (so it auto-tracks `npm run db:types` — lessons.md
// "Field casing"), scoped to the columns the dashboard selects. `ownerId` is
// omitted (RLS already scopes the read to the owner) and the local-only `synced`
// flag never applies to an SSR row.
export type Inspection = Pick<
  CamelCasedPropertiesDeep<Database["public"]["Tables"]["inspections"]["Row"]>,
  "id" | "status" | "name" | "createdAt" | "updatedAt"
>;

// localStorage key for the per-user "Don't show again" startup-instruction
// preference (FR-009). Scoped by user id so the choice (a) PERSISTS across
// logout/login for the same user on this browser, and (b) never leaks to a
// different account. Because it is user-scoped, signout must NOT clear it.
export function hideStartupKey(userId: string): string {
  return `veriffica:hideStartupInstructions:${userId}`;
}

// The startup guide is "hidden" only when the flag is exactly "1" (what
// DashboardBoard.handleStart() checks). Any other value — absent, "0", legacy —
// means the guide still shows. The settings toggle is expressed as "guide
// enabled" (on = shows), so these two helpers translate between that boolean and
// the stored flag without duplicating the "=== '1'" magic string across callers.
export function isStartupGuideEnabled(flag: string | null | undefined): boolean {
  return flag !== "1";
}

// The localStorage value to persist for a given enabled state. Enabling writes
// "0" (rather than removing the key) so the choice is an explicit, inspectable
// device-local record; disabling writes "1" to match the FR-009 dismiss path.
export function startupFlagFor(enabled: boolean): string {
  return enabled ? "0" : "1";
}

// Distinctive, stable message the `enforce_inspection_limit` trigger RAISEs when
// the 2-per-owner cap is hit. The create endpoint matches on it to map the
// rejection to 409 (match on message, not SQLSTATE — see the migration). Shared
// from one place so the SQL message, the endpoint matcher, and the limit test
// can't silently drift apart; `tests/inspections.limit.test.ts` asserts the DB
// error contains this exact string, so rewording the trigger message fails CI.
export const INSPECTION_LIMIT_ERROR = "inspection_limit_reached";

// Create one draft inspection. The server stamps every field; we only need to
// know the outcome. 201 -> the new id; 409 -> the 2-per-owner limit was hit (the
// dashboard shows the limit pop-up); anything else -> a generic failure.
export async function createInspection(): Promise<{ ok: true; id: string } | { ok: false; limitReached: boolean }> {
  const res = await fetch("/api/inspections/create", { method: "POST" });
  if (res.status === 201) {
    const { id } = (await res.json()) as { id: string };
    return { ok: true, id };
  }
  return { ok: false, limitReached: res.status === 409 };
}

// Hard-delete one inspection by reusing the existing sync endpoint's delete branch
// (RLS-scoped delete -> 204). Called synchronously inline, NOT via the outbox.
export async function deleteInspection(id: string): Promise<boolean> {
  const res = await fetch("/api/inspections/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "delete", entityId: id }),
  });
  return res.ok;
}
