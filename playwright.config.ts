import { loadEnv } from "vite";
import { defineConfig, devices } from "@playwright/test";

// Two modes, branched on SMOKE_DEPLOYED:
//   - unset (default): the localhost e2e — builds + boots the app via wrangler
//     dev and seeds a LOCAL Supabase user.
//   - set: the deployed workerd smoke-gate (test-plan Phase 4, Risk #5) — targets
//     the LIVE Worker, omits the local web server, and reads PROD Supabase creds
//     from `.env.smoke` so any ephemeral user lands in the right project.
const SMOKE_DEPLOYED = !!process.env.SMOKE_DEPLOYED;

// Local e2e loads `.env` (local Supabase). The deployed smoke loads `.env.smoke`
// (prod URL + anon + service-role) instead — its mode-specific values override
// `.env`, so the ephemeral user is never created against the local project.
Object.assign(process.env, loadEnv(SMOKE_DEPLOYED ? "smoke" : "test", process.cwd(), ""));

// Dedicated e2e port (NOT 4321). `npm run dev` (astro dev) and the e2e's
// `wrangler dev` both default to 4321; sharing it means Playwright's
// `reuseExistingServer` silently reuses a running dev server (Vite-dev modules,
// no service worker) instead of the built app, and a build-test SW left on 4321
// hijacks later dev sessions (see lessons.md). A separate port isolates both.
const PORT = 4322;
const LOCAL_BASE_URL = `http://localhost:${PORT}`;
const DEPLOYED_BASE_URL = process.env.SMOKE_URL ?? "https://veriffica.veriffica.workers.dev";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  timeout: 90_000,
  use: {
    baseURL: SMOKE_DEPLOYED ? DEPLOYED_BASE_URL : LOCAL_BASE_URL,
    trace: "on-first-retry",
  },
  projects: SMOKE_DEPLOYED
    ? [
        // deployed-setup creates an ephemeral PROD user and signs in through the
        // LIVE UI (persisting storageState); its `teardown` cascade-deletes that
        // user after the run — even on failure.
        {
          name: "deployed-setup",
          testMatch: /deployed-auth\.setup\.ts/,
          teardown: "deployed-teardown",
        },
        { name: "deployed-teardown", testMatch: /deployed-auth\.teardown\.ts/ },
        {
          // Both rungs run here: the unauthenticated probes override storageState
          // to empty in-spec (so the 401 probe really is unauthenticated), the
          // authenticated round-trip uses this project's storageState cookie.
          name: "deployed",
          testMatch: /deployed-smoke\.spec\.ts/,
          use: { storageState: "playwright/.auth/deployed-user.json" },
          dependencies: ["deployed-setup"],
        },
      ]
    : [
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
          // The deployed-smoke spec targets the LIVE Worker; never run it against
          // localhost during the normal e2e.
          testIgnore: /deployed-smoke\.spec\.ts/,
          use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
          dependencies: ["setup"],
        },
      ],
  // The service worker is emitted ONLY by a production build, so the local e2e
  // runs against the built app served by wrangler (the Cloudflare adapter has no
  // working `astro preview`). Requires local Supabase running for auth. The
  // deployed smoke targets the LIVE Worker, so it omits the web server entirely.
  webServer: SMOKE_DEPLOYED
    ? undefined
    : {
        command: `npm run build && npx wrangler dev --port ${PORT} --ip 127.0.0.1`,
        url: LOCAL_BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
