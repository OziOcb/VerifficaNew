---
project: "Veriffica"
context_type: greenfield
created: 2026-05-29
updated: 2026-05-29
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "primary persona scope"
      decision: "individual used-car buyer + a helper inspecting on behalf of a friend/family member"
    - topic: "core insight"
      decision: "personalization to the exact car + guided inspection order + capture & recall"
    - topic: "role model"
      decision: "flat — one role, owner-only data access; no admin, no shared access"
    - topic: "email verification"
      decision: "email verification required before full access (email-sending infra in scope)"
    - topic: "MVP scope"
      decision: "full spec incl. Offline-First PWA; user committed to longer timeline (MVP-too-big gate overridden, acknowledged)"
  frs_drafted: 25
  quality_check_status: accepted
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: null
  hard_deadline: null
  after_hours_only: true
---

# Veriffica — Shape Notes

> Source idea: `idea/idea-notes.md`. Supporting source-of-truth artifacts:
> `idea/veriffica-questions-list/` (question bank, mapping config, JSON schemas),
> `idea/veriffica-instruction.md` (startup instruction copy),
> `idea/veriffica-part-1-validation-rules.md` (Part 1 field-by-field validation).

## Vision & Problem Statement

Inspecting a used car before purchase is stressful, chaotic, and high-risk for a
layperson. The buyer — a non-expert with no mechanical training, standing in front
of the car at the seller's location — doesn't know what to look at, which symptoms
matter, how to interpret faults, which documents to verify, or how to remember
every observation during the visit. Today the inspection is ad-hoc and
unstructured, so observations are forgotten, red flags are missed, and the
purchase decision is made on incomplete information.

The insight: a checklist personalized to *this specific car* (fuel type,
transmission, drive, body type, plus equipment exceptions) and ordered to match
the *physical inspection itself* (standstill → starting the engine → test drive →
documents) turns an expert's mental model into a step-by-step guide a layperson
can follow — while recording every answer and contextual note so nothing is lost
when the decision is made. Veriffica is explicitly a helper tool and does not
replace a professional technical inspection.

## User & Persona

**Primary persona:** an individual used-car buyer — a non-expert evaluating a
specific car they intend to buy for themselves. The MVP also explicitly serves a
**helper** inspecting on behalf of a friend or family member (same flat,
single-owner account model; no technical difference). They reach for Veriffica
the moment they arrive to inspect a car and want to be sure they don't miss
anything that matters for *this* vehicle.

## Access Control

Multi-user with a **flat role model**: every account is an ordinary owner who can
see and modify only their own data. No admin role, no shared or team access.

- **Sign-up / sign-in:** email + password. Email verification is required before
  full access (a verification step confirms ownership).
- **Data isolation:** all domain data (inspections, answers, notes, settings) is
  private to the owning account.
- **Session:** logout supported. Loss of network connectivity does NOT log the
  user out or interrupt an inspection (see Offline-First in Business Logic).
- **Account deletion:** the user can permanently and irreversibly delete their
  profile and all associated data, after explicit confirmation (hard delete).
- **Unauthenticated access:** the public home page (product description + log
  in / register actions) is the only surface visible without an account; all
  inspection routes are gated.

> Social login (Google/Apple) is explicitly out of MVP scope — email + password only.

## Success Criteria

### Primary
- **Inspection completion rate ≥ 75%** — at least 75% of started inspections reach
  `Completed` status, manually set by the user after passing through all five
  parts (Info, Standstill, Engine, Drive, Documents).
- **Offline sync success rate = 100%** — every domain operation written to the
  Change Queue while offline syncs correctly once connectivity is restored.

### Secondary
- **Part 1 unlock rate** — share of inspections where the user completes Part 1
  correctly and unlocks Parts 2–5.
- **Summary reach rate** — share of started inspections that reach the Summary page.
- **Draft abandonment rate** — share of inspections left in `Draft` without manual
  finalization.
- **`Don't know` share** — proportion of `Don't know` answers per Part and overall,
  as a signal of checklist difficulty for laypeople.
