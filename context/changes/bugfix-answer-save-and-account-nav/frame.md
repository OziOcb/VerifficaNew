# Frame Brief: Lost answers on fast-clicking & mobile account-icon dropdown

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed. Two independent bugs,
> framed together at the user's request.

## Reported Observation

- **Bug 1 — lost answers**: Clicking the Yes/No/Don't-know buttons quickly through
  a Part (Parts 2–5 card deck) to its end drops some answers. Confirmed by user:
  happens **only on rapid tapping**, not at a normal pace.
- **Bug 2 — mobile account-icon dropdown**: On a real phone (dashboard), tapping the
  account icon shows **no menu at all**. It starts working only after the user opens
  the "Start new inspection" pop-up and closes it. Confirmed by user: the dropdown
  _never appears_ on first tap (not a broken link inside the menu).

## Initial Framing (preserved)

- **User's stated cause or approach**:
  - Bug 1: buttons should be disabled until the previous answer's save is confirmed.
  - Bug 2: none stated — only the workaround was described.
- **User's proposed direction**:
  - Bug 1: disable Yes/No/Don't-know until the prior answer is saved.
  - Bug 2: "fix mobile account-icon navigation."
- **Pre-dispatch narrowing**: Both bugs in one brief; Bug 1 loss occurs _only on rapid
  tapping_; Bug 2 = _dropdown never appears_ on first tap until the popup is cycled.

## Dimension Map

**Bug 1 — where an answer could be lost between tap and durable storage:**

