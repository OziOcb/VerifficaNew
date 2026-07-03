// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";
import AstroPWA from "@vite-pwa/astro";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [
    react(),
    sitemap(),
    AstroPWA({
      registerType: "autoUpdate",
      // Astro SSR does not auto-inject the registration script, so we register the
      // SW manually in Layout.astro. Disable injection to avoid a dead registerSW.js.
      injectRegister: false,
      manifest: {
        name: "Veriffica",
        short_name: "Veriffica",
        start_url: "/",
        display: "standalone",
        background_color: "#f8f9fb",
        theme_color: "#f8f9fb",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Take control of open clients as soon as the new SW activates, so the
        // first reload is already controlled and caches the navigation.
        skipWaiting: true,
        clientsClaim: true,
        // Only static client assets exist to precache (pages are server-rendered).
        // `woff2` included so the self-hosted brand font caches for offline use.
        globPatterns: ["**/*.{js,css,svg,png,ico,webmanifest,woff2}"],
        // SSR has no static app-shell HTML, so the default navigateFallback ("/")
        // points at a non-precached URL and would break the SW at startup. Disable
        // it and serve navigations from a runtime cache instead.
        navigateFallback: undefined,
        runtimeCaching: [
          {
            // Server-rendered page navigations: NetworkFirst so online visits get
            // fresh SSR (including the session-stamped userId), while an offline
            // reload of a previously-visited page (e.g. /inspections/{id}) is served
            // from cache. The island bundles are precached, so the page rehydrates
            // and reads Dexie offline. Never cache auth or protected routes
            // (research Decision #4) — they stay network-only.
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" &&
              !url.pathname.startsWith("/api") &&
              !url.pathname.startsWith("/auth") &&
              !url.pathname.startsWith("/dashboard"),
            handler: "NetworkFirst",
            options: {
              cacheName: "pages",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
