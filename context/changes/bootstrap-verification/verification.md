---
bootstrapped_at: 2026-05-29T21:02:38Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: veriffica
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md`.

```yaml
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
```

**Why this stack** (verbatim from hand-off body):

> Veriffica is a medium-scale, after-hours, solo-shaped offline-first PWA in
> TypeScript. 10x-astro-starter is the recommended default for `(web, js)` and
> clears all four agent-friendly gates, so scaffolding is well-supported. Supabase
> covers every auth requirement out of the box (email+password registration, email
> verification, login/logout, password reset — FR-001/002/003/025) and brings
> Postgres with row-level security for the absolute data-isolation guardrail.
> TypeScript-first with Zod schemas at the boundaries suits the strict field-by-field
> Part 1 validation (FR-012). Deployment lands on Cloudflare Pages (the starter
> default) with GitHub Actions auto-deploy-on-merge. Payments, realtime multi-device
> sync, and AI are out of scope per PRD non-goals. The dominant engineering item —
> the offline-first PWA layer (service worker, on-device store, Change Queue,
> Last-Write-Wins sync, FR-023) — ships with no starter and will be built on top.

## Pre-scaffold verification

| Signal      | Value                                                      | Severity | Notes                                                        |
| ----------- | ---------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| npm package | not run                                                    | —        | cmd_template uses `git clone`; no npm `create-*` CLI to check |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17  | fresh    | from card.docs_url; fetched via public GitHub API (gh CLI unavailable) |

No stale signal. Proceeded normally.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 19
**Conflicts (.scaffold siblings)**: CLAUDE.md → CLAUDE.md.scaffold
**.gitignore handling**: moved silently (absent in cwd before scaffold)
**.bootstrap-scaffold cleanup**: deleted (upstream `.git/` removed before move-up so starter history does not leak)

Files moved up into cwd: `.env.example`, `.github`, `.gitignore`, `.husky`, `.nvmrc`, `.prettierrc.json`, `.vscode`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules`, `package-lock.json`, `package.json`, `public`, `src`, `supabase`, `tsconfig.json`, `wrangler.jsonc`.

Dropped per conflict matrix: upstream `.git/` (history removed). No `context/` present in the scaffold, so the cwd `context/` was untouched (and is the source of truth regardless).

## Post-scaffold audit

**Tool**: npm audit --json
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW (10 total)
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0 — the single HIGH is transitive; both direct findings are MODERATE.
**Audit tool exit code**: 1 (informational only — non-zero is expected when advisories exist; not a halt)
**Dependency tree**: 895 total (449 prod, 316 dev, 131 optional)

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** (range 5.6.3–5.8.0, transitive) — Svelte devalue: DoS via sparse array deserialization. Advisory GHSA-77vg-94rm-hx3p (CWE-770), CVSS 7.5. Fix available.

#### MODERATE findings

- **@astrojs/check** (direct, `>=0.9.3`) — via @astrojs/language-server. Fix available (downgrade to 0.9.2, semver-major).
- **@astrojs/language-server** (transitive) — via volar-service-yaml.
- **@cloudflare/vite-plugin** (transitive) — via miniflare, wrangler, ws. Fix available.
- **miniflare** (transitive) — via ws. Fix available.
- **volar-service-yaml** (transitive, `<=0.0.70`) — via yaml-language-server.
- **wrangler** (direct) — via miniflare. Fix available.
- **ws** (transitive, 8.0.0–8.20.0) — uninitialized memory disclosure. Advisory GHSA-58qx-3vcg-4xpx (CWE-908), CVSS 4.4. Fix available.
- **yaml** (transitive, 2.0.0–2.8.2) — stack overflow via deeply nested YAML collections. Advisory GHSA-48c2-rrv3-qjmp (CWE-674), CVSS 4.3.
- **yaml-language-server** (transitive) — via yaml.

#### LOW / INFO findings

None.

Note: bootstrapper does not auto-fix. `npm audit fix` (and `--force` for the semver-major @astrojs/check change) are available manual remedies — apply per your project's risk tolerance.

## Hints recorded but not acted on

| Hint                    | Value                  |
| ----------------------- | ---------------------- |
| bootstrapper_confidence | first-class            |
| quality_override        | false                  |
| path_taken              | standard               |
| self_check_answers      | null                   |
| team_size               | solo                   |
| deployment_target       | cloudflare-pages       |
| ci_provider             | github-actions         |
| ci_default_flow         | auto-deploy-on-merge   |
| has_auth                | true                   |
| has_payments            | false                  |
| has_realtime            | false                  |
| has_ai                  | false                  |
| has_background_jobs     | false                  |

v1 surfaces these for audit-trail completeness but takes no automated action on them. `bootstrapper_confidence: first-class` and `quality_override: false` require no compensation. CI/CD scaffolding (github-actions / auto-deploy-on-merge) and feature-flag-driven setup are deferred to a future skill.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` is not needed — this repo already has its own history; the cloned starter's `.git/` was removed so no upstream history leaked.
- Review `CLAUDE.md.scaffold` against your existing `CLAUDE.md` (`diff CLAUDE.md CLAUDE.md.scaffold`) and decide what, if anything, to merge.
- Address audit findings per your project's risk tolerance — the full breakdown is above.
- Configure Supabase RLS early (per the starter's gotcha) to avoid auth gaps, since `has_auth: true`.
