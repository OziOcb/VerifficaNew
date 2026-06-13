# Public Home Page (S-01) Implementation Plan

## Overview

Replace the inherited 10x-Astro-Starter marketing page with a Veriffica-branded public
home page that describes the product — the personalization wedge, the 5-part inspection
(Info → Standstill → Engine → Drive → Documents), key benefits, and the "helper tool, not
a replacement" framing — with auth-aware log in / register actions. As a second, small
phase, formally land the **English-only UI convention (FR-024)** by fixing the two
existing non-English leaks in the shell (the Polish config-status banner and the starter
default page title).

This is the standalone public entry surface (PRD §Access Control → Unauthenticated
access). It has no data dependency and runs parallel to the foundation/north-star chain.

## Current State Analysis

- `src/pages/index.astro` renders `src/components/Welcome.astro`, which is **pure starter
  boilerplate**: a "10x Astro Starter" cosmic hero, generic Sign In / Sign Up buttons, and
  3 generic feature cards ("Authentication Ready", "Modern Stack", "Developer Experience").
- The **cosmic design system already exists** and is shared with the auth pages
  (`src/pages/auth/signin.astro`, `signup.astro`): `bg-cosmic`, blurred orbs, a star-field
  background, `backdrop-blur-xl` glass cards, and blue→purple→pink gradient text. Tailwind 4
  tokens live in `src/styles/global.css`.
- `src/components/Topbar.astro` is **already auth-aware** — it reads `const { user } =
Astro.locals;` and renders the user email + Dashboard/Sign-out when signed in, else Sign
  in / Sign up. It is the canonical pattern to mirror for the home page's CTA swap. (Note:
  `Welcome.astro` embeds `<Topbar />` at the top already.)
- `src/middleware.ts` populates `Astro.locals.user` on every request and gates only
  `PROTECTED_ROUTES = ["/dashboard"]`. The home page (`/`) is **already public** — no
  middleware change needed.
- **FR-024 leaks (non-English strings currently shippable in the UI):**
  - `src/layouts/Layout.astro` default `title = "10x Astro Starter"` (starter branding).
  - `src/lib/config-status.ts` → Supabase banner copy is **Polish**: `"Supabase nie jest
skonfigurowany — funkcje uwierzytelniania są wyłączone."` and `docsLabel: "Zobacz
instrukcję konfiguracji"`. The banner only renders when Supabase env is unset (via
    `missingConfigs` in `Layout.astro`), but it is user-visible UI and violates FR-024.
- "5 parts" per PRD §Vision and Success Criteria = **Info, Standstill, Engine, Drive,
  Documents**, ordered to match a physical inspection (standstill → start engine → test
  drive → documents).

## Desired End State

