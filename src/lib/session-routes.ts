// Pure routing decisions for the S-04 session tree, extracted from the `.astro`
// frontmatter so the redirect tree can be pinned at the unit level (mirroring how the
// `isConfigUnlocked` gate is unit-tested) instead of only through a heavy e2e. The
// per-Part route imports these and acts on the result, so the test exercises the real
// guard, not a parallel copy that could drift.
//
// SERVER-SAFE: no Dexie / no DOM — imported from `.astro` frontmatter.

/** The parts the session tree exposes (Part 1 is the config form; 2–5 are question screens). */
export type PartParam = "1" | "2" | "3" | "4" | "5";

const VALID_PARTS: ReadonlySet<string> = new Set<PartParam>(["1", "2", "3", "4", "5"]);

/** Type guard: is the `[part]` route param one of the five real parts? */
export function isValidPart(part: string | undefined): part is PartParam {
  return part !== undefined && VALID_PARTS.has(part);
}

/** What a per-Part screen should do: redirect somewhere, or render a given screen. */
export type PartScreenDecision =
  | { redirect: string }
  | { render: "form" } // Part 1 — the config form
  | { render: "placeholder" }; // Parts 2–5 — the S-05 card placeholder

/**
 * The per-Part routing decision for a VALID part whose inspection row is already present:
 *   - Parts 2–5 require a valid config; an invalid one bounces back to Part 1 (the only
 *     place to make it valid).
 *   - Otherwise render — Part 1 = the config form, Parts 2–5 = the S-05 placeholder.
 *
 * Part validity and row presence are handled by the route itself (`isValidPart` + the
 * RLS `null` check) so `row` narrows for the render path without a cast.
 */
export function resolvePartScreen(input: { id: string; part: PartParam; unlocked: boolean }): PartScreenDecision {
  if (input.part !== "1" && !input.unlocked) return { redirect: `/inspections/${input.id}/session/part/1` };
  return input.part === "1" ? { render: "form" } : { render: "placeholder" };
}
