import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createConfirmedUser } from "../helpers/supabase";

// Deployed-smoke auth setup (test-plan Phase 4, Risk #5). Mirrors auth.setup.ts
// but lands the ephemeral user in PROD: playwright.config.ts loads `.env.smoke`
// into process.env when SMOKE_DEPLOYED is set, so the reused helper's admin
// client (tests/helpers/supabase.ts) creates + later cascade-deletes the user in
// the SAME prod project the live Worker uses.
//
// Signing in through the LIVE UI exercises the edge cookie / getUser() round-trip
// — a 401 in the authenticated rung would then mean the cookie leg diverged, not
// endpoint logic. The created user's id/email are persisted to a sidecar BEFORE
// the sign-in so deployed-auth.teardown.ts can delete the user (cascade clears any
// leftover rows) even if a later step fails after the user was created.

const PASSWORD = "e2e-Password-123!";

// Distinct paths from the localhost e2e (user.json / user.meta.json) so a deployed
// run never reuses — or deletes — the local shared user, and vice versa.
const AUTH_DIR = path.join(process.cwd(), "playwright", ".auth");
const STORAGE_STATE = path.join(AUTH_DIR, "deployed-user.json");
const USER_SIDECAR = path.join(AUTH_DIR, "deployed-user.meta.json");

setup("authenticate ephemeral prod user", async ({ page }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const email = `smoke-deployed-${Date.now()}@example.com`;
  const userId = await createConfirmedUser(email, PASSWORD);

  // Persist identity first so teardown can delete it even if sign-in fails.
  fs.writeFileSync(USER_SIDECAR, JSON.stringify({ email, userId }, null, 2));

  // Sign in through the LIVE UI (baseURL is the deployed Worker); success
  // redirects to "/" and the SSR middleware sets the @supabase/ssr cookie.
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
