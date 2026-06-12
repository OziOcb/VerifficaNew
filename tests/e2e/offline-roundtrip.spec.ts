import { test, expect } from "@playwright/test";
import { createConfirmedUser, deleteUser } from "../helpers/supabase";

// Capstone e2e for F-02 (the no-data-loss guardrail): one `inspections` record
// survives a full offline-write -> offline-reload -> reconnect -> sync cycle, and
// the app shell is served by the service worker on the offline reload (not the
// browser's offline error page).
//
// Runs against the BUILT app served by wrangler (the SW is build-only; the
// Cloudflare adapter has no `astro preview`) — see playwright.config.ts. Requires
// local Supabase running (`npx supabase start`) so sign-in and sync work.

const PASSWORD = "e2e-Password-123!";

let email: string;
let userId: string;

test.beforeAll(async () => {
  email = `e2e-offline-${Date.now()}@example.com`;
  userId = await createConfirmedUser(email, PASSWORD);
});

test.afterAll(async () => {
  if (userId) await deleteUser(userId);
});

test("inspection survives offline write, offline reload, and reconnect sync", async ({ page, context }) => {
  // 1. Sign in through the real UI so the @supabase/ssr session cookie is set;
  //    a successful sign-in redirects to "/".
  await page.goto("/auth/signin");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  // Exact match: the "Show password" toggle button also matches a loose "Password".
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");

  // 2. Open the demo and let the service worker take control, then reload so the
  //    now-controlling SW caches this navigation in its NetworkFirst "pages"
  //    cache — that cached document is what an offline reload will serve.
  await page.goto("/offline-demo");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.getByRole("heading", { name: "Offline demo" })).toBeVisible();

  // 3. Go offline and save a record: it lands in Dexie optimistically and the
  //    outbox cannot drain, so it stays "pending" (synced: 0).
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save record" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("pending");

  // 4. Reload while offline: the shell is served from the SW cache (proving the
  //    app-shell fallback), the island rehydrates, and the record survives.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Offline demo" })).toBeVisible();
  await expect(page.getByTestId("sync-status")).toHaveText("pending");

  // 5. Reconnect: the `online` event drains the outbox to the sync endpoint; the
  //    row adopts the server's authoritative row and flips to "synced" (1).
  await context.setOffline(false);
  await expect(page.getByTestId("sync-status")).toHaveText("synced", { timeout: 20_000 });
});