- **Limit hit frequency** — count of attempts to create a 3rd inspection per
  account, as a demand signal for a future paid/expanded tier.
- **Draft deletion frequency** — count of deleted drafts, as a flow-quality and
  usefulness signal.

### Guardrails
- **No data loss on connectivity change** — losing or regaining network never loses
  local inspection state, answers, or notes, and never logs the user out or
  interrupts an inspection mid-flow.
- **Strict data isolation** — a user can never see another account's inspections,
  answers, or notes. Privacy is absolute.
- **No accidental destructive actions** — hard-delete of a profile or an inspection
  always requires explicit confirmation and is genuinely irreversible; it is never
  triggered by accident.

## Timeline acknowledgment

Acknowledged on 2026-05-29: the full MVP (including the Offline-First PWA, dynamic
question engine, and Smart Pruning) is materially larger than a ~3-week after-hours
build. The MVP-too-big soft gate was surfaced — the expensive pieces were named and
scope-down moves offered. The user explicitly chose to keep the full spec and
accept the sustained multi-week/month effort cost. No fixed week estimate committed
(`mvp_weeks` left open-ended by user choice).

## Functional Requirements

### Account & Access
- FR-001: User can register with an email address and password. Priority: must-have
- FR-002: User can verify their email before gaining full access to the app. Priority: must-have
- FR-003: User can log in and log out. Priority: must-have
- FR-004: User can permanently and irreversibly delete their profile and all associated data after explicit confirmation. Priority: must-have

### Public surface
- FR-005: A visitor can view a public home page describing the product (the 5-part inspection) with log in / register actions. Priority: must-have

### Dashboard & inspection lifecycle
- FR-006: User can view a tiled dashboard of their inspections, grouped by `Draft` vs `Completed`, auto-named from `Make`/`Model` (and optionally `Year of production` / `Registration number`), resume any inspection from its tile, and see an empty state with a CTA when none exist. Priority: must-have
- FR-007: User is limited to a maximum of 2 inspections per account (any status), and sees a pop-up explaining the limit when it is reached. Priority: must-have
  > Socrates: Counter-argument considered: "a hard 2-inspection cap frustrates power users and the limit-hit metric only fires if people try." Resolution: kept at 2 — the cap is a deliberate demand signal for a future paid tier and bounds v1 storage/scope; the frustration is exactly what `Limit hit frequency` measures.
- FR-008: User can permanently delete an inspection (hard delete) after confirmation, which frees an inspection slot. Priority: must-have
- FR-009: On starting a new inspection, the user sees a startup instruction pop-up (content from `idea/veriffica-instruction.md`, communicating the helper-tool disclaimer) with a `Don't show again` option. Priority: must-have

### Session screen
- FR-010: User can open a session screen showing the session name, navigation buttons to Parts 1–5 (free choice of next part), the current Total Score, a completion indicator, and one global editable notes document (10,000-character limit). Priority: must-have

### Part 1 — car configuration
- FR-011: User can fill the Part 1 configuration form with vehicle data (Price, Make, Model, Year, Registration number, VIN, Mileage, Fuel type, Transmission, Drive, Color, Body type, No. of doors, Address, Notes). Priority: must-have
- FR-012: System enforces strict field-by-field validation, data normalization, and cross-field blocks (e.g. Electric + Manual) per `idea/veriffica-part-1-validation-rules.md`, with English error messages. Priority: must-have
- FR-013: `Make`, `Model`, `Fuel type`, `Transmission`, `Drive`, and `Body type` are required, and Parts 2–5 unlock only after they are saved correctly. Priority: must-have

