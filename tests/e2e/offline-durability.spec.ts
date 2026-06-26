import { test, expect, type Page } from "@playwright/test";

// Offline durability at flow level — test-plan §2 risk #1 (High × Med-High):
// "Answers/notes written offline mid-inspection vanish or fail to sync on reconnect
// (flow-level, MULTIPLE writes)." This is the one leg the Phase 1 integration suite
// (tests/sync.drain.test.ts) cannot prove: the REAL browser + service-worker
// offline-reload, with several distinct offline writes each verified to have landed
// SERVER-SIDE — not a single terminal "synced" badge (research: "every op landed" ≠
// "final 200"). Seed/mechanics modelled on tests/e2e/seed.spec.ts (shared auth, SSR
// re-read oracle, self-cleanup) and the retired offline-roundtrip.spec.ts (SW-control
// + offline-reload steps).
//
// Auth is shared: auth.setup.ts persists `storageState` (see playwright.config.ts),
// so this spec starts authenticated. It self-cleans the row it creates so the shared
// user never sits near the 2-per-owner cap. Runs against the BUILT app served by
// wrangler (the SW is build-only) and needs local Supabase running.

// Count the outbox (Dexie `changeQueue`) directly from the page. The session screen
// has no on-screen "pending sync" indicator — a local optimistic save shows "Saved." —
// so the unsynced/pending state of the offline writes IS the queue depth. Reading the
// raw IndexedDB store (db name "veriffica", store "changeQueue") is the deterministic
// signal that an offline write was enqueued, with no race on a transient UI label.
function queueCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("veriffica");
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction("changeQueue", "readonly").objectStore("changeQueue").count();
          req.onsuccess = () => {
            resolve(req.result);
            db.close();
          };
          req.onerror = () => {
            reject(new Error(req.error?.message ?? "changeQueue count failed"));
          };
        };
        open.onerror = () => {
          reject(new Error(open.error?.message ?? "indexedDB open failed"));
        };
      }),
  );
}

// Pick an option from a shadcn/Radix <Select> by its visible label + option text.
async function selectOption(page: Page, label: string, optionName: string) {
  await page.getByLabel(label).click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}

test("multiple offline writes survive offline reload and sync per-write on reconnect", async ({ page, context }) => {
  // A unique notes value so the SSR re-read oracle can't pass on stale residue.
  const NOTE_ONE = `Offline note one ${Date.now()}`;
  const NOTE_FINAL = `${NOTE_ONE} — and two`;

  // 1. ONLINE: create a draft inspection from the dashboard (mirrors seed.spec.ts —
  //    the board is a client:load island, so retry the open until the confirm button
  //    hydrates; scope to role=banner since the empty state renders a duplicate).
  await page.goto("/dashboard");
  await expect(async () => {
    await page.getByRole("banner").getByRole("button", { name: "Start new inspection" }).click();
    await expect(page.getByRole("button", { name: "Start inspection" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: "Start inspection" }).click();
  await page.waitForURL(/\/inspections\/[0-9a-f-]+/);
  const id = /\/inspections\/([0-9a-f-]+)/.exec(page.url())?.[1];
  expect(id).toBeTruthy();

  // 2. Let the service worker take control and warm the NetworkFirst "pages" cache for
  //    BOTH routes we drive offline — the session hub and the Part 1 form — so an
  //    offline navigation to either is served from cache, not Chrome's offline page.
  await page.goto(`/inspections/${id}/session`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.getByRole("heading", { name: "Inspection" })).toBeVisible();
  await page.goto(`/inspections/${id}/session/part/1`);
  await expect(page.getByRole("button", { name: "Save Part 1" })).toBeVisible();
  await page.goto(`/inspections/${id}/session`);
  await expect(page.locator("#globalNotes")).toBeVisible();

  // 3. GO OFFLINE and make THREE distinct writes that each enqueue an outbox op. Each
  //    `saveInspection` writes Dexie + enqueues in one transaction, so the queue depth
  //    growing 1 → 2 → 3 is the deterministic proof each offline write was captured.
  await context.setOffline(true);

  // op 1 — global notes (debounced 600 ms; the queue going to 1 confirms it persisted).
  await page.locator("#globalNotes").fill(NOTE_ONE);
  await expect.poll(() => queueCount(page), { timeout: 10_000 }).toBe(1);

  // op 2 — edit the notes again (a second distinct note write).
  await page.locator("#globalNotes").fill(NOTE_FINAL);
  await expect.poll(() => queueCount(page), { timeout: 10_000 }).toBe(2);

  // op 3 — Part 1 vehicle config (a different field set + a different code path). Save
  //    enqueues and navigates back to the session hub (served from SW cache offline).
  //    The config save read-merges the notes already in Dexie, so it never nulls them.
  await page.goto(`/inspections/${id}/session/part/1`);
  await page.getByLabel("Make").fill("Volvo");
  await page.getByLabel("Model").fill("XC90");
  await selectOption(page, "Fuel type", "Petrol");
  await selectOption(page, "Transmission", "Automatic");
  await selectOption(page, "Drive", "4WD");
  await selectOption(page, "Body type", "SUV");
  await page.getByRole("button", { name: "Save Part 1" }).click();
  await page.waitForURL(new RegExp(`/inspections/${id}/session$`));
  await expect.poll(() => queueCount(page), { timeout: 10_000 }).toBe(3);

  // 4. RELOAD WHILE OFFLINE: the shell must come from the SW cache (heading visible, not
  //    Chrome's offline page) and the locally-saved notes must survive — the island
  //    rehydrates the value from Dexie via useLiveQuery (the SSR prop is the stale warmed
  //    copy), and nothing has synced, so all three ops are still queued.
  await page.reload();
  // The h1 (the inspection name) renders only if the island shell was served from the SW
  // cache — Chrome's offline error page has no such heading and no #globalNotes.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#globalNotes")).toHaveValue(NOTE_FINAL);
  expect(await queueCount(page)).toBe(3);

  // 5–6. RECONNECT and let autosync drain, then prove EACH write landed server-side via
  //    the SSR re-read (session.astro reads the owner-scoped row under RLS). Re-navigating
  //    re-runs SSR and re-mounts startAutoSync (which re-drains any remainder), so wrap the
  //    oracle in toPass to ride out the async drain without a fixed sleep. We assert each
  //    op independently: the name heading (derived server-side from the config make+model)
  //    proves the config op landed; the notes value proves both note ops landed; the
  //    absence of the "Complete Part 1" lock proves the config was accepted as valid.
  //    NOTE: op 1 and op 2 both write `globalNotes`, so op 2 overwrites op 1 server-side —
  //    this e2e verifies the *final* notes value, not NOTE_ONE's independent landing. That
  //    each op is POSTed exactly once, in FIFO order, is proven separately and
  //    deterministically by the integration suite (tests/sync.drain.test.ts).
  await context.setOffline(false);
  await expect(async () => {
    await page.goto(`/inspections/${id}/session`);
    await expect(page.getByRole("heading", { name: "Volvo XC90" })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("#globalNotes")).toHaveValue(NOTE_FINAL);
    await expect(page.getByText("Complete Part 1 (Info) to reveal")).toHaveCount(0);
    expect(await queueCount(page)).toBe(0);
  }).toPass({ timeout: 30_000 });

  // 7. CLEANUP: delete the inspection through the destructive confirm dialog so the
  //    shared user stays under the 2-per-owner cap (mirrors seed.spec.ts). Only this
  //    spec's row exists at this point (serial run, each spec self-cleans).
  await page.goto("/dashboard");
  await expect(page.getByText("Volvo XC90")).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Volvo XC90")).toHaveCount(0);
});
