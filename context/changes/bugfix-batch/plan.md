# Bugfix Batch: Dark-canvas white bars (safe-area + card-transition) Implementation Plan

## Overview

Two reported white bars on a real iPhone — Bug 1 (white strips at the top/bottom, framing the dark page) and Bug 2 (a white bar flashing on the right during the answer slide-transition) — are the **same root cause**: the app never establishes a dark background at the document root. It runs in shadcn's default **light** mode (`:root --background` = white, `theme-color` = white) and paints the dark theme only on inner `bg-cosmic` wrappers. Every place those wrappers can't reach (iOS safe-area insets; the card-transition's horizontal `translateX`) reverts to the white canvas.

This plan applies **one shared root fix** — establish a dark canvas at the document root — plus **two thin symptom finishes**. It also lays a small, dark-clamped theming **infrastructure hook** (cookie read + blocking head-script) so the future **S-10 settings-profile** slice can introduce a real light/dark toggle and system-preference support without re-plumbing. The visible toggle, system-preference resolution, and light-aware pages are **explicitly out of scope** here (S-10 owns them).

## Current State Analysis

- **Root is light.** `global.css:8` `:root --background: oklch(1 0 0)` (white). The `.dark` token block exists (`global.css:42-73`) but is **never activated** — `<html lang="en">` has no `dark` class (`Layout.astro:14`) and nothing adds it.
- **Body paints the white canvas.** `global.css:121-122` `body { @apply bg-background }` → white.
- **Dark is inner decoration only.** `@utility bg-cosmic` is a fixed dark gradient `linear-gradient(to bottom, #0a0e1a, #0f1529, #0a0e1a)` (`global.css:113-115`), applied to inner `min-h-screen` divs on **every** page: `dashboard.astro:32`, `Home.astro:7`, `auth/signin.astro:9`, `auth/signup.astro:9`, `auth/confirm-email.astro:22`, `session.astro:65`, `[part].astro:94,102`. A gradient on an inner box cannot paint the safe-area insets or transition overflow.
- **iOS chrome forced white.** `Layout.astro:20` `theme-color content="#ffffff"`; `Layout.astro:17` viewport has **no** `viewport-fit=cover`; no `env(safe-area-inset-*)` padding anywhere in `src`.
- **Card transition is unclipped.** `QuestionCards.tsx:253-257` keys a wrapper on `index` and replays `slide-in-from-right-8` (~2rem `translateX`) on each card change; no `overflow-x` containment on the deck or any ancestor (`[part].astro` `main`, the `bg-cosmic` wrapper). The translate exposes the white root and can induce horizontal scroll.
- **No light design exists.** `bg-cosmic` is hardcoded dark; the pages assume a dark look (`text-white`, `text-blue-100/*`). There is no light variant of any page today.

## Desired End State

On a real iPhone, the app fills the entire screen with the dark canvas — **no white strips** at the top, bottom, or right edge, including during the answer slide-transition. The dark look is established at the document root (`<html class="dark">`, solid dark `body`, dark `theme-color`), so any region the inner `bg-cosmic` gradient doesn't cover still reads dark. A dark-clamped cookie + head-script hook is in place so S-10 can later flip themes.

**Verification:** load the inspection session on the device that produced the original screenshots/video; confirm no white bars statically and during transitions; confirm shadcn components (auth forms, dialogs, buttons) render coherently under dark tokens. Automated: lint, type-check, build, and the existing test suite stay green.

### Key Discoveries:

- Root canvas is white and `.dark` is never applied — `global.css:8,42`, `Layout.astro:14`.
- `bg-cosmic` gradient edge color is `#0a0e1a` — matching the solid body fill to this makes the bars invisible (`global.css:114`).
- `theme-color` is white and viewport lacks `viewport-fit=cover` — `Layout.astro:17,20`.
- Card deck transition translate is unclipped — `QuestionCards.tsx:253-257`.
- Astro is `output: "server"` (SSR), so reading a cookie server-side renders the correct `<html>` class with **zero flash** — no client script strictly required for today's dark-clamped behavior; the inline script is the forward hook for S-10.

## What We're NOT Doing

- **No visible theme toggle / settings UI** — that is S-10 (`settings-profile`, FR-022).
- **No system-preference resolution taking effect** — the infra hook clamps to dark now; honoring `prefers-color-scheme` / `light` ships with S-10's light-aware pages.
- **No light theme for any page** — `bg-cosmic` and page content stay dark-only; making them theme-aware is S-10.
- **No font-size control** — also S-10.
- **No refactor of `bg-cosmic`** beyond what's needed to paint the canvas dark.

## Implementation Approach

Fix the root cause once (dark canvas), then the two edge-specific finishes. Because the app is intended dark and no light design exists, enabling shadcn `.dark` globally makes the dark tokens the _correct_ ones — shadcn components (dialogs, buttons, inputs reading `bg-background`) become coherently dark. The canvas itself is filled with a **solid** `#0a0e1a` (the gradient's edge stop) rather than the gradient, so it can never misalign with the inner `bg-cosmic` gradient and seam.

The theming hook is deliberately minimal: SSR reads an optional `theme` cookie and **clamps the result to `dark`** today (any value → dark), rendering `<html class="dark">` and a dark `theme-color`. A small blocking inline head-script re-applies the same dark-clamped class before paint as the forward-compatible FOUC guard. S-10 will widen the clamp to `{light, dark, system}` and add the toggle that writes the cookie.

## Critical Implementation Details

- **Timing & lifecycle (FOUC):** Astro SSR renders `<html>` on the server, so applying the class from the server-read cookie is flash-free without JS. The inline head-script must run **before** `<body>` paints (place it in `<head>`, not deferred) — it exists so a future client-side toggle in S-10 can persist across reloads without a flash; today it just re-asserts dark.
- **Safe-area mechanics (Bug 1):** the white insets disappear from **two** combined changes — `viewport-fit=cover` lets the page extend _into_ the notch/home-indicator regions, and a **dark `body`/`html` background** is what actually paints those regions dark. `env(safe-area-inset-*)` padding is then applied to content containers so interactive content isn't hidden under the notch/indicator — it is not what removes the white, but it prevents content clipping once the page covers the full screen.
- **Overflow containment (Bug 2):** clip on the nearest stable ancestor of the keyed animating div (`QuestionCards.tsx:253`), not globally on `body` — a global `overflow-x: hidden` can silently break `position: sticky` and scroll-anchoring elsewhere. The clip must sit on an element that does **not** itself slide.

---

## Phase 1: Dark canvas + theme infra hook (shared root)

### Overview

Establish the dark canvas at the document root and lay the dark-clamped theming hook. This removes the _white color_ of both bars; phases 2 and 3 handle the edge geometry.

### Changes Required:

#### 1. Activate dark tokens at the root, via SSR cookie read

**File**: `src/layouts/Layout.astro`

**Intent**: Render `<html>` with the `dark` class so shadcn's `.dark` token block activates app-wide. Read an optional `theme` cookie server-side and **clamp to `dark`** (any/no value → dark) — this is the hook S-10 extends, but today it always resolves dark, giving zero-flash correct rendering.

**Contract**: `<html lang="en" class="dark">` is the rendered output today. Cookie read uses `Astro.cookies.get("theme")`; a small resolver clamps unknown/absent values to `"dark"`. Keep the resolver isolated (e.g. a local `const theme = resolveTheme(Astro.cookies.get("theme")?.value)` returning `"dark"` for now) so S-10 only widens the allowed set.

#### 2. Dark `theme-color` + `viewport-fit=cover`

**File**: `src/layouts/Layout.astro`

**Intent**: Tint the iOS browser chrome dark and allow the page to fill the whole screen (prerequisite for the Bug 1 finish). `viewport-fit=cover` is added here as part of the canvas setup; the safe-area padding it enables lands in Phase 2.

**Contract**: `theme-color` meta → `#0a0e1a` (dark). Viewport meta → `width=device-width, initial-scale=1, viewport-fit=cover` (currently `width=device-width` only, `Layout.astro:17`).

#### 3. Solid dark body canvas

**File**: `src/styles/global.css` and/or `src/layouts/Layout.astro` `<style>`

**Intent**: Fill the document canvas with a solid dark color matching the `bg-cosmic` gradient edge so anything showing through (insets, transition reveal) is invisible. With `.dark` active, `--background` is already dark (`oklch(0.145 0 0)`); pin the body to the exact gradient-edge color `#0a0e1a` so it seams perfectly with the inner gradient rather than relying on the slightly different token value.

**Contract**: `html, body` background resolves to `#0a0e1a`. The existing `Layout.astro` `<style>` block (`:53-60`, `html, body { margin:0; width:100%; height:100% }`) is the natural place for `background: #0a0e1a;`, or extend the `@layer base body` rule in `global.css`. Keep `height: 100%` so the canvas covers the viewport.

#### 4. Blocking inline head-script hook (forward-compatible FOUC guard)

**File**: `src/layouts/Layout.astro`

**Intent**: Add a tiny synchronous `<script>` in `<head>` that reads the `theme` cookie and applies the dark-clamped class to `document.documentElement` before paint. Today it re-asserts `dark`; it exists so S-10's client toggle persists across reloads without a flash. Must not be `type="module"`/deferred.

**Contract**: Inline `<head>` script, runs before `<body>`. Mirrors the server-side clamp (unknown/absent → `dark`), so server and client never disagree. No external imports; reads `document.cookie`.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` succeeds
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- Existing test suite passes: `npm test`

#### Manual Verification:

- On the dev server (desktop), the whole viewport is dark; no white anywhere around the page.
- Auth pages (signin/signup/confirm-email), dashboard, and an inspection session render coherently under dark shadcn tokens — no white form fields, dialogs, or buttons that look broken.
- View source confirms `<html class="dark">`, dark `theme-color`, and `viewport-fit=cover` are present on first paint (no flash).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Bug 1 finish — iOS safe area

### Overview

Make the dark canvas actually extend under the notch/home-indicator and keep content clear of those regions. Depends on `viewport-fit=cover` from Phase 1.

### Changes Required:

#### 1. Safe-area padding on edge-touching content containers

**File**: page wrappers that reach the screen edges — primarily `src/pages/inspections/[id]/session/part/[part].astro:94,102` (`bg-cosmic min-h-screen`), and the other `bg-cosmic min-h-screen` wrappers (`dashboard.astro:32`, `Home.astro:7`, `session.astro:65`, auth pages) as needed.

**Intent**: Once the page fills the full screen (`viewport-fit=cover`), pad content by the safe-area insets so headers/buttons aren't hidden under the notch or home-indicator. The dark canvas (Phase 1 body) already paints the insets dark; this only protects content.

**Contract**: Apply `env(safe-area-inset-top/bottom/left/right)` padding to the appropriate wrappers. Use Tailwind arbitrary values (e.g. `pt-[env(safe-area-inset-top)]`, `pb-[env(safe-area-inset-bottom)]`) or a shared utility class. Prefer applying to the existing `bg-cosmic` wrapper so the dark background still extends edge-to-edge while content is inset.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- On the real iPhone that showed Bug 1, the top status-bar strip and bottom home-indicator strip are **dark** (no white bars), matching `Desktop/bug 1.PNG` regions.
- Content (question text, answer buttons, headers) is not obscured by the notch or home-indicator.
- No regression in landscape / rotation if applicable.

**Implementation Note**: Requires the real-device check. Pause for manual confirmation before proceeding.

---

## Phase 3: Bug 2 finish — transition overflow containment

### Overview

Prevent the card-transition `translateX` from revealing the edge or inducing horizontal scroll.

### Changes Required:

#### 1. Contain horizontal overflow on the card deck

**File**: `src/components/inspections/QuestionCards.tsx` (around the keyed animating wrapper, `:253-257`) and/or its stable parent in `src/pages/inspections/[id]/session/part/[part].astro`.

**Intent**: Clip horizontal overflow on the nearest **non-sliding** ancestor of the keyed `slide-in-from-right-8` div so the ~2rem enter-translate is masked instead of exposing the canvas / creating a horizontal scrollbar. Do not clip globally on `body`.

**Contract**: Add `overflow-x: hidden` (Tailwind `overflow-x-hidden`) to the deck container that wraps the keyed animating div but does not itself transform. Confirm the clip ancestor is stable (the `space-y-6` deck root or the `[part].astro` `bg-cosmic`/`main` wrapper), not the keyed div itself.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- Existing `QuestionCards` / session tests pass: `npm test`

#### Manual Verification:

- On the real iPhone, tapping Yes / No / Don't know slides to the next card with **no white bar** on the right edge during the transition (matches `Desktop/bug 2.mp4` scenario, now fixed).
- No horizontal scrollbar / rubber-band appears during or after the transition.
- Back navigation (slide-from-left) is likewise clean.

**Implementation Note**: Requires the real-device check. Pause for manual confirmation.

---

## Testing Strategy

### Unit / Integration Tests:

- No new unit tests required for the canvas change (pure styling/markup). Keep the existing suite green (`npm test`), especially `QuestionCards`/session tests, after the Phase 3 wrapper change.

### Manual Testing Steps (real iPhone — the primary gate):

1. Open the app on the device that produced the original screenshots/video.
2. Confirm no white strips at top/bottom on any page (Bug 1).
3. Start an inspection session; answer several questions; confirm no white bar on the right during slide transitions and no horizontal scroll (Bug 2).
4. Exercise Back navigation; confirm clean left-slide.
5. Visually check auth forms, dialogs (education pop-up), and buttons under dark tokens.

### Desktop / dev-server checks (supporting):

- View source for `<html class="dark">`, dark `theme-color`, `viewport-fit=cover`.
- Resize / narrow the viewport and trigger transitions to sanity-check overflow containment.

## Performance Considerations

Negligible. The inline head-script is a few lines and runs once before paint. No new network requests or render cost.

## Migration Notes

The dark-clamped cookie hook is forward-compatible: S-10 widens the resolver's allowed values to `{light, dark, system}` and adds the toggle that writes the `theme` cookie. No data migration. If a `theme` cookie somehow exists with a non-dark value before S-10 ships, the clamp guarantees dark, so there is no broken intermediate state.

## References

- Frame brief: `context/changes/bugfix-batch/frame.md`
- Future slice that owns the toggle/light mode: S-10 `settings-profile` — `context/foundation/roadmap.md:58,226`
- Source: `src/styles/global.css:8,42,113-115,121-122`, `src/layouts/Layout.astro:14,17,20,53-60`, `src/components/inspections/QuestionCards.tsx:253-257`, `src/pages/inspections/[id]/session/part/[part].astro:94,102`
- Evidence: `Desktop/bug 1.PNG`, `Desktop/bug 2.mp4`; scratchpad frames `tr_2.25.png`, `tr_4.7.png`, `b2_7.png`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Dark canvas + theme infra hook

#### Automated

- [x] 1.1 `npx astro sync` succeeds
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Production build succeeds: `npm run build`
- [x] 1.4 Existing test suite passes: `npm test`

#### Manual

- [x] 1.5 Whole viewport is dark on dev server; no white around the page
- [x] 1.6 Auth/dashboard/session render coherently under dark shadcn tokens
- [x] 1.7 Source shows `<html class="dark">`, dark `theme-color`, `viewport-fit=cover`, no flash

### Phase 2: Bug 1 finish — iOS safe area

#### Automated

- [ ] 2.1 Linting passes: `npm run lint`
- [ ] 2.2 Production build succeeds: `npm run build`

#### Manual

- [ ] 2.3 Top and bottom iOS strips are dark on the real iPhone (no white bars)
- [ ] 2.4 Content not obscured by notch/home-indicator
- [ ] 2.5 No regression on rotation (if applicable)

### Phase 3: Bug 2 finish — transition overflow containment

#### Automated

- [ ] 3.1 Linting passes: `npm run lint`
- [ ] 3.2 Production build succeeds: `npm run build`
- [ ] 3.3 Existing `QuestionCards`/session tests pass: `npm test`

#### Manual

- [ ] 3.4 No white bar on right edge during forward slide on real iPhone
- [ ] 3.5 No horizontal scroll during/after transition
- [ ] 3.6 Back navigation (left slide) is clean
