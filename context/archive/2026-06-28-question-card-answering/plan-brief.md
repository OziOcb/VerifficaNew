# Question-Card Answering (S-05) — Plan Brief

> Full plan: `context/changes/question-card-answering/plan.md`

## What & Why

Build the answering surface for Parts 2–5: a full-screen card deck (one question per screen)
where a layperson taps `Yes` / `No` / `Don't know`, with mandatory answering, lossless
back-navigation, per-Part progress, an educational `i`-popup, and a 500-char contextual note
per question. This is the core interaction the ≥75% completion metric depends on — the step
that turns the S-04 personalized question set into actual recorded answers. Implements
FR-015, FR-017, FR-018, US-01.

## Starting Point

The S-04 visibility engine (`src/lib/questions.ts`) already produces the personalized,
ordered question set and resolves explanations. The Part route
(`…/session/part/[part].astro`) SSR-loads the inspection and guards config-unlock, but its
Parts 2–5 body is a "Question cards arrive next." placeholder. There is **no answer store** —
the whole app persists through one `inspections` row → Dexie outbox → `/api/inspections/sync`.

## Desired End State

A user with a valid Part-1 config opens any Part, lands on the first unanswered question, taps
through the deck (auto-advancing), goes Back losslessly, opens explanations where they exist,
attaches notes that fold into the global notes document, and hits an "OK → session" transition
at the Part's end. Every answer and note survives offline + reload and syncs on reconnect.

## Key Decisions Made

| Decision                 | Choice                                    | Why (1 sentence)                                                                  | Source |
| ------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| Answer storage           | `answers` JSONB map on the inspection row | Reuses the entire offline outbox/sync/read-merge machinery; one map for S-06/S-07 | Plan   |
| Save timing              | Immediately per answer (optimistic)       | Holds the no-data-loss guarantee mid-Part and offline                             | Plan   |
| Session score numerators | Deferred to S-06                          | Keeps the slice tight; per-Part _card_ progress is still in scope                 | Plan   |
| Swipe model              | Tap-to-answer + animated slide            | Meets "one per screen" + mandatory + lossless-back with no gesture-lib risk       | Plan   |
| Advance                  | Auto-advance on tapping an answer         | Fewest taps across 200+ short questions; mandatory rule is implicit               | Plan   |
| Card routing / Back      | In-island index + History API             | "Back via gesture or Back" without per-card URLs or SSR reloads                   | Plan   |
| Resume point             | First unanswered card                     | Natural offline mid-visit resume                                                  | Plan   |
| Re-note semantics        | Replace that question's block             | One headed block per question — no duplicate headers, editable                    | Plan   |
| Forward/back rule        | Next enabled iff current card answered    | One rule covers first-pass, back-up, and review — never forces a re-answer        | Plan   |

## Scope

**In scope:** `answers` JSONB column + sync wiring; pure answer/question/note logic; the card
deck island (answer flow, Back/Next, History API, progress, resume, transition screen);
education `i`-popup (FR-017); 500-char contextual notes folded into the global notes doc (FR-018).

**Out of scope:** session Total Score / Completion numerators and the Summary page (S-06);
Smart Pruning on config change (S-07); offline flow-level hardening (S-08); a separate answers
table/store; touch-drag gesture lib; per-card URLs.

## Architecture / Approach

Answers live as a JSONB map (`{ questionId: "yes"|"no"|"dont_know" }`) on the existing
`inspections` row, so `saveInspection({ id, answers })` rides the proven optimistic
write → outbox → sync path with no new entity. The card island holds the deck index and
persists each answer immediately; explanation text and the display header are resolved
**server-side** in the route and passed in, so the 80 KB catalogue never reaches the client.
Contextual notes are not a new store — they append/replace a headed block in the existing
`globalNotes` document.

## Phases at a Glance

| Phase                              | What it delivers                                     | Key risk                                                |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| 1. Answers data model & sync       | `answers` column, type regen, outbox carries the map | Deep key-casing mangling `q_…` keys — needs `stopPaths` |
| 2. Pure answer/question/note logic | Tested helpers: model, ordered deck, note upsert     | Note-block parse/replace correctness                    |
| 3. Card deck island & flow         | The full answering interaction wired into the route  | Mandatory-answer + lossless Back via History API        |
| 4. Education popup + notes         | `i`-popup and 500-char contextual notes on the card  | Note replace (not duplicate) + offline durability       |

**Prerequisites:** S-04 implemented/archived (it is); local Supabase for migration + `db:types`.
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- The JSONB casing exclusion (`stopPaths: ["answers"]`) must be applied at **every** deep
  `camelcaseKeys` that selects `answers` (sync endpoint + card route), or question IDs corrupt.
- Note-block round-tripping (write a header → parse it back to pre-fill/replace) needs an
  unambiguous delimiter so user-typed text can't forge a block boundary.
- The answers map is the single structure S-07 Smart Pruning will operate on — keep it the
  canonical source, not a derived cache.

## Success Criteria (Summary)

- A user can answer a whole Part end-to-end: mandatory answering, auto-advance, lossless Back,
  per-Part progress, and an "OK → session" transition.
- Answers and notes survive going offline and reloading, and sync automatically on reconnect.
- Education popups show the right explanation only where one exists; contextual notes land
  (and re-land) as a single headed block in the global notes document.
