# Settings & Profile (S-10 / FR-022) Implementation Plan

## Overview

Deliver the settings-and-profile slice: a protected `/settings` page (read-only profile + theme control + font-size control + a toggle to re-enable the dismissed startup-instruction pop-up), reached via a refactored dashboard top bar that shows "Veriffica" on the left and an account-icon dropdown (Settings · quick Light⇄Dark toggle · Sign out) on the right. Theme becomes a real `{system, light, dark}` control (system-default until overridden, live-following the OS) and font size becomes discrete S/M/L scaling. Both are **device-local cookies**; the startup-reset flag stays device-local `localStorage`.

To make a genuine light theme exist, the app is **re-skinned from its bespoke cosmic-dark look to shadcn's Caffeine theme**: `global.css` adopts the Caffeine token palette and every page's hardcoded color literals (`text-white`, `bg-cosmic`, `text-blue-100/70`, orbs, starfield) are converted to semantic utilities (`bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `border`, …) so flipping the `.dark` class recolors the entire app.

## Current State Analysis

- **Theme mechanism is already stubbed for this slice.** `src/layouts/Layout.astro:12-38` reads a `theme` cookie, runs `resolveTheme()` (currently dark-clamped), sets `class:list={theme}` on `<html>`, and has a blocking inline `<head>` script re-asserting `dark` — with comments explicitly reserving this for "S-10 will widen the allowed set to {light, dark, system} and add the toggle that writes the `theme` cookie." This is the intended architecture: a cookie read at SSR + a no-flash inline script.
- **shadcn light+dark tokens already exist** in `src/styles/global.css:6-73` (`:root` + `.dark` blocks, neutral base) plus the `@theme inline` mapping (`:75-111`) and `@custom-variant dark (&:is(.dark *))` (`:4`). `body` already uses `@apply bg-background text-foreground` (`:132-134`).
- **But the app doesn't use those tokens.** ~180 literal color utilities across ~20 files hardcode the cosmic aesthetic. Heaviest: `Home.astro` (52), `SessionScreen.tsx` (28), `QuestionCards.tsx` (23), `DashboardBoard.tsx` (18), `Part1Form.tsx` (9), `Topbar.astro` (7), auth pages/forms, `[part].astro`, `session.astro`, `dashboard.astro`, `EquipmentToggles.tsx`, `StartupInstructions.tsx`, `SignOutButton.tsx`. Shared palette constants live in `DashboardBoard.tsx:45-48` (`GLASS_PANEL`, `DIALOG_PANEL`, `PRIMARY_BTN`, `OUTLINE_BTN`).
- **No `/settings` or `/profile` route, no nav to one.** The dashboard top bar is inline in `dashboard.astro:50-55` (email chip + `<SignOutButton client:only>`). `Topbar.astro` is the public/inspection equivalent.
- **No font-size mechanism.** Tailwind v4 is rem-based, so scaling root `font-size` scales app-wide text.
- **Startup-reset flag:** `localStorage["veriffica:hideStartupInstructions:<userId>"] === "1"` via `hideStartupKey()` (`src/lib/inspections.ts:28`), written/read in `DashboardBoard.tsx:79,102,112`. User-scoped, survives logout (`SignOutButton.tsx` comment), device-local.
- **Profile data:** `Astro.locals.user` is the full Supabase user (`middleware.ts:13`) — `email` and `created_at` available with no extra query.
- **shadcn CLI configured:** `components.json` — new-york, `rsc:false`, `tsx:true`, `cssVariables:true`, `baseColor:neutral`, css at `src/styles/global.css`, ui alias `@/components/ui`. `dropdown-menu` is **not** yet installed (present: alert-dialog, button, card, dialog, input, label, select).
- **Tests:** vitest unit specs (`tests/*.test.ts`) + Playwright e2e (`tests/e2e/*.spec.ts`).
- **Protected routes:** `PROTECTED_ROUTES = ["/dashboard", "/inspections"]` in `middleware.ts:4`.

### Key Discoveries:

- Widening theme is a two-side change that must stay in lockstep: the **server** `resolveTheme()` in `Layout.astro` and the **inline `<head>` script** must resolve identically, or SSR and first client paint disagree → hydration/flash. `system` cannot be resolved on the server (no `prefers-color-scheme` at SSR) — the server emits a neutral/`system` marker and the inline script resolves it via `matchMedia` **before first paint**.
- Caffeine is a warm-neutral light + warm dark palette (`radius: 0.5rem`) and additionally defines `font-sans/serif/mono`, `shadow-*`, `spacing`, and `tracking` vars. Install via `npx shadcn@latest add https://tweakcn.com/r/themes/caffeine.json` (writes the `:root`/`.dark` var values into `global.css`), or paste the registry values manually.
- Font scaling and theme are independent cookies but share the same no-flash contract — both must be applied by the inline script before paint.
- `SignOutButton` is the single dashboard island importing `@/lib/db` (Dexie), so it must stay `client:only="react"`; its Dexie-wipe-before-signout obligation must be preserved when it moves into the dropdown.

## Desired End State

A user on any device sees the app rendered in Caffeine (dark by default, following their OS if set to System). From the dashboard top bar they open the account dropdown to quick-toggle light/dark or sign out, or navigate to `/settings` where they see their email + member-since, pick System/Light/Dark, pick S/M/L text size, and re-enable the startup guide. Every choice persists across reloads with no flash, and System live-follows the OS. Every screen — public, auth, dashboard, inspection — is legible in both light and dark. Verified by unit tests (resolver + font mapping) and a Playwright e2e (persist across reload, no FOUC, System live-follow, dropdown toggle).

## What We're NOT Doing

- **No account-level / roaming preferences.** No Supabase profile table, no migration — preferences are device-local cookies (theme, fontScale) and localStorage (startup-reset).
- **No editable profile** (no avatar, no email/password change, no account deletion). Profile is read-only email + member-since. Password reset is FR-025, a separate slice.
- **No per-page bespoke light design.** We adopt Caffeine's tokens uniformly; we do not hand-design custom light variants per screen, and we retire (not re-theme) the cosmic gradient/orbs/starfield.
- **No inspection count on the profile** (avoids an extra query).
- **No new shared top-nav component for public pages.** Only the dashboard top bar is refactored to the icon+dropdown; `Topbar.astro` is re-skinned to tokens but keeps its current link shape.
- **No changes to auth, RLS, sync, or the offline store.**

## Implementation Approach

Bottom-up: first make theming real and safe (Caffeine palette + widened cookie-driven, no-flash resolver + font-size scaling + a small client runtime), then build the UI that drives it (dropdown + settings page), then mechanically convert every page's literals to tokens, then lock behavior with tests. Phases 1–2 are additive and low-risk; Phase 3 is broad but mechanical; Phase 4 guards the cross-cutting UX.

## Critical Implementation Details

- **Server/client resolver parity (no-flash).** `resolveTheme(cookieValue)` must accept `"system" | "light" | "dark" | undefined` and return the class to apply. For `light`/`dark` the server sets the class directly. For `system`/absent, the server cannot know the OS preference, so it must **defer to the inline script**: emit no theme class (or a placeholder) server-side and have the blocking inline `<head>` script compute `system → matchMedia("(prefers-color-scheme: dark)")` and set `.dark` before `<body>` paints. The inline script and the client runtime module must share one resolution function (inlined verbatim) so all three sites agree. Keep the script blocking (not `type="module"`/deferred).
- **System live-follow.** When the stored theme is `system`, register a `matchMedia("(prefers-color-scheme: dark)")` `change` listener (in the client runtime module, mounted app-wide via a tiny island or the existing inline registration) that re-applies the resolved class. When the user picks an explicit light/dark override, detach/ignore the listener.
- **Font-size application.** Cookie `fontScale ∈ {sm, base, lg}` maps to a root `font-size` (e.g. 87.5% / 100% / 112.5%) applied via a `data-font-scale` attribute or class on `<html>`, set both server-side (from the cookie, in `Layout.astro`) and by the inline script (parity), with the CSS rule in `global.css`.
- **Cookie contract.** Both cookies are set client-side on control change (path=/, long max-age, `SameSite=Lax`); the server only reads them. Reuse the existing `theme` cookie name; add `fontScale`.

---

## Phase 1: Theming foundation (Caffeine palette, widened resolver, font scaling)

### Overview

Make a real light/dark/system theme and S/M/L font scaling exist end-to-end at the framework level, with no first-paint flash — before any settings UI consumes them.

### Changes Required:

#### 1. Caffeine palette in global.css

**File**: `src/styles/global.css`

**Intent**: Replace the neutral shadcn `:root` and `.dark` variable values with Caffeine's, and register Caffeine's extra tokens so the whole app renders in the new theme.

**Contract**: Overwrite the `:root` (`:6-39`) and `.dark` (`:41-73`) variable blocks with Caffeine's light/dark oklch values; set `--radius: 0.5rem`. Add Caffeine's `--font-sans/serif/mono`, `--shadow-*`, `--spacing`, `--tracking-*` vars and expose the ones the app uses through `@theme inline` (`:75-111`). Add a root font-size scaling rule keyed off `html[data-font-scale="sm|base|lg"]`. Preferred method: `npx shadcn@latest add https://tweakcn.com/r/themes/caffeine.json` then reconcile against the existing `@theme inline` block; otherwise paste registry values.

#### 2. Widen the SSR theme resolver + font-scale read

**File**: `src/layouts/Layout.astro`

**Intent**: Turn the dark-clamp into a real resolver over `{system,light,dark}`, apply the font-scale cookie, and make the inline no-flash script resolve `system` via `matchMedia` and apply both preferences before paint.

**Contract**: `resolveTheme(value: string | undefined): "light" | "dark" | null` — returns the explicit class for light/dark, `null` for system/absent (defer to client). Read `fontScale` cookie → `data-font-scale` on `<html>`. Rewrite the inline `<head>` script to: read the same cookies, resolve `system → matchMedia`, set `.dark`/light class and `data-font-scale` on `documentElement` before body paints. Server `class:list` and the inline script must not disagree for explicit values. Keep the script blocking inline.

#### 3. Client theme/font runtime module

**File**: `src/lib/theme.ts` (new)

**Intent**: One shared place for reading/writing the preference cookies, resolving the effective theme, applying it to `<html>`, and live-following the OS when in system mode.

**Contract**: Export `type ThemeChoice = "system" | "light" | "dark"`, `type FontScale = "sm" | "base" | "lg"`; `getThemeChoice()`, `setThemeChoice(c)`, `getFontScale()`, `setFontScale(s)` (read/write cookies), `applyTheme()`/`applyFontScale()` (mutate `documentElement`), and `initSystemFollow()` registering the `matchMedia` `change` listener that re-applies while choice is `system`. The resolution logic must match the inline script in `Layout.astro` exactly (single source of truth — the inline script may import/duplicate this verbatim).

#### 4. App-wide system-follow registration

**File**: `src/layouts/Layout.astro` (registration) + `src/lib/theme.ts`

**Intent**: Ensure `initSystemFollow()` runs on every page so a System user sees live OS switches without needing the settings page mounted.

**Contract**: Call `initSystemFollow()` from the existing client script block in `Layout.astro` (guarded so it's a no-op when an explicit override is set). No new island required.

### Success Criteria:

#### Automated Verification:

- [ ] `npx astro sync` succeeds
- [ ] Type checking passes: `npm run lint`
- [ ] Unit tests pass for the resolver + font mapping: `npm test`
- [ ] Production build succeeds: `npm run build`

#### Manual Verification:

- [ ] With no cookie, the app follows the OS light/dark setting on first load with no flash
- [ ] Setting the `theme` cookie to `light`/`dark` renders that mode server-side (view source shows the class) with no flash
- [ ] Toggling the OS theme while in system mode live-switches the app
- [ ] `fontScale` cookie visibly scales text app-wide at sm/base/lg

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Account dropdown + settings page + profile & controls

### Overview

Build the UI that drives the Phase 1 machinery: a refactored dashboard top bar with an account-icon dropdown, and the `/settings` page with profile, theme, font-size, and startup-reset controls.

### Changes Required:

#### 1. Add shadcn dropdown-menu

**File**: `src/components/ui/dropdown-menu.tsx` (new, generated)

**Intent**: Provide the Radix dropdown primitive for the account menu.

**Contract**: `npx shadcn@latest add dropdown-menu` (new-york, matches `components.json`). No manual edits beyond what the CLI emits.

#### 2. Account menu island

**File**: `src/components/dashboard/AccountMenu.tsx` (new)

**Intent**: The account-icon dropdown: Settings link, quick Light⇄Dark toggle, and Sign out — folding in the existing Dexie-wipe signout behavior.

**Contract**: `client:only="react"` island (it uses the Dexie-wiping signout, so it inherits `SignOutButton`'s `client:only` constraint). Renders a `DropdownMenu` triggered by an account icon (lucide) with: (a) a Settings item linking to `/settings`; (b) a theme item that flips `light⇄dark` via `setThemeChoice` + `applyTheme` from `@/lib/theme` (sun/moon icon reflecting current effective theme); (c) a Sign out item that performs the `db.delete()` wipe then submits the `/api/auth/signout` form (port logic from `SignOutButton.tsx`). Retire or reduce `SignOutButton.tsx` accordingly.

#### 3. Refactor the dashboard top bar

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the email chip + inline sign-out row with "Veriffica" (left) and the account icon dropdown (right).

**Contract**: Swap the `:50-55` header block for a token-styled bar: plain "Veriffica" text left, `<AccountMenu client:only="react" userEmail={user?.email} />` right. Remove the direct `SignOutButton` mount here.

#### 4. Settings page route

**File**: `src/pages/settings.astro` (new)

**Intent**: The protected settings surface hosting profile + all controls.

**Contract**: SSR page reading `Astro.locals.user` for `email` and `created_at` (member-since, formatted with the same UTC-deterministic approach as `DashboardBoard.formatDate` to avoid hydration drift). Wrapped in `Layout`, token-styled, back-link to dashboard. Mounts the controls island(s). Add `"/settings"` to `PROTECTED_ROUTES` in `src/middleware.ts:4`.

#### 5. Settings controls island

**File**: `src/components/settings/SettingsControls.tsx` (new)

**Intent**: The interactive controls: theme (System/Light/Dark), font size (S/M/L), and the startup-guide toggle.

**Contract**: `client:load` island. Theme: a 3-way segmented control writing `setThemeChoice` + `applyTheme` + (re)arming `initSystemFollow` when System is chosen. Font: 3-way S/M/L writing `setFontScale` + `applyFontScale`. Startup toggle: reads/writes `localStorage[hideStartupKey(userId)]` — "on" = guide shows (flag absent/`"0"`), "off" = hidden (`"1"`); needs `userId` prop. Uses shadcn primitives + Caffeine tokens. (The startup toggle is device-local, so it renders client-side and reflects this browser only.)

### Success Criteria:

#### Automated Verification:

- [ ] `npx astro sync` succeeds
- [ ] Lint/type check passes: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] Unit test for the startup-toggle flag logic passes: `npm test`

#### Manual Verification:

- [ ] Account icon opens the dropdown; Settings navigates to `/settings`; quick toggle flips light/dark; Sign out wipes local store and ends the session
- [ ] `/settings` redirects to sign-in when logged out
- [ ] Profile shows correct email + member-since
- [ ] Theme, font, and startup-guide controls all take effect and reflect current state
- [ ] Re-enabling the startup guide makes the pop-up reappear on the next "Start new inspection"

**Implementation Note**: After Phase 2 automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Full re-skin to Caffeine tokens

### Overview

Convert every hardcoded cosmic color literal to a semantic token so the whole app renders correctly in both Caffeine modes. Mechanical but broad.

### Changes Required:

#### 1. Shared palette constants

**File**: `src/components/dashboard/DashboardBoard.tsx`

**Intent**: Replace the cosmic glass-panel constants so all dashboard dialogs/cards/buttons follow the theme.

**Contract**: Rewrite `GLASS_PANEL`, `DIALOG_PANEL`, `PRIMARY_BTN`, `OUTLINE_BTN` (`:45-48`) to semantic utilities (`bg-card`, `text-card-foreground`, `border`, `bg-primary text-primary-foreground`, `bg-background`, etc.), and convert the inline literals throughout the component (headers, empty state, group cards, delete button).

#### 2. Page shells and components (literal → token sweep)

**File**: `src/components/Home.astro`, `src/pages/dashboard.astro`, `src/components/Topbar.astro`, `src/components/inspections/SessionScreen.tsx`, `src/components/inspections/QuestionCards.tsx`, `src/components/inspections/Part1Form.tsx`, `src/components/inspections/EquipmentToggles.tsx`, `src/components/dashboard/StartupInstructions.tsx`, `src/pages/inspections/[id]/session.astro`, `src/pages/inspections/[id]/session/part/[part].astro`, `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`, `src/components/auth/*`, `src/layouts/Layout.astro` (root `background`)

**Intent**: Replace `text-white`, `bg-white/*`, `text-blue-100/*`, `bg-cosmic`, `bg-slate-900/*`, purple/blue orbs and the starfield with semantic tokens (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border`, `bg-primary`, gradients recolored or removed), so light/dark both read correctly.

**Contract**: Retire `bg-cosmic` and the decorative orb/starfield markup (or replace with a neutral token background). Update `Layout.astro`'s `<style>` root `background` (`:80`) and the `<meta name="theme-color">` (`:29`) to token-appropriate values (consider per-mode theme-color). Preserve all layout/spacing classes; only colors change. Keep Tailwind class order as Prettier emits (don't hand-reorder).

#### 3. Retire dark-only assumptions

**File**: `src/components/dashboard/SignOutButton.tsx` (if still used elsewhere), any remaining `client:only` islands with hardcoded white text

**Intent**: Ensure no island keeps cosmic literals that break light mode.

**Contract**: Convert remaining literals to tokens; if `SignOutButton` is fully superseded by `AccountMenu`, remove it and its imports.

### Success Criteria:

#### Automated Verification:

- [ ] Lint/type check passes: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] No remaining cosmic literals: `grep -rn "bg-cosmic\|text-blue-100\|text-white" src/` returns only intentional cases (ideally none)

#### Manual Verification:

- [ ] Every screen (home, auth, dashboard, settings, inspection hub, Part 1 form, question cards) is legible and correctly styled in **light** mode
- [ ] Every screen is legible and correctly styled in **dark** mode
- [ ] No cosmic gradient/orb/starfield remnants; no white-on-white or black-on-black regions
- [ ] iOS safe-area dark canvas (`Layout.astro` root background) still looks correct per-mode

**Implementation Note**: After Phase 3 automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: Tests & verification

### Overview

Lock the risky cross-cutting behavior with unit tests for pure logic and one Playwright e2e for the headline UX.

### Changes Required:

#### 1. Unit tests for theme/font logic

**File**: `tests/theme.test.ts` (new)

**Intent**: Guard the resolver and font mapping that keep server/client in sync.

**Contract**: Cover `resolveTheme` for `light`/`dark`/`system`/`undefined`, the `fontScale → data-attr/scale` mapping, and cookie serialize/parse round-trips from `@/lib/theme`.

#### 2. E2e for persistence, FOUC, system-follow

**File**: `tests/e2e/settings-preferences.spec.ts` (new)

**Intent**: Prove preferences persist with no flash and System live-follows the OS.

**Contract**: Playwright spec (runs under `npm run dev` — no SW build needed): set theme + font on `/settings`, reload, assert the `<html>` class/attr and cookies persist and no flash occurs; assert the account-dropdown quick toggle flips the class; use Playwright's `emulateMedia({ colorScheme })` to assert System live-follows. Reuse `tests/e2e/helpers` + `auth.setup.ts` for an authenticated session.

### Success Criteria:

#### Automated Verification:

- [ ] Unit tests pass: `npm test`
- [ ] E2e passes: `npm run test:e2e` (or the project's Playwright script)
- [ ] Full lint + build green: `npm run lint && npm run build`

#### Manual Verification:

- [ ] Final walkthrough: switch theme + font from both the dropdown and settings, reload, navigate across pages — everything persists and looks right in both modes

**Implementation Note**: Final phase — after automated + manual verification, the slice is ready to close.

---

## Testing Strategy

### Unit Tests:

- `resolveTheme` across all cookie values incl. `system`/absent
- `fontScale` → scale/attribute mapping
- Cookie read/write round-trips
- Startup-toggle flag semantics (on/off ↔ localStorage `"1"`/absent)

### Integration Tests:

- Playwright e2e: persistence across reload, no FOUC, System live-follow (`emulateMedia`), dropdown quick toggle, `/settings` auth redirect

### Manual Testing Steps:

1. Fresh browser (no cookies) → app follows OS theme, no flash
2. `/settings` → pick Light, reload → stays light (view source shows class)
3. Pick System, flip OS dark mode → app live-switches
4. Pick font L → text scales app-wide; reload → persists
5. Toggle startup guide on → "Start new inspection" shows the pop-up again
6. Walk every screen in light and dark; confirm legibility

## Performance Considerations

The inline no-flash script must stay tiny and blocking. Re-skin is CSS-class-only (no runtime cost). `matchMedia` listener is a single lightweight subscription active only in System mode.

## Migration Notes

No data migration — preferences are cookies/localStorage. Existing users with the legacy dark-clamp `theme` cookie value resolve safely (unknown value → treated as system/default).

## References

- Change identity: `context/changes/settings-profile/change.md`
- PRD: FR-022 (`context/foundation/prd.md:180`); NFR legibility (`prd.md:195`)
- Roadmap: S-10 (`context/foundation/roadmap.md:58`, Stream C)
- Theme hooks: `src/layouts/Layout.astro:12-38`; tokens: `src/styles/global.css:6-111`
- Startup flag: `src/lib/inspections.ts:28`, `src/components/dashboard/DashboardBoard.tsx:79-112`
- Signout/Dexie constraint: `src/components/dashboard/SignOutButton.tsx`
- Lessons: field-casing & workerd parity (`context/foundation/lessons.md`)
- Caffeine theme: `https://tweakcn.com/r/themes/caffeine.json`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Theming foundation

#### Automated

- [x] 1.1 `npx astro sync` succeeds — 5efeb95
- [x] 1.2 Type checking passes: `npm run lint` — 5efeb95
- [x] 1.3 Unit tests pass for resolver + font mapping: `npm test` — 5efeb95
- [x] 1.4 Production build succeeds: `npm run build` — 5efeb95

#### Manual

- [x] 1.5 No-cookie load follows OS light/dark with no flash — 5efeb95
- [x] 1.6 `theme` cookie light/dark renders server-side with no flash — 5efeb95
- [x] 1.7 System mode live-switches on OS theme change — 5efeb95
- [x] 1.8 `fontScale` cookie scales text app-wide at sm/base/lg — 5efeb95

### Phase 2: Account dropdown + settings page

#### Automated

- [x] 2.1 `npx astro sync` succeeds — 3896017
- [x] 2.2 Lint/type check passes: `npm run lint` — 3896017
- [x] 2.3 Build succeeds: `npm run build` — 3896017
- [x] 2.4 Startup-toggle flag unit test passes: `npm test` — 3896017

#### Manual

- [x] 2.5 Dropdown opens; Settings navigates; quick toggle flips theme; Sign out wipes store + ends session — 3896017
- [x] 2.6 `/settings` redirects to sign-in when logged out — 3896017
- [x] 2.7 Profile shows correct email + member-since — 3896017
- [x] 2.8 Theme/font/startup controls take effect and reflect current state — 3896017
- [x] 2.9 Re-enabling startup guide makes the pop-up reappear — 3896017

### Phase 3: Full re-skin to Caffeine tokens

#### Automated

- [x] 3.1 Lint/type check passes: `npm run lint`
- [x] 3.2 Build succeeds: `npm run build`
- [x] 3.3 Cosmic-literal grep returns only intentional cases

#### Manual

- [x] 3.4 Every screen legible/correct in light mode
- [x] 3.5 Every screen legible/correct in dark mode
- [x] 3.6 No cosmic remnants; no white-on-white / black-on-black
- [x] 3.7 iOS safe-area root background correct per-mode

### Phase 4: Tests & verification

#### Automated

- [ ] 4.1 Unit tests pass: `npm test`
- [ ] 4.2 E2e passes: `npm run test:e2e`
- [ ] 4.3 Full lint + build green: `npm run lint && npm run build`

#### Manual

- [ ] 4.4 Final walkthrough: switch theme + font from dropdown and settings, reload, navigate — persists and correct in both modes
