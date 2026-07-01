# Settings & Profile (S-10 / FR-022) — Plan Brief

> Full plan: `context/changes/settings-profile/plan.md`

## What & Why

FR-022 wants a settings-and-profile surface: view basic account info, control theme (dark/light, following the device system setting by default until overridden), and control font size — plus re-enabling the dismissed startup-instruction pop-up. Today the app is hardcoded to a bespoke cosmic-dark look, so a real light theme doesn't exist. This slice makes theming real by re-skinning the whole app to shadcn's **Caffeine** theme and adds the controls that drive it.

## Starting Point

The theme mechanism is already stubbed for this slice (`Layout.astro` reads a `theme` cookie + has a no-flash inline script, both dark-clamped, with comments reserving the widening for S-10). shadcn's light+dark tokens already exist in `global.css`, but ~180 hardcoded color literals across ~20 files (`text-white`, `bg-cosmic`, orbs, starfield) ignore them. There's no `/settings` route and no font-size mechanism. Startup-reset is a device-local `localStorage` flag; profile data (email, created_at) is already on `Astro.locals.user`.

## Desired End State

The app renders in Caffeine, dark by default and following the OS when set to System. A refactored dashboard top bar shows "Veriffica" + an account icon whose dropdown offers Settings, a quick Light⇄Dark toggle, and Sign out. `/settings` shows email + member-since and lets the user pick System/Light/Dark, S/M/L text size, and re-enable the startup guide. Every choice persists across reloads with no flash; System live-follows the OS; every screen is legible in both modes.

## Key Decisions Made

| Decision             | Choice                                                                               | Why (1 sentence)                                                                                                        | Source |
| -------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| Light-theme approach | Adopt shadcn tokens everywhere; apply **Caffeine** theme                             | Real light+dark for free from the token system; retire the bespoke cosmic look rather than design a light variant of it | Plan   |
| Font-size control    | Discrete **S / M / L** root scaling                                                  | Simple, predictable, testable; no per-component edits                                                                   | Plan   |
| Preference storage   | **Device-local cookies** (theme, fontScale); localStorage for startup-reset          | No migration; matches offline-first + the existing SSR cookie read; startup flag already device-local                   | Plan   |
| Settings surface     | Single **`/settings`** page                                                          | One route/nav entry for a small amount of content                                                                       | Plan   |
| Navigation           | Top bar = "Veriffica" + account icon → dropdown (Settings · theme toggle · Sign out) | User-specified; reuses one element present on the dashboard                                                             | Plan   |
| Theme model          | Settings = System/Light/Dark; dropdown = quick Light⇄Dark                            | System default lives where it belongs; dropdown stays an obvious one-tap toggle                                         | Plan   |
| System behavior      | **Live-follow** the OS via `matchMedia`                                              | Takes "follows the device system setting" literally                                                                     | Plan   |
| Profile content      | Email + member-since                                                                 | Both already on the user object; zero extra query                                                                       | Plan   |
| Startup-reset UX     | **Toggle** reflecting current state                                                  | Shows state and both hides/re-enables from one control                                                                  | Plan   |
| Phasing              | Infra → settings UI → full re-skin → tests; no cut                                   | Avoids a half-cosmic/half-Caffeine mix                                                                                  | Plan   |

## Scope

**In scope:** Caffeine re-skin of the whole app; widened `{system,light,dark}` theme with no-flash SSR + live OS-follow; S/M/L font scaling; account-icon dropdown; `/settings` with profile + controls + startup-reset toggle; unit + one e2e test.

**Out of scope:** account-level/roaming preferences (no DB/migration); editable profile / password reset; per-page bespoke light design; inspection count; new public top-nav component; any auth/RLS/sync/offline changes.

## Architecture / Approach

Cookies (`theme`, `fontScale`) are read at SSR in `Layout.astro` and re-applied by a blocking inline `<head>` script that resolves `system → matchMedia` before first paint (server/client resolver parity is the key invariant). A small `src/lib/theme.ts` runtime owns read/write/apply and the `matchMedia` live-follow listener. UI (account dropdown + settings controls) calls into that runtime. Colors move from literals to semantic tokens (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border`, `bg-primary`) so `.dark` toggling recolors everything.

## Phases at a Glance

| Phase                       | What it delivers                                              | Key risk                                                          |
| --------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Theming foundation       | Caffeine palette + widened resolver + font scaling + no-flash | Server/client resolver drift → FOUC/hydration mismatch            |
| 2. Dropdown + settings page | Account dropdown, `/settings`, profile, controls              | Preserving the Dexie-wipe signout when it moves into the dropdown |
| 3. Full re-skin             | ~20 files converted literals → tokens                         | Broad surface; missed literals break light mode                   |
| 4. Tests & verification     | Unit (resolver/font) + e2e (persist/FOUC/system-follow)       | e2e flakiness around media emulation                              |

**Prerequisites:** none (Stream C, standalone). shadcn CLI available for `dropdown-menu` + the Caffeine theme.
**Estimated effort:** ~3–4 sessions across 4 phases; Phase 3 is the largest (mechanical but broad).

## Open Risks & Assumptions

- Assumes Caffeine installs cleanly via `npx shadcn add https://tweakcn.com/r/themes/caffeine.json` and reconciles with the existing `@theme inline` block; otherwise paste values manually.
- The no-flash guarantee hinges on the inline script and server resolver staying in exact lockstep — the main correctness risk.
- Retiring the cosmic aesthetic is a deliberate visual change; dark mode will look like Caffeine, not the current navy/orbs.

## Success Criteria (Summary)

- User can set theme (System/Light/Dark) and font size (S/M/L) that persist across reloads with no flash, and System live-follows the OS.
- User can view profile (email + member-since) and re-enable the startup guide, all from `/settings` reached via the account dropdown.
- Every screen is legible in both light and dark; no cosmic literals remain.
