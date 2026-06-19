// Catalogue-FREE count helpers shared by the server engine (`@/lib/questions`, which
// imports the 80 KB catalogue) and the `client:only` session island. This module imports
// ONLY types from `@/lib/questions` (erased at build), so the island can import its runtime
// helpers without shipping the bank to the browser — the critical S-04 client constraint.
//
// The server computes a {@link SessionCounts} payload once (base counts + the per-Part
// delta each config-relevant flag adds); the island recomputes live counts as
// `base + Σ(active-flag deltas)`. The FR-014 additive model makes the flag deltas
// independent, so this sum equals `visibleCountsByPart(config, activeFlags)` — pinned by a
// unit test in `tests/questions.test.ts`.
import type { PartId, RuntimeFlag } from "@/lib/questions";

export type PartCounts = Record<PartId, number>;

export interface SessionCounts {
  /** Per-Part counts with no equipment flags active (the flag-independent floor). */
  base: PartCounts;
  /** For each config-relevant flag, the per-Part questions that flag reveals. */
  flagDeltas: Partial<Record<RuntimeFlag, PartCounts>>;
}

const PART_IDS = ["part2", "part3", "part4", "part5"] as const;

/** Live per-Part counts for a given active-flag set: base + every active flag's delta. */
export function countsForFlags(counts: SessionCounts, activeFlags: ReadonlySet<RuntimeFlag>): PartCounts {
  const result: PartCounts = { ...counts.base };
  for (const flag of Object.keys(counts.flagDeltas) as RuntimeFlag[]) {
    const delta = counts.flagDeltas[flag];
    if (!delta || !activeFlags.has(flag)) continue;
    for (const p of PART_IDS) result[p] += delta[p];
  }
  return result;
}

/** Sum of the per-Part counts — the Total Score / completion denominator. */
export function totalCount(counts: PartCounts): number {
  return PART_IDS.reduce((sum, p) => sum + counts[p], 0);
}
