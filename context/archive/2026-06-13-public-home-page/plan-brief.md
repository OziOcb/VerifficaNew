# Public Home Page (S-01) — Plan Brief

> Full plan: `context/changes/public-home-page/plan.md`

## What & Why

Build Veriffica's public home page — the only surface visible without an account (PRD
§Access Control). It describes the product (personalization wedge + the 5-part inspection +
benefits + helper-tool framing) and offers log in / register actions (FR-005). The slice
also formally lands the **English-only UI convention (FR-024)** by removing the two
non-English strings still in the shell.

## Starting Point

`/` currently renders `Welcome.astro` — untouched 10x-Astro-Starter boilerplate ("10x Astro
Starter" hero + 3 generic feature cards). The cosmic design system, auth pages, and an
auth-aware `Topbar.astro` already exist and are reused. Two non-English leaks remain: the
starter default page title and a Polish config-status banner.

## Desired End State

Signed-out visitors see a Veriffica-branded landing page (hero, "checklist that already
knows your car" wedge, the 5 parts Info→Standstill→Engine→Drive→Documents, benefits, the
helper-tool disclaimer) with Sign in / Register CTAs. Signed-in visitors see the same page
with a "Go to Dashboard" action instead. No Polish or "10x Astro Starter" strings ship.

## Key Decisions Made

| Decision           | Choice                                      | Why (1 sentence)                                                       | Source |
| ------------------ | ------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| Page structure     | New `Home.astro`, delete `Welcome.astro`    | Intention-revealing name for a now-branded page.                       | Plan   |
| Content scope      | Richer landing (wedge + 5 parts + benefits) | Sells the personalization wedge that is the product's core trait.      | Plan   |
| Signed-in behavior | Show page; swap CTAs to "Go to Dashboard"   | No surprise redirect; reuses the existing `Topbar` auth pattern.       | Plan   |
| FR-024 cleanup     | Fix all leaks (banner + default title)      | Actually makes "English-only" true, as the roadmap intends.            | Plan   |
| Visual approach    | Cosmic theme + Veriffica polish             | Consistency with auth pages for free, plus inspection-themed identity. | Plan   |

## Scope

**In scope:** new `Home.astro` landing content; auth-aware CTA swap; rewire `index.astro`;
delete `Welcome.astro`; brand the `Layout` default title; translate the config-status banner.

**Out of scope:** auth/API/DB/middleware changes; redesign of auth/dashboard pages; signed-in
auto-redirect; any i18n framework; hero imagery/photography.

## Architecture / Approach

A server-rendered Astro page with no client islands. `Home.astro` reuses the cosmic shell
(orbs, star field, `Topbar`) from the retired `Welcome.astro`, reads `Astro.locals.user`
(populated by middleware) for the CTA swap, and links to the existing `/auth/*` routes.
FR-024 cleanup is two isolated string edits in `config-status.ts` and `Layout.astro`.

## Phases at a Glance

| Phase                    | What it delivers                                            | Key risk                                            |
| ------------------------ | ----------------------------------------------------------- | --------------------------------------------------- |
| 1. Veriffica home page   | New landing content + auth-aware CTAs; `Welcome.astro` gone | Copy quality / responsive layout — manual-verified. |
| 2. English-only (FR-024) | English banner + branded default title                      | Missing a non-English string — grep-verified.       |

**Prerequisites:** none (standalone public surface; cosmic theme + auth routes already exist).
**Estimated effort:** ~1 session, 2 small phases.

## Open Risks & Assumptions

- Copy is authored from the PRD; final wording is a manual-review judgment, not a build gate.
- Assumes `index.astro` is the only importer of `Welcome.astro` (verified by grep before delete).

## Success Criteria (Summary)

- Signed-out `/` fully describes the product (FR-005) with working Sign in / Register CTAs.
- Signed-in `/` offers a Go to Dashboard action instead of auth CTAs.
- No Polish or starter-branded strings remain anywhere in `src/` (FR-024).
