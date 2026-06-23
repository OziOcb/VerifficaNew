import { test, expect } from "@playwright/test";
import { createConfirmedUser, deleteUser } from "../helpers/supabase";

// Seed/happy-path e2e: a created `inspections` row persists across a page reload
// (proving the SSR read of the owner-scoped row, not just optimistic UI), then is
// cleaned up through the destructive confirm dialog.
//
// Mirrors offline-roundtrip.spec.ts: `/dashboard` is a PROTECTED_ROUTE, so we seed
// a confirmed user with the service-role admin client and sign in through the real
// UI (sets the @supabase/ssr cookie). Runs against the BUILT app served by wrangler
// (see playwright.config.ts) and needs local Supabase running (`npx supabase start`).

const PASSWORD = "e2e-Password-123!";

let email: string;
let userId: string;

test.beforeAll(async () => {
  email = `e2e-seed-${Date.now()}@example.com`;
  userId = await createConfirmedUser(email, PASSWORD);
});

test.afterAll(async () => {
  // Cascade FK on inspections.owner_id clears any rows this test left behind.
  if (userId) await deleteUser(userId);
});

test("created inspection persists after page reload", async ({ page }) => {
  // 1. Sign in through the real UI; a successful sign-in redirects to "/".
  await page.goto("/auth/signin");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  // Exact match: the "Show password" toggle button also matches a loose "Password".
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");

  // 2. On the dashboard, "Start new inspection" opens the startup pop-up; confirming
  //    auto-creates one draft row server-side and redirects to /inspections/{id}.
  await page.goto("/dashboard");
  // With an empty list the empty-state panel renders a second identical button, so
  // scope to the header (role=banner) one.
  await page.getByRole("banner").getByRole("button", { name: "Start new inspection" }).click();
  await page.getByRole("button", { name: "Start inspection" }).click();
  // Create redirects through /inspections/{id} to the session screen, so match the
  // prefix rather than anchoring the end.
  await page.waitForURL(/\/inspections\/[0-9a-f-]+/);

  // 3. Back on the dashboard the new card is server-rendered from the DB. The name
  //    is the auto placeholder `Draft inspection — <date>`; the card title is a
  //    <div>, so match by text rather than a heading role.
  const card = page.getByText(/Draft inspection/);
  await page.goto("/dashboard");
  await expect(card).toBeVisible();

  // 4. Reload: the row is re-read under RLS on the next SSR pass, proving it was
  //    persisted (not just held in the island's local state).
  await page.reload();
  await expect(card).toBeVisible();

  // 5. Cleanup: the card's Delete opens the destructive confirm; the AlertDialog's
  //    own "Delete" action (scoped to role=alertdialog to disambiguate) hard-deletes
  //    the row, and the card disappears from the grid.
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
});
