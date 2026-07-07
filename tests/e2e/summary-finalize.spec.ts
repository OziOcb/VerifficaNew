import { test, expect, type Page } from "@playwright/test";

// The S-06 north-star acceptance loop (FR-019/FR-020/FR-021), end-to-end in a real browser:
// answer a question on the Summary → Finalize (which returns to the dashboard, where the row now
// sits under "Completed") → open it → it opens directly as the read-only report ([id].astro status
// dispatch: Completed → /summary; notes locked, no modal Edit, Finalize replaced by Reopen) →
// Reopen (behind the confirm) reverts to Draft in place and re-enables editing → re-finalize.
// Asserts status-driven UI states, not internals.
//
// Auth is shared: auth.setup.ts persists `storageState` (playwright.config.ts), so this spec
// starts authenticated. It self-cleans the row it creates so the shared user never sits near the
// 2-per-owner cap. Runs against the BUILT app served by wrangler (the SW is build-only) and needs
// local Supabase running (`npx supabase start`). Seed/mechanics modelled on seed.spec.ts and
// offline-durability.spec.ts (shared auth, SSR re-read oracle, self-cleanup).

// Pick an option from a shadcn/Radix <Select> by its visible label + option text.
async function selectOption(page: Page, label: string, optionName: string) {
  await page.getByLabel(label).click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}

test("finalize → read-only report → dashboard opens report → reopen → re-finalize", async ({ page }) => {
  // 1. Create a draft inspection from the dashboard (mirrors seed.spec.ts — the board is a
  //    client:load island, so retry the open until the confirm button hydrates; scope to
  //    role=banner since the empty state renders a duplicate button).
  await page.goto("/dashboard");
  await expect(async () => {
    await page.getByRole("banner").getByRole("button", { name: "Start new inspection" }).click();
    await expect(page.getByRole("button", { name: "Start inspection" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: "Start inspection" }).click();
  await page.waitForURL(/\/inspections\/[0-9a-f-]+/);
  const id = /\/inspections\/([0-9a-f-]+)/.exec(page.url())?.[1];
  expect(id).toBeTruthy();

  // 2. Complete Part 1 (config) so Parts 2–5 unlock — the "View Summary" entry point and the
  //    per-Part charts only exist once the config is valid. The server derives the name from
  //    make+model, so the Completed dashboard card is later addressable as "Volvo XC90".
  await page.goto(`/inspections/${id}/session/part/1`);
  await page.getByLabel("Make").fill("Volvo");
  await page.getByLabel("Model").fill("XC90");
  await selectOption(page, "Fuel type", "Petrol");
  await selectOption(page, "Transmission", "Automatic");
  await selectOption(page, "Drive", "4WD");
  await selectOption(page, "Body type", "SUV");
  await page.getByRole("button", { name: "Save Part 1" }).click();
  await page.waitForURL(new RegExp(`/inspections/${id}/session$`));

  // 3. Reach the Summary via the session-hub entry point (unlocked once Part 1 is valid).
  await page.getByRole("link", { name: "View Summary" }).click();
  await page.waitForURL(new RegExp(`/inspections/${id}/summary$`));

  // The island is client:only, so wait for it to hydrate: the Draft summary shows Finalize, the
  // notes textarea is editable, and there is no Reopen control yet.
  const finalizeBtn = page.getByRole("button", { name: "Finalize inspection" });
  const reopenBtn = page.getByRole("button", { name: "Reopen for editing" });
  const notes = page.locator("#globalNotes");
  await expect(finalizeBtn).toBeVisible({ timeout: 15_000 });
  await expect(reopenBtn).toHaveCount(0);
  await expect(notes).toBeEditable();

  // 4. Answer one question inline (FR-020) so the report reflects a real answer through the
  //    lifecycle. Open Part 2's modal, reveal the toggles, and mark the first question "No".
  await page.getByRole("button", { name: /Part 2/ }).click();
  const partDialog = page.getByRole("dialog");
  await expect(partDialog).toBeVisible();
  await partDialog.getByRole("button", { name: "Edit answers" }).click();
  // Sections start collapsed (all-collapsed by default); expand the first to reveal its questions.
  await partDialog.getByRole("button", { expanded: false }).first().click();
  await partDialog.getByRole("button", { name: "No" }).first().click();
  // Close the modal (the answer persisted optimistically on tap — no Save button).
  await page.keyboard.press("Escape");
  await expect(partDialog).toHaveCount(0);

  // 5. FINALIZE → returns to the dashboard (finalize awaits the sync flush before redirecting), and
  //    the row now sits under the "Completed" group, server-rendered from the persisted status.
  await finalizeBtn.click();
  await page.waitForURL(/\/dashboard(?:\/)?$/);
  const completedSection = page.locator("section", { hasText: "Completed" }).filter({ hasText: "Volvo XC90" });
  await expect(completedSection.getByText("Volvo XC90")).toBeVisible();

  // 6. Opening the Completed row lands directly on the read-only report — [id].astro dispatches
  //    Completed → /summary before its unconditional /session redirect. Read-only enforcement:
  //    Reopen present, Finalize gone, notes locked, and the per-Part modal shows no Edit.
  await completedSection.getByRole("button", { name: "Resume" }).click();
  await page.waitForURL(new RegExp(`/inspections/${id}/summary$`));
  await expect(reopenBtn).toBeVisible({ timeout: 15_000 });
  await expect(finalizeBtn).toHaveCount(0);
  await expect(notes).not.toBeEditable();
  await page.getByRole("button", { name: /Part 2/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit answers" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // 7. RELOAD stays a read-only report (status persisted server-side; the live Dexie row also
  //    carries `completed`).
  await page.reload();
  await expect(reopenBtn).toBeVisible({ timeout: 15_000 });
  await expect(finalizeBtn).toHaveCount(0);

  // 8. REOPEN requires an explicit confirm, then reverts to Draft in place: Finalize returns, the
  //    notes are editable again, and re-finalization is required.
  await reopenBtn.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reopen" }).click();
  await expect(finalizeBtn).toBeVisible();
  await expect(reopenBtn).toHaveCount(0);
  await expect(notes).toBeEditable();

  // 9. RE-FINALIZE closes it back to a Completed report — again returning to the dashboard.
  await finalizeBtn.click();
  await page.waitForURL(/\/dashboard(?:\/)?$/);
  await expect(
    page.locator("section", { hasText: "Completed" }).filter({ hasText: "Volvo XC90" }).getByText("Volvo XC90"),
  ).toBeVisible();

  // 10. CLEANUP: delete the row through the destructive confirm so the shared user stays under the
  //     2-per-owner cap (mirrors seed.spec.ts).
  await page.goto("/dashboard");
  await expect(page.getByText("Volvo XC90")).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Volvo XC90")).toHaveCount(0);
});
