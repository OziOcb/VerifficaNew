# Frame Brief: White bars (safe-area + card-transition)

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

- **Bug 1** (`Desktop/bug 1.PNG`): on a real iPhone, a white bar shows at the
  **top** (status-bar strip) and **bottom** (home-indicator / Safari-toolbar
  strip) of the screen, framing the dark page.
- **Bug 2** (`Desktop/bug 2.mp4`): after tapping **Yes / No / Don't know**, a
  white bar flashes on the **right side** of the screen during the slide
  transition to the next question.

## Initial Framing (preserved)

- **User's stated cause or approach**: none given — observation-only ("fix these
  bugs").
- **User's proposed direction**: fix both before continuing with other slices.
- **Pre-dispatch narrowing**: user classified the two as **independent /
  unrelated**, batched only for convenience.

## Dimension Map

The "white where dark should be" could originate at any of these dimensions:

1. **Document root background (`html`/`body`)** — is the base canvas dark? ← actual origin
2. **iOS chrome tint** (`theme-color` meta, `viewport-fit`, safe-area padding) — Bug 1 surface
3. **Card-transition overflow** (slide `translateX`, no clip ancestor) — Bug 2 surface
4. **`bg-cosmic` wrapper coverage** — does the inner dark element reach the edges?

## Hypothesis Investigation

| Hypothesis                                        | Evidence                                                                                                                                                                                                                                                      | Verdict                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Root `html`/`body` background is white            | `global.css:121-122` `body { @apply bg-background }`; `:root --background: oklch(1 0 0)` = white (`:8`); `.dark` override (`:42`) **never applied** — `<html lang="en">` has no `dark` class (`Layout.astro:14`), nothing adds it                             | **STRONG**                     |
| Dark look is only an inner gradient, not the root | `bg-cosmic` = `linear-gradient(...)` (`global.css:113-115`) applied on inner `min-h-screen` divs (`dashboard.astro:32`, `Home.astro:7`, `[part].astro:94,102`); a gradient on an inner box can't paint the safe-area insets or transition overflow            | **STRONG**                     |
| Bug 1: iOS chrome forced white                    | `Layout.astro:20` `theme-color content="#ffffff"`; `:17` viewport has **no** `viewport-fit=cover`; no `env(safe-area-inset-*)` padding anywhere in `src`                                                                                                      | **STRONG** (Bug-1 contributor) |
| Bug 2: transition translate, unclipped            | `QuestionCards.tsx:253-257` keyed wrapper replays `slide-in-from-right-8` (~2rem `translateX`) each card change; no `overflow-x-hidden` on the deck or any ancestor (`[part].astro` `main.max-w-3xl`, `bg-cosmic` div) — the translate exposes the white root | **STRONG** (Bug-2 contributor) |

## Narrowing Signals

- Extracted video frames (`tr_2.25`, `tr_4.7`) show the **entire page content
  shifts horizontally** during the transition, exposing a vertical gap at the
  edge — confirming an unclipped transform reveal, not a sizing bug in the card.
- Bug 1's white appears in the exact regions an inner `min-h-screen` gradient
  cannot reach (notch / home-indicator insets) — consistent with root-canvas
  fall-through, not a per-page error.

## Cross-System Convention

A dark-themed app paints the **base canvas** (`html`/`body`, plus `theme-color`)
dark and treats inner backgrounds as decoration on top. Here the convention is
inverted: the canvas is light (default shadcn `:root`) and a gradient is layered
inside. Every place the gradient doesn't cover reverts to the white canvas. The
standard fixes — dark `body`/`theme-color`, `viewport-fit=cover` + safe-area
padding, and `overflow-x` containment for in-page transforms — all target the
canvas, not the individual symptoms.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the app never establishes a dark
> background at the document root — it runs in light mode (`:root --background`
> = white, `theme-color` = white) and paints the dark theme only on inner
> `bg-cosmic` wrappers; both white bars are the white canvas showing through
> wherever those wrappers don't reach.

The two reports are **not independent** — they share one root cause. Bug 1 is the
canvas showing through the iOS safe-area insets; Bug 2 is the same canvas showing
through the card-transition's horizontal `translateX`. Fixing the root (dark
`body`/`theme-color`) removes the _white_ from both at once. Each symptom still
has a small symptom-specific finish: Bug 1 wants `viewport-fit=cover` +
`env(safe-area-inset-*)` padding so the dark canvas actually extends under the
notch/indicator; Bug 2 wants `overflow-x` containment so the transition doesn't
also induce a layout shift / horizontal scroll.

## Confidence

- **HIGH** — direct source evidence for every link in the chain (root white,
  inner-only dark, plus each symptom's contributor), it matches the standard
  convention, and the video frames corroborate the transition mechanism. No
  reproduction gap remains.

## What Changes for /10x-plan

Plan **one** change with a shared root fix (dark `html`/`body` background +
`theme-color`, applied so the whole app — not just the inspection pages — sits on
a dark canvas) plus two thin symptom finishes (`viewport-fit=cover` + safe-area
padding for Bug 1; `overflow-x` containment on the card deck for Bug 2). Do **not**
plan them as two unrelated fixes — that risks fixing the white twice and missing
the canvas. Watch for regressions on any page that assumed the white default.

## References

- Source: `src/styles/global.css:8,42,113-115,121-122`,
  `src/layouts/Layout.astro:14,17,20,53-60`,
  `src/components/inspections/QuestionCards.tsx:253-257`,
  `src/pages/inspections/[id]/session/part/[part].astro:94,102`
- Evidence frames: scratchpad `tr_2.25.png`, `tr_4.7.png`, `b2_7.png`
- Investigation: performed directly from source (no sub-agents — evidence was
  first-hand; guardrail #6)
