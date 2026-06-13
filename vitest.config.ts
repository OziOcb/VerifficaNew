import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Tests run in plain Node — NOT the workerd runtime and NOT astro:env. They read
// local Supabase credentials from process.env, loaded here from `.env` via Vite's
// loadEnv. The "" prefix loads ALL vars (not just VITE_-prefixed ones), so
// SUPABASE_URL, SUPABASE_KEY (anon), and SUPABASE_SERVICE_ROLE_KEY are available.
const env = loadEnv("test", process.cwd(), "");

export default defineConfig({
  resolve: {
    // Mirror the app's "@/*" -> "src/*" alias so the test helper can import @/db/database.types.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Surface the loaded .env values to process.env for the test helper.
    env,
    // Playwright owns tests/e2e (its `test`/`expect` are not vitest's). Vitest's
    // default glob would otherwise try to run the *.spec.ts there and fail.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
  },
});
