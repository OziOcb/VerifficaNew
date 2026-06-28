#!/usr/bin/env node
// Deployed workerd smoke-gate orchestrator (test-plan Phase 4, Risk #5).
//
// One command that captures `wrangler tail` evidence AROUND the Playwright
// deployed-smoke run:
//   1. start `wrangler tail` backgrounded to a timestamped log file;
//   2. run the Playwright `deployed` project against the LIVE Worker;
//   3. stop tail on exit (success OR failure) and print the log path.
//
// Tail output is human-reviewed evidence, not a programmatic oracle — a green
// Playwright run plus a clean tail log (no Node-API / nodejs_compat / undefined-
// env errors) is the parity confirmation. The Playwright exit code is propagated.
//
// Prereqs: a deploy reflecting the commit under test on the live Worker, a
// wrangler login with tail access, and (for Phase 2's authenticated rung)
// `.env.smoke` with prod Supabase creds.

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";

const DEPLOYED_URL = process.env.SMOKE_URL ?? "https://veriffica.veriffica.workers.dev";

const LOG_DIR = path.join(process.cwd(), "smoke-logs");
mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = path.join(LOG_DIR, `tail-${stamp}.log`);

console.log(`[smoke:deployed] target:  ${DEPLOYED_URL}`);
console.log(`[smoke:deployed] tail log: ${logPath}`);

// Start `wrangler tail` first so the smoke's requests are captured. Pretty
// format keeps the log human-readable for evidence review.
const logStream = createWriteStream(logPath, { flags: "a" });
const tail = spawn("npx", ["wrangler", "tail", "--format", "pretty"], {
  stdio: ["ignore", "pipe", "pipe"],
});
tail.stdout.pipe(logStream);
tail.stderr.pipe(logStream);

let tailStopped = false;
function stopTail() {
  if (tailStopped) return;
  tailStopped = true;
  tail.kill("SIGINT");
}

// Kill tail even on an unexpected exit so no orphaned connection lingers.
process.on("exit", stopTail);
process.on("SIGINT", () => {
  stopTail();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopTail();
  process.exit(143);
});

// Give tail a moment to connect before driving traffic at the Worker.
await new Promise((resolve) => setTimeout(resolve, 4_000));

// Run the deployed Playwright project. SMOKE_DEPLOYED flips playwright.config.ts
// to the live baseURL + no local web server.
const playwright = spawn("npx", ["playwright", "test", "--project", "deployed"], {
  stdio: "inherit",
  env: { ...process.env, SMOKE_DEPLOYED: "1" },
});

const code = await new Promise((resolve) => {
  playwright.on("close", resolve);
});

// Stop tail and let the last lines flush to the log before we print the path.
stopTail();
await new Promise((resolve) => setTimeout(resolve, 500));
logStream.end();

console.log(`\n[smoke:deployed] tail log: ${logPath}`);
console.log(
  "[smoke:deployed] review the tail log for Node-API / nodejs_compat / undefined-env errors — every request should read Ok.",
);

process.exit(code ?? 1);