1. **Button interactivity** — a tap is accepted while a prior save is still in flight.
   _(user's framing lands here)_
2. **In-memory answers map read** — `handleAnswer` builds the next map from `answers`,
   which is read from an **async `useLiveQuery`** that lags the writes.
3. **Write/merge semantics** — `saveInspection` overwrites the _entire_ `answers` jsonb
   column with the caller-supplied map (no key-level merge for jsonb).
4. **Outbox → server sync** — FIFO drain / server upsert could drop an op.

**Bug 2 — why the dropdown never opens until a Dialog cycles:**

1. **Trigger hydration timing** — `client:only` island not yet interactive on first tap.
2. **Radix modal body-lock** — modal `DropdownMenu`/`Dialog` (Radix default `modal=true`)
   manage `body { pointer-events }` / scroll-lock; a stuck lock blocks the trigger until
   a sibling modal cycles and resets it. _(leading)_
3. **Two-island interaction** — `AccountMenu` (`client:only`) and `DashboardBoard`
   (`client:load`) are separate React roots that may not share one `react-remove-scroll`
   body-lock ref-counter, desyncing the body `pointer-events` state.
4. **Touch-only event handling** — first-tap `onPointerDown` outside-detection misfires
   on touch (would NOT be fixed by cycling a Dialog → weak fit for this report).

## Hypothesis Investigation

| Hypothesis                                                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                 | Verdict                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| B1-D2/D3: stale `useLiveQuery` read + whole-column jsonb overwrite         | `QuestionCards.tsx:96-97` (`answers` from async live row), `:162-176` (`nextMap = {...answers,[id]:answer}`, advance on save-resolve, no disable), `sync.ts:122-129` (jsonb field overwritten, not key-merged). Rapid taps advance before the live row re-renders → next map is stale → save overwrites and drops the just-saved key. Matches "only on rapid tapping."   | **STRONG**                                   |
| B1-D1: buttons tappable during in-flight save (user's framing)             | True but _partial_: disabling during the in-flight save alone doesn't close the race, because the stale source is the async `useLiveQuery`, which can still lag one render _after_ the save resolves and the card advances.                                                                                                                                              | **WEAK**                                     |
| B1-D4: outbox/server drops the op                                          | Outbox is atomic + FIFO by `seq`; sync upserts the whole row; no evidence of loss here.                                                                                                                                                                                                                                                                                  | **NONE**                                     |
| B2-D2: Radix modal body `pointer-events` lock                              | Static support was strong (Radix default `modal=true` in `dropdown-menu.tsx:7-8`/`dialog.tsx:8-9`; release notes on `pointer-events`/Dialog composability). **BUT reproduction refuted it**: the body `pointer-events` lifecycle is healthy (`auto → none while open → auto after Dialog close`); no stuck lock. See Reproduction below.                                 | **NOT REPRODUCED**                           |
| B2-D3: two-island body-lock desync                                         | `AppHeader.astro:51` mounts `AccountMenu` `client:only`; `dashboard.astro` mounts `DashboardBoard` `client:load` — separate roots. Reproduction showed the lock releasing cleanly across both islands → no observed desync in automation.                                                                                                                                | **NOT REPRODUCED**                           |
| B2-D5: real-iOS-Safari first-tap / hover-on-touch / click-delegation (NEW) | Emerged from the negative repro. The trigger carries a `hover:bg-accent` style (`AccountMenu.tsx:59`); iOS Safari's first-tap-shows-hover / delegated-click-warmup behavior would swallow the first real finger tap and be "primed" by the first successful native-button tap (the Start button) — matching the workaround. Not exercised by Playwright's synthetic tap. | **LEADING (unverified — needs real device)** |
| B2-D1 / B2-D4: hydration timing / touch-only event                         | `client:only` delays interactivity, but the menu opened on the very first synthetic tap; time/hydration alone doesn't explain the Dialog-cycle workaround.                                                                                                                                                                                                               | **WEAK**                                     |

### Reproduction (Bug 2) — attempted, did NOT reproduce

Drove the dashboard end-to-end (auth via the signin API — see note — then real `page.tap()`):

- **Chromium mobile profile (Pixel 7, hasTouch)**: account dropdown **opened on the first tap**. `bodyPE_initial=auto`, open→`none`, after Dialog cycle→`auto`.
- **WebKit iPhone profile (iPhone 13, iOS engine + touch)**: **same** — opened on the first tap; `pointer-events` cycled cleanly; no stuck state.

Conclusion: the bug does **not** reproduce via Playwright's synthetic tap against the SW-less `npm run dev` server in either engine. The healthy `pointer-events` lifecycle **contradicts** the body-lock hypothesis (D2/D3). The real-phone report most likely stems from (a) real iOS-Safari finger-tap semantics that Playwright's clean synthetic tap bypasses, and/or (b) the **deployed SW-controlled PWA / standalone display mode**, which the dev server doesn't run. Real-device reproduction against the deployed Worker is required before planning a fix.

> Environment note surfaced during repro: **`/auth/signin` and `/auth/signup` currently return HTTP 500 on the running `npm run dev` server** (the signin _API_ `/api/auth/signin` works — that's how the repro authenticated). Not part of these two bugs, but worth a look — possibly a stale dev server or a real regression in the auth _page_ render.

## Narrowing Signals

- **"Only on rapid tapping" (user)** → rules in the timing-dependent stale-read race
  (B1-D2/D3); rules out a deterministic per-answer save failure.
- **"Dropdown never appears until popup cycled" (user)** → a _stateful_ reset primed by
  the first successful native-button tap. Originally read as a body-lock reset (D2/D3),
  but repro refuted that; now points at iOS first-tap/click-delegation warmup (D5).
- **Repro negative in both engines** → rules OUT the body-`pointer-events` lock (D2/D3);
  rules IN a real-iOS-device / deployed-PWA-specific cause not reachable in automation.
- **Only `QuestionCards.handleAnswer` writes the `answers` jsonb** — `SessionScreen`
  reads answers read-only and only writes scalar `globalNotes`; the race is contained to
  one code path.

## Cross-System Convention

- **Bug 1**: Optimistic-write UIs derive the "next" state from a synchronous source of
  truth (a ref / functional updater / merge-by-key), never from an async subscription
  read that can lag. This repo already read-merges _columns_; the gap is that the jsonb
  `answers` map is overwritten wholesale rather than merged by key. The lessons register's
  no-data-loss and read-merge guardrails point the same way.
- **Bug 2**: A lightweight menu doesn't need modal scroll-lock; Radix's own guidance and
  release history treat `modal` body-lock as the source of composability/pointer-events
  bugs — the conventional escape hatch is `modal={false}` on the menu.

## Reframed (or Confirmed) Problem Statement

> **Bug 1 — the actual problem**: Not "buttons are tappable too early," but "the next
> answers map is built from an **async `useLiveQuery` read that lags the writes**, and
> each save **overwrites the whole `answers` jsonb column** — so a fast second tap saves
> a stale map that drops the previous answer." Disabling the buttons is a _partial_
> mitigation; the durable fix must remove the stale-read dependency (build the next map
> from a synchronous latest-value source, and/or merge the jsonb by key).

> **Bug 2 — the actual problem (revised after reproduction)**: Confidently NOT a
> "navigation" bug (the icon opens a dropdown, it navigates nothing). The pre-repro theory
> — a stuck modal body `pointer-events` lock reset by cycling the Dialog — **was tested and
> did not reproduce** (the lock lifecycle is healthy in Chromium-mobile and WebKit-iPhone).
> The residual, still-unverified hypothesis is a **real-iOS-Safari first-tap / hover-on-touch
> / delegated-click-warmup** on the Radix trigger (which carries a `hover:` style), possibly
> only on the **deployed SW-controlled PWA**. This needs a **real-device reproduction against
> the deployed Worker** before a fix is chosen; do not plan the body-lock fix on the strength
> of the static theory alone.

Addressing these changes the plan: Bug 1's plan should center on the answer-map data flow
(sync source + jsonb key-merge), with a button in-flight guard as defense-in-depth — not
_only_ a disable. Bug 2 is **not ready to plan a fix**: the body-lock theory was refuted by
reproduction, so the plan must start from a real-device repro against the deployed PWA.

## Confidence

- **Bug 1: HIGH** — strong code evidence, matches the "rapid tapping only" signal, matches
  the repo's own read-merge convention. Ready for /10x-plan.
- **Bug 2: LOW** (downgraded from MEDIUM after reproduction) — the leading static hypothesis
  (modal body-lock) **did not reproduce** in Chromium-mobile or WebKit-iPhone; the
  `pointer-events` lifecycle is healthy. No verified mechanism yet.
  - **Required before planning a fix**: reproduce on a **real iOS device** against the
    **deployed Worker** (`https://veriffica.veriffica.workers.dev`), ideally with the PWA
    installed to standalone. Watch whether the first finger tap on the account icon is
    swallowed, whether a plain `<button>` tap first "primes" it, and whether removing the
    trigger's `hover:` style or setting `modal={false}` changes anything. Only then choose a
    fix. (Automated Playwright tap is not a faithful oracle for this bug.)

## What Changes for /10x-plan

- **Bug 1**: Plan the fix around the answer-map data flow — remove the stale-`useLiveQuery`
  dependency in `handleAnswer` (synchronous latest map + jsonb key-level merge in
  `saveInspection`), and add an in-flight button guard as belt-and-suspenders. Not a
  disable-only fix. **Ready to plan.**
- **Bug 2**: **Hold.** Do not plan a fix on the static theory — reproduction refuted it.
  First get a real-device repro (above) to pin the mechanism (iOS first-tap/hover/click
  warmup vs deployed-PWA-specific), then plan. Splitting Bug 2 into its own change once
  reproduced is reasonable, so Bug 1 can ship independently.

## References

- Source files: `src/components/inspections/QuestionCards.tsx:96-97,162-176`;
  `src/lib/sync.ts:78,109-151`; `src/components/dashboard/AccountMenu.tsx:56-96`;
  `src/components/AppHeader.astro:44-52`; `src/components/dashboard/DashboardBoard.tsx:187-267`;
  `src/components/ui/dropdown-menu.tsx:7-8`; `src/components/ui/dialog.tsx:8-9`.
- Cross-system: Radix Primitives release history — `modal` prop, "re-enabled
  pointer-events when closed," "improved composability with Dialog" (context7 `/websites/radix-ui_primitives`).
- Lessons: read-merge / no-data-loss guardrails in `context/foundation/lessons.md`.
- Investigation: direct code + docs reads (surface small enough that parallel sub-agents
  were not warranted per guardrail #6).
