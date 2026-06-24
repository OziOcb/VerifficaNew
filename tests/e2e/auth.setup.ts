import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createConfirmedUser } from "../helpers/supabase";

// Auth setup project: produce ONE shared signed-in session for the chromium
// project. We create a fresh confirmed user with the service-role admin client,
// sign in through the real UI (which sets the @supabase/ssr cookie), and persist
// `storageState` so specs start authenticated instead of re-signing-in.
//
// The created user's id/email are written to a sidecar JSON so auth.teardown.ts
// can delete the user (cascade clears any leftover rows) after the run.
//
// Runs against the BUILT app served by wrangler (see playwright.config.ts) and
// needs local Supabase running (`npx supabase start`).

const PASSWORD = "e2e-Password-123!";

const AUTH_DIR = path.join(process.cwd(), "playwright", ".auth");
const STORAGE_STATE = path.join(AUTH_DIR, "user.json");
const USER_SIDECAR = path.join(AUTH_DIR, "user.meta.json");

setup("authenticate shared user", async ({ page }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const email = `e2e-shared-${Date.now()}@example.com`;
  const userId = await createConfirmedUser(email, PASSWORD);

  // Persist the user identity first so teardown can delete it even if a later
  // step fails after the user was created.
  fs.writeFileSync(USER_SIDECAR, JSON.stringify({ email, userId }, null, 2));

  // Sign in through the real UI; a successful sign-in redirects to "/".
  await page.goto("/auth/signin");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  // Exact match: the "Show password" toggle button also matches a loose "Password".
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");

  // Persist the authenticated browser context (the @supabase/ssr cookie).
  await page.context().storageState({ path: STORAGE_STATE });

  expect(fs.existsSync(STORAGE_STATE)).toBe(true);
});
