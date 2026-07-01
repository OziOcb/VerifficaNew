// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  applyFontScale,
  FONT_SCALE_COOKIE,
  getFontScale,
  getThemeChoice,
  normalizeFontScale,
  normalizeThemeChoice,
  resolveTheme,
  setFontScale,
  setThemeChoice,
  THEME_COOKIE,
} from "@/lib/theme";

// Pure resolver + font-mapping logic that keeps the SSR class (Layout.astro) and the
// no-flash inline <head> script in agreement, plus the cookie round-trips and the
// <html> mutation that carry a preference from a control to the document. A flash or
// persistence regression trips one of these framework-parity guarantees.
//
// This file runs under jsdom (see the docblock directive) so the cookie/DOM helpers
// have a `document` — the rest of the suite runs in plain Node.

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

describe("cookie round-trips", () => {
  // jsdom keeps `document.cookie` for the whole file, so clear the two preference
  // cookies after each case to keep the round-trips independent.
  afterEach(() => {
    for (const name of [THEME_COOKIE, FONT_SCALE_COOKIE]) {
      document.cookie = `${name}=; path=/; max-age=0`;
    }
  });

  it("reads back the theme choice that was written", () => {
    setThemeChoice("light");
    expect(getThemeChoice()).toBe("light");
    setThemeChoice("dark");
    expect(getThemeChoice()).toBe("dark");
    setThemeChoice("system");
    expect(getThemeChoice()).toBe("system");
  });

  it("reads back the font scale that was written", () => {
    setFontScale("sm");
    expect(getFontScale()).toBe("sm");
    setFontScale("lg");
    expect(getFontScale()).toBe("lg");
    setFontScale("base");
    expect(getFontScale()).toBe("base");
  });

  it("defaults to system/base when no cookie is set", () => {
    expect(getThemeChoice()).toBe("system");
    expect(getFontScale()).toBe("base");
  });

  it("writes the theme and font cookies under their contract names, independently", () => {
    setThemeChoice("dark");
    setFontScale("lg");
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
    expect(document.cookie).toContain(`${FONT_SCALE_COOKIE}=lg`);
    // Reading one preference never bleeds into the other.
    expect(getThemeChoice()).toBe("dark");
    expect(getFontScale()).toBe("lg");
  });
});

describe("applyFontScale", () => {
  afterEach(() => {
    document.cookie = `${FONT_SCALE_COOKIE}=; path=/; max-age=0`;
    document.documentElement.removeAttribute("data-font-scale");
  });

  it("sets data-font-scale on <html> from the stored cookie", () => {
    setFontScale("lg");
    applyFontScale();
    expect(document.documentElement.getAttribute("data-font-scale")).toBe("lg");
  });

  it("falls back to base when the cookie is absent", () => {
    applyFontScale();
    expect(document.documentElement.getAttribute("data-font-scale")).toBe("base");
  });
});
