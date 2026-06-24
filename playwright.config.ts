import { loadEnv } from "vite";
import { defineConfig, devices } from "@playwright/test";

// Mirror vitest.config.ts: load local Supabase credentials from `.env` into
// process.env so the e2e can seed/tear down a confirmed user via
// tests/helpers/supabase.ts (service-role admin client).
Object.assign(process.env, loadEnv("test", process.cwd(), ""));

const PORT = 4321;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  timeout: 90_000,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    // Setup signs in a shared user and persists storageState; its `teardown`
    // project deletes that user after the run.
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      teardown: "teardown",
    },
    { name: "teardown", testMatch: /auth\.teardown\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  // The service worker is emitted ONLY by a production build, so the e2e runs
  // against the built app served by wrangler (the Cloudflare adapter has no
  // working `astro preview`). Requires local Supabase running for auth.
  webServer: {
    command: `npm run build && npx wrangler dev --port ${PORT} --ip 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
