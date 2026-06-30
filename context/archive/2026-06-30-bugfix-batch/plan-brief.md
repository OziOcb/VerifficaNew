# Bugfix Batch: Dark-canvas white bars — Plan Brief

> Full plan: `context/changes/bugfix-batch/plan.md`
> Frame brief: `context/changes/bugfix-batch/frame.md`

## What & Why

Two white bars on a real iPhone — top/bottom strips framing the page (Bug 1) and a white flash on the right during the answer slide-transition (Bug 2) — share **one root cause**: the app never establishes a dark background at the document root. It runs in shadcn's default light mode (`:root --background` = white, `theme-color` = white) and paints the dark theme only on inner `bg-cosmic` wrappers; both white bars are the white canvas showing through wherever those wrappers don't reach.

## Starting Point

Every page wraps content in a fixed dark `bg-cosmic` gradient on an inner `min-h-screen` div, but `<html>` never gets the `dark` class, `body` paints white (`bg-background`), `theme-color` is `#ffffff`, the viewport lacks `viewport-fit=cover`, and the card deck has no `overflow-x` containment. There is no light design for any page — the app is dark-only by intent.

## Desired End State

The app fills the entire iPhone screen with the dark canvas — no white strips at top, bottom, or right edge, including during transitions. Dark is established at the root (`<html class="dark">`, solid `#0a0e1a` body, dark `theme-color`), so any region the inner gradient can't reach still reads dark. A dark-clamped cookie + head-script hook is in place for the future S-10 toggle.

## Key Decisions Made

| Decision            | Choice                                                      | Why (1 sentence)                                                                      | Source |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------ |
| Root cause          | Single shared cause (light canvas), not two bugs            | Frame proved both bars are the white root showing through.                            | Frame  |
| Dark mechanism      | Enable shadcn `.dark` globally (class on `<html>`)          | Most convention-correct for an all-dark app; flips components coherently dark.        | Plan   |
| Canvas fill         | Solid `#0a0e1a` (gradient edge color)                       | Seams perfectly with the inner gradient; bars become invisible, no mid-tone mismatch. | Plan   |
| Bug 2 containment   | `overflow-x` on the card deck wrapper (not global `body`)   | Targeted clip; avoids breaking `position: sticky`/scroll-anchoring elsewhere.         | Plan   |
| Theming vs S-10     | Force dark now + dark-clamped cookie/head-script infra hook | Fixes bugs immediately with zero broken light-mode; S-10 inherits ready infra.        | Plan   |
| Toggle / light mode | Deferred to S-10 (`settings-profile`)                       | Real light mode needs theme-aware pages — that's S-10's scope, not a bugfix.          | Plan   |
| Verification        | Real-iPhone manual check is the primary gate                | Safe-area + `theme-color` behavior can't be reproduced in CI.                         | Plan   |

## Scope

**In scope:** dark root (`.dark`), solid dark body, dark `theme-color`, `viewport-fit=cover` + safe-area padding (Bug 1), card-deck `overflow-x` containment (Bug 2), dark-clamped cookie + blocking head-script infra hook.

**Out of scope:** visible theme toggle, system-preference resolution taking effect, any light theme for pages, font-size control (all S-10).

## Architecture / Approach

Fix the root cause once (dark canvas at `<html>`/`body` + `theme-color`), then two edge-specific finishes. SSR reads an optional `theme` cookie and clamps to `dark` today, rendering `<html class="dark">` flash-free; a tiny blocking head-script re-asserts the same clamp as the forward-compatible FOUC guard S-10 will widen. Safe-area: `viewport-fit=cover` + dark body paints the insets dark; `env(safe-area-inset-*)` padding keeps content clear. Overflow: clip on the nearest non-sliding ancestor of the keyed animating div.

## Phases at a Glance

| Phase                                  | What it delivers                                      | Key risk                                                        |
| -------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| 1. Dark canvas + theme infra hook      | Dark root, body, theme-color; cookie/head-script hook | `.dark` flips shadcn components — needs a visual coherence pass |
| 2. Bug 1 finish — iOS safe area        | `viewport-fit=cover` + safe-area padding              | Only verifiable on a real device; content-clipping under notch  |
| 3. Bug 2 finish — overflow containment | `overflow-x` clip on the card deck                    | Clipping the wrong (sliding) ancestor; over-clipping            |

**Prerequisites:** access to the real iPhone that showed the bugs (for phases 2–3 verification); dev server running on workerd.
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- Enabling `.dark` globally changes every `bg-background` shadcn component; auth forms/dialogs need a quick visual check (assumed acceptable since the app is dark by intent).
- Assumes `#0a0e1a` is the correct gradient-edge match for a seamless canvas (confirmed from `global.css:114`).
- Phases 2–3 cannot be fully validated without the physical device.

## Success Criteria (Summary)

- No white bars at top/bottom/right on the real iPhone, statically or during transitions.
- Auth/dashboard/session pages and shadcn components render coherently dark.
- Lint, type-check, build, and existing tests stay green; S-10 can flip themes via the cookie hook with no re-plumbing.
