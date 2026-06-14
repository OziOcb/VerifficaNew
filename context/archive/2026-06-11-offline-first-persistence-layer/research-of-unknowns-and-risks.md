---
change_id: offline-first-persistence-layer
title: F-02 research — resolving unknowns & risks
status: research
created: 2026-06-11
updated: 2026-06-11
method: web search (Exa), landscape/architecture level
---

# F-02 Research: resolving unknowns & risks

Research into how to resolve the **Unknown** (LWW/Client-Wins reconciliation edge
cases, esp. the global notes document) and the **Risk** (#1 blocker: unfamiliar
tech, no starter) recorded for F-02 in `context/foundation/roadmap.md`, constrained
to the `context/foundation/tech-stack.md` stack (Astro 6 SSR + React 19 + TS strict

- Supabase + Cloudflare Workers, offline-first PWA).

## Key framing: the stack collapses most of the risk

Veriffica is **single-device, single-writer**. Multi-device realtime sync is an
explicit non-goal (`has_realtime: false`; "Multi-device real-time sync guarantee"
is parked). Nearly every LWW failure mode in the literature — clock skew, lost
concurrent writes, text interleaving — is a **multi-writer concurrent** problem,
which Veriffica does not have. This shrinks the "Unknown" dramatically: plain LWW
is adequate, and no CRDT is needed for the MVP.

Decision rule from the research (SyncKit conflict guide; Sujeet Jaiswal's CRDT
survey): _"We need eventual consistency" ≠ "we need a CRDT." Plain LWW is simpler
and good enough unless concurrent multi-writer merges are a hard requirement._

## Risk: "no starter / unfamiliar tech" → assemble proven parts, don't hand-roll all of it

The offline layer is four separable pieces, each with a stack-compatible answer:

### 1. Service worker / PWA shell → `@vite-pwa/astro`

- Official Astro integration wrapping Workbox; TS-first; supports Astro SSR
  (`output: "server"`). For SSR it precaches from `dist/client`.
  Refs: github.com/vite-pwa/astro, astro-pwa-recipe.vercel.app/recipe/generate-sw
- **Concept:** the service worker is a _browser_ artifact, completely separate from
  the Cloudflare Worker running SSR. CF Worker renders/serves; the SW caches in the
  browser. They don't interact.
- **Critical caveat:** Supabase auth endpoints (`/api/auth/{signin,signup,signout}`)
  and `PROTECTED_ROUTES` must be `NetworkOnly` / added to Workbox
  `navigateFallbackDenylist`, or the SW will cache an authenticated shell or an auth
  POST and corrupt auth state. For SSR, precache a _static app-shell fallback_ for
  offline navigation rather than each server-rendered page.

### 2. On-device store → Dexie.js

- Most popular IndexedDB wrapper, TS-native, battle-tested. Raw IndexedDB works but
  is verbose. Heavier options (RxDB, TanStack DB) exist — see tier table.

### 3 + 4. Change Queue + LWW sync — three tiers

| Option                                                                                       | What you get                                                                                                           | Fit                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Hand-rolled outbox** (Dexie data table + `change_queue` table + `navigator.onLine` replay) | Full control, max learning, matches the "round-trip one record" scope cap                                              | ✅ Best fit for learning + minimal scope. Step-by-step pattern in LogRocket 2025 guide (two object stores, optimistic write, FIFO replay) |
| **`@tanstack/offline-transactions`**                                                         | Durable IndexedDB outbox, exponential backoff+jitter, **multi-tab leader election** (Web Locks/BroadcastChannel), FIFO | ✅ Strong if you want retry + the multi-tab edge handled for you                                                                          |
| **RxDB + Supabase replication plugin**                                                       | Full two-way sync engine, built-in conflict resolution                                                                 | ⚠️ Overkill — leans on Supabase **Realtime** (WAL/logical replication), a non-goal. Skip. (rxdb.info/replication-supabase.html)           |

**Recommendation:** `@vite-pwa/astro` + **Dexie** + **hand-rolled outbox** — unless
the multi-tab case worries you, in which case swap the queue for
`@tanstack/offline-transactions` to get leader election for free. Keeps you inside
the scope cap; most instructive while learning.

## Unknown: LWW reconciliation edge cases (esp. global notes document)

**Where LWW is genuinely safe (most data):** answers, config, inspection status —
single device, single writer. A simple `updated_at` timestamp comparison at sync
(newer wins) is sufficient — the standard Supabase LWW pattern.

**The two real residual edge cases — both fixable without CRDTs:**

1. **Multi-tab on one device** — the only true "concurrent" case Veriffica actually
   has (two tabs, each with an outbox, replaying → duplicate/clobbering writes).
   Fix: a single-leader guard via **Web Locks / BroadcastChannel** (exactly what
   TanStack offline-transactions' leader election provides). Most worth explicitly
   handling.

2. **Global notes document as one LWW blob** — if notes are one large text field
   overwritten whole by the "last" write, an edit can be silently dropped. Fix is
   **granularity, not CRDTs**: store notes at row/field level (per-question notes as
   separate rows; structure the global notes doc so independent edits land in
   independent rows). Independent fields never collide, so LWW never has anything to
   drop ("design to avoid conflicts" / field-level ownership).

**Not needed:** Yjs/Automerge/OT text CRDTs — they earn their complexity only for
collaborative (multi-user, same-doc, realtime) text editing, which contradicts the
non-goals. **Park.** Revisit only if collaborative notes ever enter scope.

**Optional robustness upgrade:** raw wall-clock timestamps can produce tie/skew
anomalies; using a **monotonic counter or Hybrid Logical Clock** for the LWW field
is safer. Minor / nice-to-have, not blocking for single device.

## Net resolution

- **Unknown (LWW edge cases):** resolvable now, no spike needed. LWW via
  timestamp/HLC is adequate (single-writer); handle the two real edges with
  (a) multi-tab leader election and (b) row/field-level notes granularity. CRDTs
  out of scope.
- **Risk (no starter):** de-risked by assembling proven parts
  (`@vite-pwa/astro` + Dexie + outbox) rather than building from zero. Scope stays
  at "one record round-trips."

## Sources

- LogRocket — _Offline-first frontend apps in 2025: IndexedDB and SQLite_ (2025-11): IndexedDB + sync-queue outbox pattern, optimistic write, FIFO replay
- TanStack DB — `@tanstack/offline-transactions` (outbox, leader election, retry/backoff, IndexedDB→localStorage fallback)
- vite-pwa/astro (GitHub, npm) + astro-pwa-recipe.vercel.app — Astro SSR PWA/Workbox config
- RxDB — Supabase replication plugin (rxdb.info) — surveyed and rejected (pulls in Realtime)
- novumlogic/Android-Offline-First-Supabase-Library — canonical timestamp-based LWW algorithm
- Dancode-188/synckit conflict-resolution guide — LWW decision rule, field-level ownership, when to use Text CRDT
- Sujeet Jaiswal — _CRDTs for Collaborative Systems_ — LWW wall-clock pitfalls, HLC/Lamport, "eventual consistency ≠ CRDT"
- aybruhm/collaborative-editing-poc; systemdr — LWW failure modes under concurrent multi-writer (confirm they don't apply here)

> Note: these were architecture/landscape searches (Exa). Exact `@vite-pwa/astro`
> and Dexie API specifics should be pulled via Context7 (current docs) at
> implementation time, not from these summaries.
