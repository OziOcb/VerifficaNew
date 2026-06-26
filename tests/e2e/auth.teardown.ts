import { test as teardown } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { deleteUser } from "../helpers/supabase";

// Global teardown: delete the shared user created by auth.setup.ts. The FK
// cascade on inspections.owner_id clears any rows specs left behind, so no test
// residue persists between runs. Wired via the setup project's `teardown`
// dependency in playwright.config.ts.

const AUTH_DIR = path.join(process.cwd(), "playwright", ".auth");
const STORAGE_STATE = path.join(AUTH_DIR, "user.json");
const USER_SIDECAR = path.join(AUTH_DIR, "user.meta.json");

teardown("delete shared user", async () => {
  if (!fs.existsSync(USER_SIDECAR)) return;

  const { userId } = JSON.parse(fs.readFileSync(USER_SIDECAR, "utf-8")) as {
    email: string;
    userId: string;
  };

  if (userId) await deleteUser(userId);

  // Clean the persisted artifacts so a later run can't reuse a deleted user.
  fs.rmSync(USER_SIDECAR, { force: true });
  fs.rmSync(STORAGE_STATE, { force: true });
});
