import { test as teardown } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { deleteUser } from "../helpers/supabase";

// Deployed-smoke teardown: cascade-delete the ephemeral PROD user created by
// deployed-auth.setup.ts. The FK cascade on inspections.owner_id clears any row
// the round-trip left behind (the in-spec `delete` op is the primary cleanup;
// this is the backstop), so no test residue persists in production. Wired via the
// deployed-setup project's `teardown` dependency in playwright.config.ts, so it
// runs even when the smoke fails mid-run.

const AUTH_DIR = path.join(process.cwd(), "playwright", ".auth");
const STORAGE_STATE = path.join(AUTH_DIR, "deployed-user.json");
const USER_SIDECAR = path.join(AUTH_DIR, "deployed-user.meta.json");

teardown("delete ephemeral prod user", async () => {
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
