import { describe, expect, it } from "vitest";
import { isValidPart, resolvePartScreen } from "@/lib/session-routes";

// Pins the per-Part route's redirect tree at the unit level — the guard the
// `session/part/[part].astro` frontmatter runs to decide redirect-vs-render. The route
// imports these helpers and acts on the result, so this is the real guard, not a copy.
// (The trivial absent-row → /dashboard redirect is an inline `if (!row)` narrowing guard
// in the route, shared verbatim with `session.astro`.)

describe("isValidPart — the [part] route-param guard", () => {
  it("accepts the five real parts", () => {
    for (const p of ["1", "2", "3", "4", "5"]) expect(isValidPart(p)).toBe(true);
  });

  it("rejects unknown parts, non-numerics, and undefined (→ /dashboard in the route)", () => {
    expect(isValidPart("0")).toBe(false);
    expect(isValidPart("6")).toBe(false);
    expect(isValidPart("99")).toBe(false);
    expect(isValidPart("foo")).toBe(false);
    expect(isValidPart("")).toBe(false);
    expect(isValidPart(undefined)).toBe(false);
  });
});

describe("resolvePartScreen — lock gate + screen choice (valid part, row present)", () => {
  const id = "abc-123";

  it("Part 1 always renders the config form, locked or not", () => {
    expect(resolvePartScreen({ id, part: "1", unlocked: false })).toEqual({ render: "form" });
    expect(resolvePartScreen({ id, part: "1", unlocked: true })).toEqual({ render: "form" });
  });

  it("Parts 2–5 with a valid config render the placeholder", () => {
    for (const part of ["2", "3", "4", "5"] as const) {
      expect(resolvePartScreen({ id, part, unlocked: true })).toEqual({ render: "placeholder" });
    }
  });

  it("Parts 2–5 with an invalid config redirect back to that inspection's Part 1", () => {
    for (const part of ["2", "3", "4", "5"] as const) {
      expect(resolvePartScreen({ id, part, unlocked: false })).toEqual({
        redirect: `/inspections/${id}/session/part/1`,
      });
    }
  });

  it("interpolates the inspection id into the Part 1 redirect target", () => {
    const decision = resolvePartScreen({ id: "other-id", part: "3", unlocked: false });
    expect(decision).toEqual({ redirect: "/inspections/other-id/session/part/1" });
  });
});