### Question engine
- FR-014: System generates a personalized question set using an additive visibility model (`Base + fuelType + transmission + drive + bodyType`) plus runtime equipment flags (`chargingPortEquipped`, `evBatteryDocsAvailable`, `turboEquipped`, `mechanicalCompressorEquipped`, `importedFromEU`), driven by stable group/question/explanation identifiers. Runtime flags are a layer separate from Part 1 config — used only where the declared configuration cannot decide group visibility (per `idea/veriffica-questions-list/list-of-questions.md`, "Normalized visibility model"); they are determined at runtime, not as Part 1 fields. Priority: must-have
- FR-015: User can answer questions in Parts 2–5 as full-screen swipeable cards (one question per screen) with `Yes`/`No`/`Don't know`, cannot advance without answering, can navigate back (gesture or `Back`) without losing answers, sees a per-Part progress indicator (current / total), and sees a transition screen with `OK` after each Part returning to the session screen. Priority: must-have
  > Socrates: Counter-argument considered: "forced answering pushes users to spam `Don't know` or abandon, hurting the ≥75% completion target." Resolution: kept hard gating — `Don't know` is a legitimate answer and the built-in escape valve, so no one is truly stuck; mandatory answers guarantee complete checklist data, which is the point.
- FR-016: When the user changes a visibility-affecting field (`fuelType`, `transmission`, `drive`, `bodyType`, or an active runtime flag), the system warns the user, keeps still-valid answers, removes orphaned answers, and immediately recomputes progress and Total Score (Smart Pruning). Priority: must-have
  > Socrates: Counter-argument considered: "partial-answer reconciliation is subtle, bug-prone logic for a rare edge case; locking config or wiping answers would be simpler." Resolution: kept full Smart Pruning — users do mis-enter config and must be able to correct it without losing all prior work; preserving still-valid answers is core UX.

### Education & notes
- FR-017: User can open an educational pop-up (via an `i` icon) on questions that have a linked explanation, showing content from the shared `explanations` dictionary. Priority: must-have
- FR-018: User can add a contextual note (500-character limit) on any question card, which is appended to the global notes document with the question text as a header. Priority: must-have

### Summary & scoring
- FR-019: User can view a Summary page with a chart per Part and a global chart, each showing only the `Yes`/`No`/`Don't know` answer distribution (equal weighting, no single quality score), plus a Total Score expressed as that distribution across the whole inspection. Priority: must-have
  > Socrates: Counter-argument considered: "a layperson wants a buy/don't-buy verdict; a flat unweighted distribution may feel like data without an answer." Resolution: kept pure distribution — severity weighting and deal-breakers imply false precision and liability the helper-tool framing must avoid; weighted scoring and deal-breakers are explicit non-goals.
- FR-020: User can edit answers inline on the Summary page (without returning to card view), with charts, progress, and Total Score updating immediately. Priority: must-have
- FR-021: User can manually finalize an inspection to `Completed` via an explicit button on the Summary page; a Completed inspection opens by default as a closed read-only report, and returning to edit requires a deliberate confirmed action that reverts it to `Draft` and requires re-finalization. Priority: must-have
  > Socrates: Counter-argument considered: "reopen friction and manual-finalize could depress the ≥75% completion metric and confuse users fixing a typo." Resolution: kept — `Completed` must mean a status the user consciously asserted, and the friction protects a final report from accidental edits.

### Settings, profile & platform
- FR-022: User can view a profile page with basic account information, and control font size and theme (dark/light) in settings (theme follows the device system setting by default until manually overridden). Priority: must-have
- FR-023: User can use the app offline after it has loaded once (PWA): all domain data (Part 1, answers, contextual notes, global notes document, status, progress, Change Queue) is stored locally on-device, offline changes enter a Change Queue and sync automatically in the background once connectivity returns using a Last-Write-Wins / Client-Wins conflict strategy, and connectivity loss never logs the user out or interrupts the inspection. Priority: must-have
  > Socrates: Counter-argument considered: "this is the single largest engineering item; an online-first 'save locally as you go' model might give 90% of the value at 20% of the cost." Resolution: kept full offline-first — used-car lots often have poor signal and the buyer must trust nothing is lost; this is a core differentiator, and the longer-timeline cost was explicitly accepted (see Timeline acknowledgment).
- FR-024: The entire interface is presented in English only. Priority: must-have
- FR-025: User can recover access to their account by resetting a forgotten password via an email recovery link. Priority: must-have

