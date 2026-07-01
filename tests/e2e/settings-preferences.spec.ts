import { test, expect } from "@playwright/test";

// Settings-preferences e2e (S-10 / FR-022): the headline cross-cutting UX that unit
// tests can't reach — a device-local preference set on /settings persists across a
// reload with no flash, System live-follows the OS scheme, and the account-dropdown
// quick toggle flips the theme. Cookies (theme, fontScale) are the persistence layer.
//
// Auth is shared: auth.setup.ts signs in a confirmed user and persists storageState
// (see playwright.config.ts), so this spec starts authenticated. Runs against the
// BUILT app served by wrangler and needs local Supabase running (`npx supabase start`).

// The <html> "dark" class is the single theme signal (Layout.astro sets `.dark` for
// dark, absent for light); `data-font-scale` carries the S/M/L scale.
const htmlIsDark = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));

const fontScaleAttr = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-font-scale"));

test.describe("settings preferences", () => {
  // Start every case from a known theme (System) so an override left by a prior case
  // never leaks in. The controls write the `theme`/`fontScale` cookies for this origin.
  test.beforeEach(async ({ context }) => {
    await context.clearCookies({ name: "theme" });
    await context.clearCookies({ name: "fontScale" });
  });

  test("explicit theme + font persist across a reload with no flash", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/settings");

    // Pick Dark + large text via the segmented controls.
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await expect.poll(() => htmlIsDark(page)).toBe(true);
    await page.getByRole("button", { name: "L", exact: true }).click();
    await expect.poll(() => fontScaleAttr(page)).toBe("lg");

    // The choices are written to cookies, so a reload re-renders them server-side.
    await page.reload();

    // No-flash: the class/attr are correct from the very first paint (inline <head>
    // script + SSR), and the control reflects the persisted state.
    expect(await htmlIsDark(page)).toBe(true);
    expect(await fontScaleAttr(page)).toBe("lg");
    await expect(page.getByRole("button", { name: "Dark", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "L", exact: true })).toHaveAttribute("aria-pressed", "true");

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "theme")?.value).toBe("dark");
    expect(cookies.find((c) => c.name === "fontScale")?.value).toBe("lg");
  });

  test("System live-follows the OS color scheme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/settings");

    // Choose System explicitly; it should resolve to the current OS scheme (dark).
    await page.getByRole("button", { name: "System", exact: true }).click();
    await expect.poll(() => htmlIsDark(page)).toBe(true);

    // Flipping the OS scheme live-switches the app with no reload (matchMedia listener).
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => htmlIsDark(page)).toBe(false);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => htmlIsDark(page)).toBe(true);
  });

  test("account-dropdown quick toggle flips the theme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/settings");

    // Start from an explicit Light so the toggle's next step is deterministic.
    await page.getByRole("button", { name: "Light", exact: true }).click();
    await expect.poll(() => htmlIsDark(page)).toBe(false);

    // The account menu lives on the dashboard top bar. The board is a client:load
    // island, so retry opening until the menu items hydrate.
    await page.goto("/dashboard");
    await expect(async () => {
      await page.getByRole("button", { name: "Account menu" }).click();
      await expect(page.getByRole("menuitem", { name: /mode/ })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    // In light mode the quick toggle offers "Dark mode"; selecting it flips to dark.
    await page.getByRole("menuitem", { name: "Dark mode" }).click();
    await expect.poll(() => htmlIsDark(page)).toBe(true);
  });
});

test.describe("settings when logged out", () => {
  // Override the chromium project's authenticated storageState with an empty one so
  // the page fixture is genuinely unauthenticated (same pattern as the deployed-smoke
  // unauthenticated probes) — otherwise the shared session cookie would let /settings
  // through.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/settings redirects to sign-in when logged out", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/auth\/signin/);
  });
});
