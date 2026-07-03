# Design Refresh — Plan Brief

> Full plan: `context/changes/design-refresh/plan.md`
> Frame brief: `context/changes/design-refresh/frame.md`

## What & Why

The app has **no visual identity** — it's an unmodified tweakcn "Caffeine" preset (achromatic palette,
system font, default shadcn shape/shadow, no brand mark) applied uniformly across stock primitives, so it
reads as a generic template. The fix lives in the **design tokens + typography + a light brand layer**, not
per-screen restyling. The user also folded in three layout additions: a shared app header across
authenticated pages, and a fixed bottom action bar on the question flow.

## Starting Point

Screens already consume design tokens (`PANEL`/`PRIMARY_BTN` are token strings), so `global.css` is a single
lever that propagates color/type/shape everywhere. The `Veriffica`+`AccountMenu` header exists **only** on
the dashboard; the account dropdown is already feature-complete. QuestionCards' answer buttons currently live
inside the sliding card, with Add note/Next in a separate row below — neither pinned to the screen.

## Desired End State

A signature blue (`#0B65B3`) drives primary actions and focus rings in both modes; an intentional self-hosted
typeface replaces the system stack; a rebuilt 6-step shadow ladder and refined radius read as curated depth;
the real Veriffica logotype appears in a shared header on every authenticated page (logo → homepage) and in
the browser tab. The question flow has a fixed bottom bar — Add note + Next above the Yes/No/Don't-know row —
always reachable. Dark mode is fully retuned; no flows, data, or offline behavior regress.

## Key Decisions Made

| Decision             | Choice                                                 | Why (1 sentence)                                         | Source |
| -------------------- | ------------------------------------------------------ | -------------------------------------------------------- | ------ |
| Root cause           | No visual identity; token-rooted, systemic             | Four STRONG hypotheses; blind cross-check reproduced it  | Frame  |
| Signature color      | `#0B65B3` (verification blue)                          | User provided it                                         | Plan   |
| Typography           | One characterful sans, self-hosted (Plus Jakarta def.) | Biggest identity-per-effort; offline-safe via Fontsource | Plan   |
| Shape & depth        | Refined & curated (radius bump + 6-step tinted ladder) | Reads intentional; fixes the broken shadow tiers         | Plan   |
| Brand mark           | User-provided long + short Veriffica SVGs              | Real logotype ready; derive favicon from short mark      | Plan   |
| Hand-rolled controls | Restyle in place (not routed through new primitives)   | Keeps scope visual; avoids behavior-regression risk      | Plan   |
| Shared header scope  | Authenticated app pages only (not homepage/auth)       | Account dropdown needs a signed-in user                  | Plan   |
| Question action bar  | Fixed to viewport bottom; answers relocate out of card | User's explicit layout ask; thumb-reachable actions      | Plan   |

## Scope

**In scope:** brand-blue token retune (light+dark), refined radius + rebuilt shadow ladder, self-hosted
typeface + tuned scale + woff2 precache, provided logotypes → shared `AppHeader.astro` across authenticated
pages + favicon/theme-color, QuestionCards fixed bottom action bar, in-place restyle of hand-rolled controls.

**Out of scope:** homepage & pre-auth pages, header on auth pages, new primitives (Switch/Tabs/Textarea),
any flow/routing/data/RLS/sync change, new illustration/motif, question answer-gate/auto-advance logic.

## Architecture / Approach

Foundation-outward. Phases 1–2 are pure `global.css`/config edits (color, shape, font) that propagate to
every token-consuming screen at once. Phase 3 adds the brand assets and a shared `AppHeader.astro` (logo
`<a href="/">` + the existing `client:only` `AccountMenu`) wired into dashboard/settings/inspection pages,
plus a favicon set + theme-color. Phase 4 relocates the question answers into a `fixed inset-x-0 bottom-0`
bar (inner `max-w-3xl`, safe-area padding). Phase 5 restyles the raw-Tailwind holdouts to match.

## Phases at a Glance

| Phase                              | What it delivers                                     | Key risk                                                |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| 1. Palette & shape tokens          | Blue identity + refined radius/shadow, both modes    | Dark-mode retune parity; AA contrast on new blue        |
| 2. Typography                      | Self-hosted characterful sans, offline-safe          | woff2 must be added to PWA precache; FOUT               |
| 3. Brand assets + shared header    | Logotype, favicon, header on all authed pages        | `AccountMenu` must stay `client:only`; logo→home wiring |
| 4. QuestionCards fixed bottom bar  | Actions pinned to screen bottom, note/next above     | Fixed-width alignment + iOS safe-area + content overlap |
| 5. Hand-rolled controls + holdouts | Toggles/answers restyled to match; Banner (optional) | Purely visual — must not change behavior                |

**Prerequisites:** user provides the long + short Veriffica SVGs before Phase 3; local Supabase + `wrangler dev`
available for the offline font check.
**Estimated effort:** ~3–4 sessions across 5 phases (Phase 1 and Phase 4 carry the most tuning).

## Open Risks & Assumptions

- **Assumption:** "all pages except homepage" = authenticated app pages (dashboard, settings, inspection
  screens) + future post-login pages; pre-auth pages get no header (confirmed with user).
- `#0B65B3` must be converted precisely to OKLCH and verified for AA contrast on both `--primary-foreground`
  and as a focus ring in both modes.
- Font family default (Plus Jakarta Sans) is a one-line Fontsource swap if the look isn't right.
- Fixed bottom bar interacts with the iOS safe-area and the card slide animation — the highest-touch UI change.

## Success Criteria (Summary)

- Every authenticated screen shows the blue identity, new font, shared header, and real favicon — in light
  and dark — with homepage/auth pages unchanged.
- The question flow's action bar stays pinned to the bottom, clears the iOS home indicator, and preserves
  auto-advance/Back/Next behavior.
- `npm run build`, lint, and the offline smoke all pass; no flow or data regression.
