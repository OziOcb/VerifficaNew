import { test, expect } from "@playwright/test";

// Seed/happy-path e2e: a created `inspections` row persists across a page reload
// (proving the SSR read of the owner-scoped row, not just optimistic UI), then is
// cleaned up through the destructive confirm dialog.
//
// Auth is shared: auth.setup.ts signs in a confirmed user and persists
// `storageState` (see playwright.config.ts), so this spec starts authenticated.
// It still self-cleans the row it creates so the shared user never sits near the
// 2-per-owner cap. Runs against the BUILT app served by wrangler and needs local
// Supabase running (`npx supabase start`).

test("created inspection persists after page reload", async ({ page }) => {
  // 1. On the dashboard, "Start new inspection" opens the startup pop-up; confirming
  //    auto-creates one draft row server-side and redirects to /inspections/{id}.
  await page.goto("/dashboard");
  // The board is a client:load React island; its onClick is wired only after
  // hydration. A single click can land before hydration and be lost, so retry the
  // open until the dialog's confirm button appears (reopening is idempotent). With
  // an empty list the empty-state renders a second identical button, so scope to
  // the header (role=banner) one.
  await expect(async () => {
    await page.getByRole("banner").getByRole("button", { name: "Start new inspection" }).click();
    await expect(page.getByRole("button", { name: "Start inspection" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: "Start inspection" }).click();
  // Create redirects through /inspections/{id} to the session screen, so match the
  // prefix rather than anchoring the end.
  await page.waitForURL(/\/inspections\/[0-9a-f-]+/);

  // 2. Back on the dashboard the new card is server-rendered from the DB. The name
  //    is the auto placeholder `Draft inspection — <date>`; the card title is a
  //    <div>, so match by text rather than a heading role.
  const card = page.getByText(/Draft inspection/);
  await page.goto("/dashboard");
  await expect(card).toBeVisible();

  // 3. Reload: the row is re-read under RLS on the next SSR pass, proving it was
  //    persisted (not just held in the island's local state).
  await page.reload();
  await expect(card).toBeVisible();

  // 4. Cleanup: the card's Delete opens the destructive confirm; the AlertDialog's
  //    own "Delete" action (scoped to role=alertdialog to disambiguate) hard-deletes
  //    the row, and the card disappears from the grid.
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
});