## User Stories

### US-01: Layperson runs a personalized inspection end-to-end

- **Given** a logged-in user with a verified email and fewer than 2 existing inspections
- **When** they start a new inspection, complete Part 1 with the required vehicle fields, and work through the personalized questions in Parts 2–5
- **Then** they reach the Summary page showing the `Yes`/`No`/`Don't know` distribution and can manually finalize the inspection to `Completed`

#### Acceptance Criteria
- Parts 2–5 remain locked until the six required Part 1 fields are saved and valid
- The question set shown matches the car's configuration (fuel / transmission / drive / body + any active equipment flags)
- Every question must be answered (`Yes`/`No`/`Don't know`) before advancing; back-navigation preserves prior answers
- The Total Score and completion indicator reflect only answered questions, with all questions weighted equally
- `Completed` is set only by an explicit user action on the Summary page

### US-02: Editing the car config re-shapes the checklist without losing valid answers

- **Given** an inspection with answered questions in Parts 2–5
- **When** the user changes a visibility-affecting Part 1 field (e.g. `Transmission`)
- **Then** the user is warned, still-valid answers are kept, orphaned answers are removed, and progress and Total Score are recomputed immediately

#### Acceptance Criteria
- The warning appears before answers are discarded
- Answers to questions that remain visible are never lost
- Progress and Total Score never show stale values after a config change

### US-03: Inspection survives going offline mid-visit

- **Given** a user partway through an inspection who loses network connectivity
- **When** they continue answering questions and adding notes offline, then regain connectivity
- **Then** they are never logged out or interrupted, and all offline changes sync automatically from the Change Queue

#### Acceptance Criteria
- The app remains fully usable offline after first load (PWA)
- No local state, answer, or note is lost on connectivity loss or restore
- Queued changes reconcile using Last-Write-Wins / Client-Wins on reconnect

> **Socrates round (2026-05-29):** challenge concentrated on the 6 FRs with real
> MVP-level strategic tension (FR-007, FR-015, FR-016, FR-019, FR-021, FR-023).
> All six resolved in favor of the original design — see the `> Socrates:`
> blockquotes above. The remaining FRs are settled mechanics drawn directly from
> the source notes and stand as written.
## Business Logic

Veriffica decides which inspection questions are relevant to a specific used car
by combining its declared configuration (fuel type, transmission, drive, body
type) and equipment flags into a personalized, ordered checklist, then summarizes
the buyer's answers as an equally-weighted `Yes`/`No`/`Don't know` distribution.

The rule consumes user-supplied inputs: the car's declared configuration (the six
required Part 1 fields) plus a small set of equipment exceptions (e.g. whether the
car has a turbocharger, a charging port, EV battery documentation, a mechanical
compressor). From these it produces a tailored set of
questions — drawn from a fixed catalogue and arranged in the real-world order of a
physical inspection (standstill → starting the engine → test drive → documents) —
that excludes questions irrelevant to this car. The buyer encounters the rule as a
checklist that "already knows" what to ask about *their* car, and never as a wall
of generic questions.

As the buyer answers, the rule classifies and aggregates: each answer is `Yes`,
`No`, or `Don't know`, every question counts equally (no severity weighting, no
buy/don't-buy verdict, no deal-breaker disqualification), and the output is a
distribution shown per Part and across the whole inspection. When the car's
configuration changes, the relevant-question set is recomputed: still-valid answers
are kept, answers to now-irrelevant questions are dropped, and the distribution is
re-derived (Smart Pruning).

> The deliberate absence of weighting, a single quality score, and deal-breaker
> logic is what keeps Veriffica an honest *helper tool* rather than an authority
> that implies false precision — and it bounds liability. Weighted scoring and
> deal-breakers are explicit non-goals.

## Non-Functional Requirements

- A buyer sees score, progress, and chart updates as immediate (< 200 ms perceived)
  after answering a question or editing an answer inline — no perceptible recompute lag.
- After its first successful load, the app remains fully usable with no network
  connection, and no domain data (Part 1, answers, contextual notes, global notes
  document, status, progress) is lost across any offline → online transition.
