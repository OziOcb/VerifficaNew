// Sync-boundary server guard (Test Plan Phase 3, Risk #6). The endpoint trusts the
// client for nothing it can verify: it already overwrites `ownerId` (identity), but
// historically upserted the payload's CONTENT verbatim, so a caller bypassing the
// browser validators (curl / devtools) could persist an oversized notes document or a
// cross-field-invalid config (Electric + Manual). This re-applies — on the SERVER — the
// specific unsafe bands the client blocks, reusing `part1-config` as the single source
// of truth so client and server enforce the identical limits and messages.
//
// PRESENT-FIELD semantics: the guard inspects only keys actually present in the payload.
// A length cap fires only when the field is a string; CF-1 fires only when BOTH
// `fuelType` and `transmission` are present. An absent field is never a violation —
// that is what lets legitimate partial/draft saves (e.g. `{ id, globalNotes }`) pass.
//
// Runs on the camelCase row (after stripping `synced`, before `snakecaseKeys`) so all
// validation stays on the app side of the single casing boundary (lessons.md "Field casing").
import { MAX_GLOBAL_NOTES_LENGTH, MAX_PART1_NOTES_LENGTH, M, isElectricTransmissionValid } from "@/lib/part1-config";

export type SyncPayloadValidation = { ok: true } | { ok: false; message: string };

/**
 * Reject the Risk #6 unsafe bands on a camelCase sync payload, returning the verbatim
 * user-facing message to send back as the 400 body. Each rule is applied only when its
 * field is present; otherwise `{ ok: true }`.
 */
export function validateSyncPayload(payload: Record<string, unknown>): SyncPayloadValidation {
  const { globalNotes, notes, fuelType, transmission } = payload;

  if (typeof globalNotes === "string" && globalNotes.length > MAX_GLOBAL_NOTES_LENGTH) {
    return { ok: false, message: M.globalNotes };
  }

  if (typeof notes === "string" && notes.length > MAX_PART1_NOTES_LENGTH) {
    return { ok: false, message: M.notes };
  }

  // CF-1 fires only when BOTH fields are concretely set (a string) — an electric car
  // with no transmission chosen yet is a valid partial save, not a violation. The real
  // outbox always sends `transmission` as a key (null when unset, never absent), so we
  // must treat null the same as absent here; a bare `!== undefined` check would let a
  // cleared transmission slip through and falsely reject the in-progress draft.
  if (
    typeof fuelType === "string" &&
    typeof transmission === "string" &&
    !isElectricTransmissionValid({ fuelType, transmission })
  ) {
    return { ok: false, message: M.crossFieldElectricTransmission };
  }

  return { ok: true };
}
