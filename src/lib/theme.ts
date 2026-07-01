// Client-side theme + font-scale runtime for the settings-profile slice (S-10 / FR-022).
//
// Preferences are device-local cookies read at SSR and applied before first paint
// by the blocking inline <head> script in `Layout.astro`. This module is the single
// source of truth for reading/writing those cookies and applying the effective
// theme/font to <html> from client code (the settings controls and account dropdown).
//
// IMPORTANT: the pure resolution logic here (`resolveTheme`, `normalizeFontScale`,
// `prefersDark`) is duplicated verbatim in the inline <head> script in `Layout.astro`.
// That script cannot import modules (it must run blocking, before hydration), so any
// change to the resolution rules must be mirrored in both places or SSR and first
// client paint will disagree (hydration flash).

export type ThemeChoice = "system" | "light" | "dark";
export type FontScale = "sm" | "base" | "lg";

export const THEME_COOKIE = "theme";
export const FONT_SCALE_COOKIE = "fontScale";

// 1 year — preferences persist long-term on the device.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Resolve a stored `theme` cookie value to the explicit class the server should
 * render. Returns `"light"`/`"dark"` for explicit choices, or `null` for `system`
 * (and any absent/unknown legacy value) — the server cannot read the OS preference,
 * so it defers to the inline script which resolves `system` via `matchMedia`.
 */
export function resolveTheme(value: string | undefined | null): "light" | "dark" | null {
  return value === "light" || value === "dark" ? value : null;
}

/** Coerce a stored `fontScale` cookie value to a valid scale, defaulting to `base`. */
export function normalizeFontScale(value: string | undefined | null): FontScale {
  return value === "sm" || value === "lg" ? value : "base";
}

/** Coerce a stored `theme` cookie value to a valid choice, defaulting to `system`. */
export function normalizeThemeChoice(value: string | undefined | null): ThemeChoice {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function readCookie(name: string): string | undefined {
  const match = new RegExp("(?:^|; )" + name + "=([^;]*)").exec(document.cookie);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function getThemeChoice(): ThemeChoice {
  return normalizeThemeChoice(readCookie(THEME_COOKIE));
}

export function setThemeChoice(choice: ThemeChoice): void {
  writeCookie(THEME_COOKIE, choice);
}

export function getFontScale(): FontScale {
  return normalizeFontScale(readCookie(FONT_SCALE_COOKIE));
}

export function setFontScale(scale: FontScale): void {
  writeCookie(FONT_SCALE_COOKIE, scale);
}

/** Whether the OS currently prefers a dark color scheme. */
export function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Resolve a theme choice to the concrete mode, consulting the OS for `system`. */
export function effectiveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "light" || choice === "dark") return choice;
  return prefersDark() ? "dark" : "light";
}

/** Apply the currently-stored theme choice to <html> (toggles the `.dark` class). */
export function applyTheme(): void {
  const dark = effectiveTheme(getThemeChoice()) === "dark";
  document.documentElement.classList.toggle("dark", dark);
}

/** Apply the currently-stored font scale to <html> (sets `data-font-scale`). */
export function applyFontScale(): void {
  document.documentElement.setAttribute("data-font-scale", getFontScale());
}

// Guard so repeated `initSystemFollow()` calls (Layout registers it once per page;
// the settings control re-arms it when System is picked) never stack duplicate
// listeners. One listener suffices — it re-reads the choice at change time.
let systemFollowArmed = false;

/**
 * Register a `matchMedia` listener that live-re-applies the theme when the OS
 * scheme changes — but only while the stored choice is `system`. A no-op for
 * explicit light/dark overrides. Idempotent: safe to call on every page and again
 * from the settings control.
 */
export function initSystemFollow(): void {
  if (systemFollowArmed) return;
  systemFollowArmed = true;
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", () => {
    if (getThemeChoice() === "system") applyTheme();
  });
}