- A user's inspection data is never observable by any other account or by an
  unauthenticated visitor.
- Text remains legible at the user's chosen font size and in both light and dark
  themes, on the current major versions of mainstream mobile and desktop browsers.

## Open Questions

No outstanding open questions — both items surfaced during shaping were resolved.

**Resolved during shaping (2026-05-29):**

1. **How are runtime equipment flags captured?** — Resolved: runtime flags are a
   layer separate from Part 1 config, used only where the declared configuration
   cannot decide group visibility (per `idea/veriffica-questions-list/list-of-questions.md`,
   "Normalized visibility model"). They are determined at runtime, not as Part 1
   fields. The exact UI affordance (inline gating question vs. toggle) is a
   question-engine design detail captured for downstream resolution; the layer
   separation itself is settled (see FR-014).
2. **Is password reset / account recovery in v1 scope?** — Resolved: yes, included
   in v1 as FR-025 (email recovery link). Low marginal cost since email-sending
   infrastructure already exists for verification, and it avoids permanent lockout.

## Non-Goals

**Functional non-goals (from source notes):**
- No interface languages other than English — single-language UI keeps copy and the question catalogue tractable.
- No photo system — no taking, uploading, or galleries of inspection photos.
- No export or sharing — no PDF generation, no sending reports to others by link.
- No external verification — no VIN-based vehicle-history lookup.
- No native apps — MVP ships only as a PWA in the browser (no App Store / Google Play).
- No social login (Google/Apple) — email + password only for v1.
- No comparator — no side-by-side view of two or more reports on one screen.
- No "deal-breaker" system — no automatic disqualification of a car on detecting a critical safety fault.
- No fault weighting / weighted scoring — all questions are weighted equally (see Business Logic).
- No advanced error monitoring in the first MVP phase.

**Additional scope avoids (locked this session):**
- No payments or subscriptions — v1 has no billing or paywall; the 2-inspection cap is a demand signal, not a monetized limit.
- No negotiation or pricing advice — Veriffica structures the inspection only; it never advises on fair price or whether to buy.
- No multi-device sync guarantee — offline-first sync covers a single device reconciling with the server; seamless real-time experience across multiple devices is not promised for v1.
- No in-app support / help desk — no live chat or ticketing; user help is limited to the static startup instruction and educational pop-ups.

## Quality cross-check

Run 2026-05-29. Result: **accepted** — all greenfield gate elements present.

- Access Control: present (flat owner-only; email + password + verification).
- Business Logic: present (one-sentence rule — config → personalized checklist → equal-weight Yes/No/Don't-know distribution).
- Project artifacts: present (this file, valid checkpoint).
- Timeline-cost acknowledged: present (MVP-too-big surfaced; user accepted the longer-timeline cost — see Timeline acknowledgment).
- Non-Goals: present (10 source non-goals + 4 added this session).
- Preserved behavior: n/a (greenfield).

No gaps to mirror into `/10x-prd`'s Open Questions; both prior open questions were resolved during shaping.

## Forward: technical-roadmap

Captured for downstream chain steps (tech-stack-selection / planning) — NOT part of
the PRD schema:

- **v2 candidates explicitly deferred during MVP scoping:** none deferred — the user
  committed to the full spec for v1, including Offline-First. The scope-down moves
  offered (online-first, lock-config, simplified question UI, trimmed Part 1) were
  declined in favor of the full build.
- **Source-of-truth data artifacts** (stack-agnostic, ready for implementation):
  `idea/veriffica-questions-list/list-of-questions.md`, `question-bank.json`,
  `question-mapping-config.json`, and the two JSON schemas
  (`question-bank.schema.json`, `question-mapping-config.schema.json`);
  `idea/veriffica-instruction.md`; `idea/veriffica-part-1-validation-rules.md`.
  The question data model is intentionally three-layered (`questionGroups` /
  `questions` / `explanations`) with stable IDs and an `order` field that increments
  by 10 to allow later insertion without renumbering.
