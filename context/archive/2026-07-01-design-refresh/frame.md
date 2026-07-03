# Frame Brief: Design Refresh — "make the app look better"

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

"I want to improve the overall design and make the app look better." No specific
defect named — an open-ended quality judgment about the app's visual design.

## Initial Framing (preserved)

- **User's stated cause or approach**: None given. This is observation-driven —
  the user did not diagnose _why_ it looks off, only that it does.
- **User's proposed direction**: Improve the overall design, broadly.
- **Pre-dispatch narrowing** (Step 1.5 answers):
  - **Surface**: "The whole thing, evenly" — no single screen is the offender.
  - **Gap**: "Generic / templated" — it works and is consistent, but looks like
    every other shadcn starter; no personality or brand identity.
  - **Scope**: "Purely visual" — aesthetics only; flows and behavior stay as-is.

## Dimension Map

Where could a "looks generic" perception originate? (Pinned to this codebase.)

1. **Color / palette tokens** — `global.css` is a near-achromatic theme; the
   "primary" carries almost no hue, so the product has no signature color. ← **root**
2. **Typography** — default system font stack, stock Tailwind size ramp, no
   display face or type personality.
3. **Shape & depth** — radius and shadow tokens are unmodified shadcn/tweakcn
   defaults; flat, un-curated depth language.
4. **Brand layer / identity elements** — no logotype, motif, illustration,
   imagery, or signature interaction anywhere.
5. **Per-screen composition** — could the genericness be localized to one weak
   screen rather than the system? (Tested to rule in/out "systemic".)
6. **Component consistency** — screens hand-roll raw-Tailwind controls instead of
   shared primitives (secondary; see Constraints, not the root).

## Hypothesis Investigation

| Hypothesis                                 | Evidence                                                                                                                                                                                                                                                               | Verdict                                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **1. Achromatic palette (no brand color)** | `--primary: oklch(0.4341 0.0392 41.9938)` — chroma **0.039**, effectively grey; `background/foreground/card/muted/accent/border` all chroma **0.000**; only saturated token is `--destructive` (0.19) → color signals _errors_, never identity (`global.css:16,10-27`) | **STRONG**                                                                                                                   |
| **2. Default system typography**           | `--font-sans: ui-sans-serif, system-ui, …`; no web font loaded; `--tracking-normal: 0em`; headings are plain `font-bold` on the stock size ramp (`global.css:42-47`; `Home.astro:18`; `DashboardBoard.tsx:128`)                                                        | **STRONG**                                                                                                                   |
| **3. Untouched shadcn shape/shadow**       | `--radius: 0.5rem` (shadcn default); shadow tiers share one `0 1px 3px` base, `--shadow-2xl` weaker than `--shadow-lg`; `Button`/`Card` are verbatim primitives (`global.css:9,48-55`; `card.tsx:9`; `button.tsx:7-33`)                                                | **STRONG**                                                                                                                   |
| **4. No brand/identity elements**          | Brand is plain-text "Veriffica" (`dashboard.astro:38`); generic `/favicon.png`; stock lucide icons only; no logo, illustration, motif, texture, or gradient on any screen (`Home.astro:81-303`; `components.json:20`)                                                  | **STRONG**                                                                                                                   |
| **5. Genericness localized to one screen** | Every working screen shares the same `max-w-*/space-y-8/bg-card grid` shell, same 3–4 tokens, copy-pasted `PANEL`/`PRIMARY_BTN` constants (`DashboardBoard.tsx:46-49`; `SessionScreen.tsx:33`; `Part1Form.tsx:30`) → feel is uniform                                   | **NONE** (ruled out — it's systemic)                                                                                         |
| **6. Hand-rolled components**              | Duplicated toggle switches, no shared `Switch`/`Tabs`/`Textarea`; raw `<button>`/`<textarea>` bypass primitives (`SettingsControls.tsx:86-141`; `EquipmentToggles.tsx:37-59`; `QuestionCards.tsx:313-327`)                                                             | **WEAK** as _cause_ — real, but a maintainability/consistency issue and a constraint on the fix, not the source of "generic" |

## Narrowing Signals

- User picked **"whole thing, evenly"** → predicts a systemic cause (tokens/type),
  not a bad screen. Investigation confirmed: identical vocabulary everywhere.
- User picked **"generic / templated," not "rough" or "off"** → rules out a
  polish/bug problem; points at _identity_, not _execution quality_.
- User picked **"purely visual"** → keeps this in token/type/brand territory and
  out of layout/flow redesign.
- Two independent agents (one told the hypothesis, one not) both landed on the
  achromatic palette as the #1 driver → the reframe survived a blind cross-check.
- The code self-labels the theme "Caffeine (tweakcn)" (`global.css:6`) and repeats
  the "Caffeine token palette" note across screens — it is an unmodified preset,
  by the codebase's own admission.

## Cross-System Convention

The standard way to make a shadcn app stop looking templated is to add a **brand
layer on top of the primitives**: a signature color (real chroma) wired through the
existing token variables, one intentional typeface, curated radius/shadow, and a
minimal identity mark. The token architecture here (CSS variables in `:root`/`.dark`
consumed via `@theme inline`) is _built_ for exactly this — recoloring is a
token-level change, not a per-component rewrite. The leading hypothesis matches the
convention precisely.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the app has **no visual identity** — it
> is an unmodified tweakcn "Caffeine" preset (achromatic palette, system font,
> default shadcn shape/shadow, no brand mark) applied uniformly across stock
> primitives, so it reads as a generic template. The fix lives in the **design
> tokens + typography + a light brand layer**, not in per-screen restyling.

This is a sharpening, not a contradiction — the user gave no cause to overturn. It
matters because "improve the design" could have been mis-scoped as a screen-by-screen
tweak marathon; the evidence shows the genericness is _systemic and token-rooted_, so
a small set of foundational changes (palette chroma, a typeface, shape/shadow, a
wordmark/favicon) will propagate to every screen at once — the highest-leverage cut.

## Confidence

**HIGH** — four STRONG hypotheses with concrete `file:line` evidence, a decisive set
of narrowing answers, an independent blind cross-check that reproduced the top driver,
and a fix path that matches the token architecture already in place.

## What Changes for /10x-plan

Plan a **foundational visual-identity pass**, not a per-screen redesign: (1) inject a
real signature color at the token level and re-tune the palette off pure grey; (2)
adopt an intentional typeface + type scale; (3) curate radius/shadow away from stock
defaults; (4) add a minimal brand layer (wordmark treatment, favicon/theme-color).
**Constraint to carry in:** because identity will live in tokens _and_ primitives,
the hand-rolled controls (hypothesis 6) won't inherit primitive-level restyling —
the plan must decide whether to route them through shared primitives or restyle them
in place. Keep scope **purely visual** — no flow/layout changes unless a token change
forces one. Dark mode must stay first-class (the theme ships light + dark).

## References

- Source files: `src/styles/global.css:6-91`, `src/components/Home.astro`,
  `src/components/dashboard/DashboardBoard.tsx`, `src/components/inspections/{SessionScreen,QuestionCards,Part1Form}.tsx`,
  `src/components/settings/SettingsControls.tsx`, `src/components/ui/{button,card}.tsx`,
  `components.json`
- Related research: none (no `research.md` for this change)
- Investigation: 2 parallel Explore agents (working-screen survey + independent
  generic-driver audit) — both returned SYSTEMIC / achromatic-palette-led
