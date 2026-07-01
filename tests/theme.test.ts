import { describe, expect, it } from "vitest";
import { normalizeFontScale, normalizeThemeChoice, resolveTheme } from "@/lib/theme";

// Pure resolver + font-mapping logic that keeps the SSR class (Layout.astro) and the
// no-flash inline <head> script in agreement. DOM-backed helpers (cookie round-trips,
// applyTheme, system-follow) are exercised separately; these are the framework-parity
// guarantees that a flash regression would trip.

describe("resolveTheme", () => {
  it("returns the explicit class for light/dark", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("defers to the client (null) for system, absent, and unknown legacy values", () => {
    expect(resolveTheme("system")).toBeNull();
    expect(resolveTheme(undefined)).toBeNull();
    expect(resolveTheme(null)).toBeNull();
    expect(resolveTheme("")).toBeNull();
    expect(resolveTheme("cosmic")).toBeNull();
  });
});

describe("normalizeFontScale", () => {
  it("passes through the valid non-default scales", () => {
    expect(normalizeFontScale("sm")).toBe("sm");
    expect(normalizeFontScale("lg")).toBe("lg");
  });

  it("defaults to base for base, absent, and invalid values", () => {
    expect(normalizeFontScale("base")).toBe("base");
    expect(normalizeFontScale(undefined)).toBe("base");
    expect(normalizeFontScale(null)).toBe("base");
    expect(normalizeFontScale("xl")).toBe("base");
  });
});

describe("normalizeThemeChoice", () => {
  it("passes through the three valid choices", () => {
    expect(normalizeThemeChoice("system")).toBe("system");
    expect(normalizeThemeChoice("light")).toBe("light");
    expect(normalizeThemeChoice("dark")).toBe("dark");
  });

  it("defaults to system for absent and unknown legacy values", () => {
    expect(normalizeThemeChoice(undefined)).toBe("system");
    expect(normalizeThemeChoice(null)).toBe("system");
    expect(normalizeThemeChoice("cosmic")).toBe("system");
  });
});
