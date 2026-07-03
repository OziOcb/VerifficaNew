# Design Refresh — Visual Identity Pass Implementation Plan

## Overview

Veriffica reads as a generic template because it ships an unmodified tweakcn "Caffeine"
preset: an achromatic palette (primary chroma 0.039, everything else 0.000), the system
font stack, stock shadcn radius/shadow, and no brand mark — applied uniformly across
token-consuming screens. This plan gives the app a **visual identity at the foundation
level** (design tokens + typography + a brand layer), plus three user-requested layout
additions (a shared app header, and a fixed bottom action bar on the question flow).

Because the screens already consume design tokens (`PANEL = "border bg-card
text-card-foreground"`, `PRIMARY_BTN = "bg-primary text-primary-foreground …"`), the
token/type changes in Phases 1–2 propagate to every screen at once — the highest-leverage
cut. Dark mode stays first-class throughout.

## Current State Analysis

- **Token architecture is built for this** (`src/styles/global.css:8-146`): CSS variables in
  `:root`/`.dark` consumed via `@theme inline`. Recoloring is a token-level change, not a
  per-component rewrite.
- **Achromatic palette** (`global.css:16,10-27`): `--primary: oklch(0.4341 0.0392 41.9938)`
  is effectively grey; `background/foreground/card/muted/accent/border` all chroma **0.000**.
  The only saturated token is `--destructive` — color signals _errors_, never identity.
- **Broken shadow ladder** (`global.css:48-55`): tiers share one `0 1px 3px` base; `--shadow-2xl`
  is _weaker_ than `--shadow-lg`. Not a monotonic depth progression.
- **No web font** (`global.css:42-44`): default `ui-sans-serif, system-ui, …` stack, `--tracking-normal: 0em`.
- **No brand mark**: brand is plain-text "Veriffica" in one place (`dashboard.astro:38`); stock
  `/favicon.png`; `theme-color` metas hardcoded to `#f7f7f7`/`#111111` (`Layout.astro:30-31`).
- **The "topbar" the user means** is the `dashboard.astro:37-40` header — a `Veriffica` wordmark
  - `AccountMenu` island — and it renders **only on the dashboard**. Settings and the inspection
    detail/session/part pages have no such header. `AccountMenu` (`AccountMenu.tsx`) already
    contains Settings, a light/dark toggle, and Sign out — no dropdown redesign needed.
- **QuestionCards action layout** (`QuestionCards.tsx:309-363`): the Yes/No/Don't-know grid lives
  _inside_ the keyed, sliding card (`:266-329`); Add note + Next sit in a separate `flex
justify-between` row _below_ it (`:342-363`). Neither is pinned to the viewport.
- **Screens are already token-clean**: only `Banner.astro:28-40` hardcodes hex colors (status
  banners). No other raw `bg-white`/`gray-`/`slate-`/hex usage in components or pages.
- **Hand-rolled controls** bypass shared primitives: `SettingsControls.tsx`, `EquipmentToggles.tsx`,
  and the `QuestionCards` answer buttons are raw Tailwind — they consume color tokens but their
  shape/depth won't auto-inherit primitive-level polish.
- **PWA precache gap** (`astro.config.mjs`): `globPatterns` covers `js/css/svg/png/ico/webmanifest`
  but **not `woff2`** — a self-hosted font won't be cached offline unless added.

## Desired End State

