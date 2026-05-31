---
starter_id: 10x-astro-starter
package_manager: npm
project_name: veriffica
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

Veriffica is a medium-scale, after-hours, solo-shaped offline-first PWA in
TypeScript. 10x-astro-starter is the recommended default for `(web, js)` and
clears all four agent-friendly gates, so scaffolding is well-supported. Supabase
covers every auth requirement out of the box (email+password registration, email
verification, login/logout, password reset — FR-001/002/003/025) and brings
Postgres with row-level security for the absolute data-isolation guardrail.
TypeScript-first with Zod schemas at the boundaries suits the strict field-by-field
Part 1 validation (FR-012). Deployment lands on Cloudflare Pages (the starter
default) with GitHub Actions auto-deploy-on-merge. Payments, realtime multi-device
sync, and AI are out of scope per PRD non-goals. The dominant engineering item —
the offline-first PWA layer (service worker, on-device store, Change Queue,
Last-Write-Wins sync, FR-023) — ships with no starter and will be built on top.