Visiting `/` (signed out) shows a Veriffica home page: a hero that states the product
promise, a section conveying the personalization wedge ("a checklist that already knows
your car"), a visually distinct 5-part overview, a short benefits/"why" section, the
helper-tool disclaimer, and prominent **Sign in / Register** actions. Visiting `/` while
signed in shows the same page but with a **Go to Dashboard** action in place of the auth
CTAs. No Polish or "10x Astro Starter" strings appear anywhere in the shipped UI.

Verify: `npm run build` succeeds; `/` renders the new content signed-out and signed-in;
`grep` finds no Polish/"10x Astro Starter" strings in `src/`.

### Key Discoveries:

- Reuse the cosmic shell verbatim from `src/components/Welcome.astro:5-29` (orbs + star
  field + `bg-cosmic` wrapper + `<Topbar />`) — only the inner hero/cards content changes.
- Mirror the auth-aware conditional from `src/components/Topbar.astro:8-36` for the CTA swap.
- Auth routes already exist: `/auth/signin`, `/auth/signup` — CTAs link straight to them.
- `Layout.astro` accepts a `title` prop (`src/layouts/Layout.astro:6-10`); `index.astro`
  currently passes none, so it inherits the starter default that must be re-branded.

## What We're NOT Doing

- No new auth, API, database, or middleware work — the home page is read-only and public.
- No redesign of the auth pages, dashboard, or the global design tokens — we reuse the
  existing cosmic theme and only add inspection-themed polish on the home page.
- No auto-redirect of signed-in users away from `/` (decided: page stays viewable, CTAs
  swap instead).
- No new i18n framework — FR-024 is "English only", so we hard-translate the two leaks; we
  do not introduce locale infrastructure.
- No marketing assets pipeline (no hero imagery/photography) — icon-and-copy only, per the
  no-photo-system non-goal.

## Implementation Approach

Phase 1 introduces a dedicated, intention-named `Home.astro` component (replacing the
generic `Welcome.astro`), reusing the existing cosmic shell so the page stays visually
consistent with the auth pages while gaining a richer, on-brand landing structure and
auth-aware CTAs. Phase 2 is an independent, tiny cleanup that makes FR-024 true by removing
the two known non-English strings. The phases are separable; Phase 2 has no dependency on
Phase 1 beyond living in the same slice.

## Phase 1: Veriffica home page

### Overview

Build the new public landing page content with auth-aware CTAs, reusing the cosmic theme
with inspection-themed polish, and retire the starter `Welcome.astro`.

### Changes Required:

#### 1. New home page component

**File**: `src/components/Home.astro`

**Intent**: The Veriffica landing surface. Reuse the cosmic shell (background wrapper,
orbs, star field, `<Topbar />`) from the current `Welcome.astro`, then replace the inner
content with: (a) a hero — product name + one-line promise; (b) a personalization-wedge
section conveying "a checklist personalized to _this_ car, not a wall of generic
questions"; (c) a 5-part overview presenting Info → Standstill → Engine → Drive →
Documents with inspection-themed icons (`lucide-react`-style inline SVGs as used in the
current cards); (d) a short benefits/"why" section; (e) the helper-tool disclaimer
("Veriffica is a helper tool and does not replace a professional inspection"); (f) the
auth-aware CTA block (see change #2). All copy in English (FR-024). Source the copy from
PRD §Vision & Problem Statement and §Business Logic.

**Contract**: New `.astro` component, no props (reads `Astro.locals.user` directly for the
CTA swap). Styling reuses existing Tailwind utility patterns from `Welcome.astro`
(`bg-cosmic`, `backdrop-blur-xl` cards, gradient headings); Prettier's Tailwind class order
is authoritative — do not hand-reorder.

#### 2. Auth-aware CTA block

**File**: `src/components/Home.astro` (within the hero)

**Intent**: When `Astro.locals.user` is set, render a single **Go to Dashboard** action
(`/dashboard`); otherwise render **Sign in** (`/auth/signin`) and **Register**
(`/auth/signup`) actions. Mirror the conditional structure already used in `Topbar.astro`.

**Contract**: `const { user } = Astro.locals;` then a ternary in the markup. The
`Astro.locals.user` type is already established by middleware; no new typing needed.

#### 3. Rewire the index page

**File**: `src/pages/index.astro`

**Intent**: Import and render `Home` instead of `Welcome`, and pass a branded title to the
layout so the document `<title>` is "Veriffica" (not the starter default).

**Contract**: `<Layout title="Veriffica">` (or "Veriffica — ..." tagline) wrapping
`<Home />`. Replaces the current `import Welcome` + `<Welcome />`.

#### 4. Remove the starter component

**File**: `src/components/Welcome.astro` (delete)

**Intent**: Delete the boilerplate component now that `Home.astro` replaces it.

**Contract**: File deletion. Confirm no other importer exists (`index.astro` is the only
referrer) before removing.

### Success Criteria:

#### Automated Verification:

- `astro sync` + type-check pass: `npm run lint`
- Production build succeeds: `npm run build`
- No starter/Polish strings remain: `grep -rn "10x Astro Starter\|Welcome.astro" src/` returns nothing
- `Welcome.astro` is deleted and has no remaining importers: `grep -rn "Welcome" src/`

#### Manual Verification:

- Signed-out `/` shows the Veriffica hero, personalization wedge, the 5 parts (Info,
  Standstill, Engine, Drive, Documents), benefits, the helper-tool disclaimer, and Sign in
  / Register actions that navigate to the auth pages.
- Signed-in `/` shows the same content but a **Go to Dashboard** action instead of the auth CTAs.
- Layout is responsive (mobile + desktop) and visually consistent with the auth pages.
- Browser tab title reads "Veriffica", not "10x Astro Starter".

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: English-only convention (FR-024)

### Overview

Remove the two known non-English strings from the app shell so FR-024 ("the entire
interface is presented in English only") holds across the public surface.

### Changes Required:

#### 1. Translate the config-status banner

**File**: `src/lib/config-status.ts`

**Intent**: Replace the Polish Supabase-not-configured `message` and `docsLabel` with
English equivalents (e.g. message: "Supabase is not configured — authentication features
are disabled."; docsLabel: "See the configuration guide.").

**Contract**: String literal edits to the `configStatuses` array entry; structure and
`docsUrl` unchanged.

#### 2. Brand the default layout title

**File**: `src/layouts/Layout.astro`

**Intent**: Change the default `title` from `"10x Astro Starter"` to a Veriffica default so
any page that doesn't pass a title still shows English/branded text.

**Contract**: Default value of the `title` prop in the component frontmatter.

### Success Criteria:

#### Automated Verification:

- No Polish strings remain: `grep -rniE "skonfigurowany|wyłączone|instrukcję|Uwaga|Zobacz" src/` returns nothing
- No starter title remains: `grep -rn "10x Astro Starter" src/` returns nothing
- Build + lint pass: `npm run build` and `npm run lint`

#### Manual Verification:

- With Supabase env unset locally, the config banner renders in English.
- All visible shell text (titles, banner) is English.

**Implementation Note**: After automated verification passes, pause for manual confirmation
from the human.

---

## Testing Strategy

### Unit Tests:

- None required — this slice is static presentation with no logic branches beyond a single
  auth-state ternary already covered by manual verification. (No existing test harness
  targets `.astro` presentation components.)

### Integration Tests:

- None added. The existing Playwright/RLS suites are unaffected; `npm run build` is the
  integration gate for SSR pages on the Cloudflare runtime.

### Manual Testing Steps:

1. `npm run dev`, open `/` signed out — confirm all six content blocks render and CTAs link
   to `/auth/signin` and `/auth/signup`.
2. Sign in, return to `/` — confirm the CTA block shows **Go to Dashboard** → `/dashboard`.
3. Resize to mobile width — confirm layout reflows cleanly (the 5-part grid stacks).
4. Temporarily unset `SUPABASE_URL`/`SUPABASE_KEY` in `.dev.vars` — confirm the banner
   renders in English; restore env.
5. Inspect the browser tab title — confirm "Veriffica".

## Performance Considerations

Static, server-rendered Astro page with no client islands (the CTA swap is server-side via
`Astro.locals.user`). No measurable performance concern.

## Migration Notes

None — no data or schema involved.

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-01 (lines 115–125)
- Change identity: `context/changes/public-home-page/change.md`
- PRD refs: FR-005 (public home page), FR-024 (English-only); §Vision, §Business Logic,
  §Access Control (Unauthenticated access) in `context/foundation/prd.md`
- Cosmic shell to reuse: `src/components/Welcome.astro:5-29`
- Auth-aware pattern to mirror: `src/components/Topbar.astro:8-36`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Veriffica home page

#### Automated

- [ ] 1.1 astro sync + type-check pass (`npm run lint`)
- [ ] 1.2 Production build succeeds (`npm run build`)
- [ ] 1.3 No starter/Polish strings remain in src (grep)
- [ ] 1.4 Welcome.astro deleted with no remaining importers (grep)

#### Manual

- [ ] 1.5 Signed-out `/` shows hero, wedge, 5 parts, benefits, disclaimer, Sign in/Register CTAs
- [ ] 1.6 Signed-in `/` shows Go to Dashboard instead of auth CTAs
- [ ] 1.7 Responsive + visually consistent with auth pages
- [ ] 1.8 Browser tab title reads "Veriffica"

### Phase 2: English-only convention (FR-024)

#### Automated

- [ ] 2.1 No Polish strings remain in src (grep)
- [ ] 2.2 No "10x Astro Starter" title remains in src (grep)
- [ ] 2.3 Build + lint pass

#### Manual

- [ ] 2.4 Config banner renders in English with Supabase env unset
- [ ] 2.5 All visible shell text is English