The app has a coherent visual identity: a signature blue (`#0B65B3`) drives primary actions and
focus rings in both modes; an intentional typeface with a tuned scale replaces the system stack;
radius and a rebuilt 6-step shadow ladder read as curated depth; the real Veriffica logotype appears
in a shared header across every authenticated page (clickable → homepage) and in the browser tab.
The question flow has a fixed bottom action bar (Add note + Next above the Yes/No/Don't-know row),
always reachable at the screen bottom. Nothing about flows, data, or offline behavior regresses;
dark mode is fully retuned in parallel.

Verify: load each authenticated page in light and dark — every screen shows the blue identity, the
new font, the shared header, and a real favicon in the tab; the homepage and pre-auth pages are
unchanged; the question flow's action bar is pinned to the bottom and clears the iOS home indicator;
`npm run build` + offline smoke still pass.

### Key Discoveries:

- Token propagation is automatic — `global.css` is the single lever for color/type/shape
  (`global.css:93-146`, `@theme inline`).
- The account dropdown already exists and is feature-complete (`AccountMenu.tsx:54-100`); Phase 3
  reuses it verbatim inside a new shared header.
- `AccountMenu` **must** stay `client:only="react"` — it imports Dexie (`@/lib/db`), which has no
  global on workerd/SSR (`AccountMenu.tsx:4-7`).
- The fixed bottom bar must constrain its own width — `position: fixed` is viewport-relative, but the
  page content lives in `max-w-3xl mx-auto` containers (`part/[part].astro:103`), so the bar needs
  `inset-x-0` + an inner centered `max-w-3xl` to align.
- SW is build-only — offline font/precache behavior can only be exercised with `npm run build && npx
wrangler dev`, never `astro dev` (lessons.md, "Service worker is build-only").

## What We're NOT Doing

- No changes to the **homepage** (`Home.astro`/`index.astro`) or its existing `Topbar.astro`.
- No header/account menu on **pre-auth pages** (signin/signup/confirm-email) — the account dropdown
  needs a signed-in user. (Assumption confirmed with the user; see Open Risks.)
- **Not** routing hand-rolled controls through new shadcn primitives (Switch/Tabs/Textarea) — that
  changes markup/behavior and risks regressions; we restyle them in place (Phase 5).
- No flow, routing, data-model, RLS, or sync changes.
- No new illustration/imagery/motif beyond the provided logotypes and a derived favicon set.
- No change to the answer-gate logic, auto-advance, Back/Next behavior, or note persistence — Phase 4
  is layout-only.

## Implementation Approach

Work foundation-outward so each phase builds on a stable base: recolor + reshape tokens first (Phase 1),
add typography (Phase 2), then the brand assets + shared header that depend on the finished look
(Phase 3). The two layout additions come next — the fixed action bar (Phase 4) — and finally the
manual restyle cleanup (Phase 5) is tuned against the completed system. Phases 1–2 are pure `global.css`
/config edits that propagate everywhere; Phases 3–5 touch specific components.

The signature color `#0B65B3` (rgb 11 101 179) is provided as the source of truth; convert precisely to
the OKLCH form the tokens use (≈ `oklch(0.51 0.13 251)` as a starting reference — compute exact and
verify against the hex). It becomes `--primary`/`--ring` and seeds a harmonized secondary/accent/chart
family; the near-neutral tokens gain a faint cool tint so the palette stops being pure grey without
losing legibility.

## Critical Implementation Details

- **Dark-mode parity (Phase 1/3).** Every token retuned in `:root` must be retuned in `.dark` in the same
  pass, and the two `theme-color` metas (`Layout.astro:30-31`) must be updated to whatever the final
  `--background` resolves to per mode (they are currently hardcoded `#f7f7f7`/`#111111`).
- **Fixed bar width constraint (Phase 4).** Use `fixed inset-x-0 bottom-0` with an inner
  `mx-auto max-w-3xl` wrapper so the bar aligns with the page's `max-w-3xl` content column instead of
  spanning the full viewport. Pad the bar with `env(safe-area-inset-bottom)` (the `safe-area` utility
  exists in `global.css:153`) so it clears the iOS home indicator, and add matching bottom padding to the
  scrollable card area so the last content isn't hidden behind the bar.
- **Font is offline-critical (Phase 2).** Self-host via Fontsource (no CDN — CDN breaks offline). Add
  `woff2` to `astro.config.mjs` `globPatterns` or the font won't precache; verify with `wrangler dev`,
  not `astro dev` (the SW is build-only).

## Phase 1: Palette & Shape Tokens

### Overview

Replace the achromatic Caffeine palette with the `#0B65B3` brand identity and fix the depth language —
the single highest-leverage change, propagating to every token-consuming screen in both modes.

### Changes Required:

#### 1. Brand color + palette retune

**File**: `src/styles/global.css` (`:root` `8-56`, `.dark` `58-91`)

**Intent**: Make blue the product's signature. Set `--primary` and `--ring` to the OKLCH form of
`#0B65B3`; keep `--primary-foreground` white for contrast. Retune the near-neutral tokens
(`background/foreground/card/muted/accent/border/input`) off pure grey with a faint cool tint that
harmonizes with the blue, and reseed `--secondary`/`--accent`/`--chart-*` into the blue family. Do the
same retune in `.dark`. Leave `--destructive` as the error signal.

**Contract**: Token _names_ are unchanged (consumed via `@theme inline`); only values change. `--primary`
light and dark must both carry real chroma (> 0.05). Maintain WCAG AA contrast for
foreground-on-primary and text-on-background in both modes.

#### 2. Refined radius

**File**: `src/styles/global.css:9`

**Intent**: Nudge `--radius` from the stock `0.5rem` into the refined range (~`0.625rem`) so curvature
reads intentional. The derived `--radius-sm/md/lg/xl` (`:94-97`) track it automatically.

**Contract**: Single value change to `--radius`.

#### 3. Rebuild the shadow ladder

**File**: `src/styles/global.css:48-55`

**Intent**: Replace the flat, non-monotonic shadow tiers with a real 6-step progression
(`2xs → 2xl` strictly increasing in spread/depth) carrying a subtle brand-tinted shadow color at low
alpha, tuned separately for light and dark so dark mode doesn't muddy.

**Contract**: `--shadow-2xl` must be the strongest tier; each tier ≥ the previous. Token names unchanged.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` succeeds
- `npm run lint` passes
- `npm run build` passes
- No palette token used for `--primary`/`--ring` has chroma `0.000` (grep `global.css`)

#### Manual Verification:

- Light and dark both show the blue identity on primary CTAs, links, and focus rings
- Text/background and foreground/primary contrast pass AA in both modes
- The shadow ladder reads as increasing depth; `2xl` is visibly the strongest
- No screen regressed to an unreadable or clashing color combination

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual
checks before starting Phase 2.

---

## Phase 2: Typography

### Overview

Replace the system font stack with one self-hosted characterful sans and a tuned scale, keeping the app
offline-safe.

### Changes Required:

#### 1. Add the self-hosted font

**File**: `package.json`, `src/styles/global.css:42-44`

**Intent**: Add a Fontsource package (default: `@fontsource-variable/plus-jakarta-sans` — trivially
swappable for Figtree/Geist), import it in `global.css`, and set `--font-sans` to the new family with the
existing system fallbacks preserved.

**Contract**: `--font-sans` leads with the new family; fallback chain retained. Font is bundled/self-hosted,
no external CDN request.

#### 2. Tune the type scale

**File**: `src/styles/global.css:47,141-145`

**Intent**: Set a slightly tighter `--tracking-normal` for display sizing and confirm heading weights read
well with the new face (adjust the tracking ramp only if needed).

**Contract**: `--tracking-normal` and derived tracking tokens; no component class changes required.

#### 3. Precache the font for offline

**File**: `astro.config.mjs` (`workbox.globPatterns`)

**Intent**: Add `woff2` to the precache glob so the SW caches the font for offline use.

**Contract**: `globPatterns` includes `woff2`; the built precache manifest lists the font asset.

### Success Criteria:

#### Automated Verification:

- `npm run build` emits the font `.woff2` into `dist/` and the workbox precache manifest references it
- `npm run lint` passes
- `npx astro sync` succeeds

#### Manual Verification:

- The new typeface renders across screens with no layout breakage
- No jarring FOUT/reflow on first load
- Font still renders offline via `npm run build && npx wrangler dev` with the network cut (SW is
  build-only — do not test with `astro dev`)

**Implementation Note**: Pause for human confirmation of manual checks before Phase 3.

---

## Phase 3: Brand Assets + Shared App Header

### Overview

Consume the provided Veriffica logotypes, expose them in a shared header across all authenticated pages
(logo → homepage), and replace the stock favicon/theme-color with brand assets.

### Changes Required:

#### 1. Add brand logotype assets

**File**: `src/assets/brand/` (new) — long + short Veriffica SVGs (user-provided)

**Intent**: Store the provided long (wordmark) and short (mark) SVGs so components can import them; ensure
both work on light and dark backgrounds (use `currentColor` or provide per-mode variants if the supplied
SVGs are single-color).

**Contract**: Two SVG assets committed; importable by `AppHeader.astro` and usable to derive the favicon set.

#### 2. Shared app header component

**File**: `src/components/AppHeader.astro` (new)

**Intent**: A header holding the logo wrapped in `<a href="/">` (long wordmark, optionally the short mark
on narrow screens) on the left and the existing `AccountMenu` island on the right. Mirrors the current
dashboard header layout (`flex items-center justify-between`) and takes the user email as a prop.

**Contract**: Props `{ userEmail?: string }`. Renders `<AccountMenu client:only="react" userEmail={...} />`
(the island must keep `client:only` — Dexie has no SSR global). Logo anchor targets `/`.

#### 3. Render the header on authenticated pages

**File**: `src/pages/dashboard.astro:37-40`, `src/pages/settings.astro`,
`src/pages/inspections/[id]/session.astro`,
`src/pages/inspections/[id]/session/part/[part].astro`

(Note: `src/pages/inspections/[id].astro` is a pure `Astro.redirect` to the session hub — it renders no
UI, so it gets no header.)

**Intent**: Replace dashboard's inline `Veriffica`+`AccountMenu` header with `<AppHeader>`, and add
`<AppHeader>` to the top of the settings page, the inspection session hub, and the part page, passing
`Astro.locals.user?.email`. Keep each page's existing `max-w-*` content container.

**Contract**: Every authenticated page renders exactly one `AppHeader`; homepage and pre-auth pages render
none.

#### 4. Favicon set + theme-color

**File**: `public/` (favicon/apple-touch/maskable), `src/layouts/Layout.astro:27,30-31`

**Intent**: Derive a favicon set (favicon, `apple-touch-icon`, maskable icon) from the short mark and wire
the `<link>`s; update the two `theme-color` metas to the final `--background` values from Phase 1.

**Contract**: `Layout.astro` references the new icon files; `theme-color` light/dark match the retuned
backgrounds. (Icon PNGs generated from the short SVG via a one-off tool step — e.g. `sharp`/ImageMagick
or an online generator.)

### Success Criteria:

#### Automated Verification:

- `npm run build` passes and the favicon/icon files exist in the build output
- `npm run lint` passes
- Each authenticated page imports/renders `AppHeader` (grep); homepage/auth pages do not

#### Manual Verification:

- The shared header shows on dashboard, settings, and all inspection screens; not on homepage/auth pages
- Clicking the logo navigates to the homepage from every page
- The account dropdown (Settings / theme toggle / Sign out) works from the shared header
- The Veriffica favicon shows in the browser tab; the logo is legible in light and dark
- The mobile theme-color (address bar / status bar) matches the app background in both modes

**Implementation Note**: Pause for human confirmation of manual checks before Phase 4.

---

## Phase 4: QuestionCards Fixed Bottom Action Bar

### Overview

Pin the question actions to the bottom of the screen: relocate the Yes/No/Don't-know buttons out of the
sliding card into a fixed bar, with Add note + Next stacked above them.

### Changes Required:

#### 1. Relocate answers into a fixed bottom bar

**File**: `src/components/inspections/QuestionCards.tsx:266-363`

**Intent**: Move the `ANSWER_OPTIONS` grid (`:309-328`) out of the keyed/animated card into a new
viewport-fixed bar at the bottom of the screen. Stack the existing Add note + Next row (`:342-363`) _above_
the answer grid inside that bar. The card and its slide animation keep the question content only.

**Contract**: Bar is `fixed inset-x-0 bottom-0` with an inner `mx-auto max-w-3xl` wrapper (aligns to the
page column), a top border + shadow, `bg-background`/`bg-card`, and `env(safe-area-inset-bottom)` padding.
Row order top→bottom: (Add note · Next), then (Yes · No · Don't know). Answer-gate, auto-advance on answer,
and Back/Next behavior are unchanged.

#### 2. Prevent content overlap

**File**: `src/components/inspections/QuestionCards.tsx:249` (deck root) and/or the part page `main`

**Intent**: Add bottom padding to the scrollable card region equal to the fixed bar's height so the last
content and the save-error message are never hidden behind the bar.

**Contract**: Scroll area reserves space for the bar; `saveError` (`:331-336`) remains visible above it.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes
- `npx astro sync` succeeds

#### Manual Verification:

- The action bar is pinned to the bottom of the screen on both tall and short content
- Add note + Next sit above the Yes/No/Don't-know row
- On iOS the bar clears the home indicator (safe-area) and never overlaps card content
- Tapping an answer still auto-advances; Back and the Next gate still behave as before
- The note editor and save-error message remain reachable/visible

**Implementation Note**: Pause for human confirmation of manual checks before Phase 5.

---

## Phase 5: Hand-Rolled Controls + Holdouts

### Overview

Restyle the raw-Tailwind controls that don't inherit primitive polish, so they read as intentional against
the refreshed shape/shadow — purely visual, no behavior change.

### Changes Required:

#### 1. Restyle hand-rolled controls in place

**File**: `src/components/settings/SettingsControls.tsx:86-141`,
`src/components/inspections/EquipmentToggles.tsx:37-59`,
`src/components/inspections/QuestionCards.tsx` (answer buttons `:313-327`)

**Intent**: Update the toggle/switch and answer-button classes to consume the new radius/shadow/color
tokens and feel deliberate (consistent hit areas, selected states using the brand blue). No markup or
behavior changes.

**Contract**: Class-only edits; controls keep their current structure, roles, and handlers.

#### 2. (Optional) Migrate Banner status colors to tokens

**File**: `src/components/Banner.astro:28-40`

**Intent**: Replace the hardcoded hex status colors with semantic tokens (or a small tinted-token scheme)
so banners theme with the rest of the app in dark mode.

**Contract**: Banner variants render from tokens; light/dark both legible. Optional — skip if it risks the
config-status banners' clarity.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Settings toggles, equipment toggles, and answer buttons look consistent with the refreshed system
- Selected/active states use the brand blue and read clearly in light and dark
- Banners (if migrated) remain legible in both modes

**Implementation Note**: Final phase — confirm the whole refresh reads coherently across every screen in
both modes.

---

## Testing Strategy

### Unit Tests:

- No new unit logic is introduced (visual/layout only). Existing suites must stay green.

### Integration Tests:

- Existing `npm test` (RLS) and any Playwright/e2e suites must pass unchanged — this change is visual/layout
  and must not alter data or flows.
- Offline smoke (`npm run smoke:deployed` / e2e offline round-trip) must still pass after the font precache
  change.

### Manual Testing Steps:

1. Walk every authenticated page in light and dark; confirm blue identity, new font, shared header, favicon.
2. Confirm homepage and pre-auth pages are visually unchanged (no shared header).
3. Click the logo from each authenticated page → lands on the homepage.
4. On a phone (or emulated iOS), run the question flow: the action bar is pinned to the bottom, clears the
   home indicator, Add note/Next sit above the answers, and answering auto-advances.
5. Build + `wrangler dev`, cut the network, reload — font and shell still render offline.

## Performance Considerations

- Self-hosted font adds one `woff2` to the precache; use a variable font to keep it to a single file. Watch
  for FOUT — acceptable, but confirm no large reflow.
- Fixed bottom bar is CSS-only; no runtime cost.

## Migration Notes

- No data migration. All changes are presentational/layout. Rollback = revert the branch; no schema or
  storage state is touched.
- The `theme-color` meta and favicon change are cosmetic and safe to revert independently.

## References

- Frame brief: `context/changes/design-refresh/frame.md`
- Token architecture: `src/styles/global.css:8-146`
- Existing account menu (reused): `src/components/dashboard/AccountMenu.tsx:54-100`
- Question flow layout: `src/components/inspections/QuestionCards.tsx:266-363`
- Lessons (SW build-only; offline testing): `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Palette & Shape Tokens

#### Automated

- [x] 1.1 `npx astro sync` succeeds — 6f0d2b2
- [x] 1.2 `npm run lint` passes — 6f0d2b2
- [x] 1.3 `npm run build` passes — 6f0d2b2
- [x] 1.4 No `--primary`/`--ring` palette token has chroma `0.000` (grep `global.css`) — 6f0d2b2

#### Manual

- [x] 1.5 Light and dark show the blue identity on CTAs, links, focus rings — 6f0d2b2
- [x] 1.6 Text/background and foreground/primary contrast pass AA in both modes — 6f0d2b2
- [x] 1.7 Shadow ladder reads as increasing depth; `2xl` is strongest — 6f0d2b2
- [x] 1.8 No screen regressed to an unreadable/clashing color combination — 6f0d2b2

### Phase 2: Typography

#### Automated

- [x] 2.1 `npm run build` emits the font `.woff2` and the precache manifest references it — 15a0827
- [x] 2.2 `npm run lint` passes — 15a0827
- [x] 2.3 `npx astro sync` succeeds — 15a0827

#### Manual

- [x] 2.4 New typeface renders across screens with no layout breakage — 15a0827
- [x] 2.5 No jarring FOUT/reflow on first load — 15a0827
- [x] 2.6 Font renders offline via `npm run build && npx wrangler dev` with network cut — 15a0827

### Phase 3: Brand Assets + Shared App Header

#### Automated

- [x] 3.1 `npm run build` passes and favicon/icon files exist in the build output — 07f3567
- [x] 3.2 `npm run lint` passes — 07f3567
- [x] 3.3 Each authenticated page renders `AppHeader` (grep); homepage/auth pages do not — 07f3567

#### Manual

- [x] 3.4 Shared header shows on dashboard, settings, all inspection screens; not homepage/auth — 07f3567
- [x] 3.5 Clicking the logo navigates to the homepage from every page — 07f3567
- [x] 3.6 Account dropdown (Settings / theme toggle / Sign out) works from the shared header — 07f3567
- [x] 3.7 Veriffica favicon shows in the tab; logo legible in light and dark — 07f3567
- [x] 3.8 Mobile theme-color matches the app background in both modes — 07f3567

### Phase 4: QuestionCards Fixed Bottom Action Bar

#### Automated

- [x] 4.1 `npm run lint` passes — fec8996
- [x] 4.2 `npm run build` passes — fec8996
- [x] 4.3 `npx astro sync` succeeds — fec8996

#### Manual

- [x] 4.4 Action bar is pinned to the bottom on tall and short content — fec8996
- [x] 4.5 Add note + Next sit above the Yes/No/Don't-know row — fec8996
- [ ] 4.6 On iOS the bar clears the home indicator and never overlaps content
- [x] 4.7 Answering auto-advances; Back and the Next gate still behave as before — fec8996
- [x] 4.8 Note editor and save-error message remain reachable/visible — fec8996

### Phase 5: Hand-Rolled Controls + Holdouts

#### Automated

- [x] 5.1 `npm run lint` passes — 9a8a4a6
- [x] 5.2 `npm run build` passes — 9a8a4a6

#### Manual

- [x] 5.3 Settings toggles, equipment toggles, answer buttons look consistent with the refresh — 9a8a4a6
- [x] 5.4 Selected/active states use the brand blue and read clearly in light and dark — 9a8a4a6
- [x] 5.5 Banners (if migrated) remain legible in both modes — banner migration skipped (no-op) — 9a8a4a6
