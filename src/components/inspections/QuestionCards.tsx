// The Parts 2–5 answering surface (S-05, FR-015): a full-screen card deck, one question
// per screen, with mandatory answering, lossless Back, a per-Part progress indicator, and
// an end-of-Part transition screen. Each card also carries the FR-017 education `i`-popup
// (shown only when the card has a resolved `explanation`) and the FR-018 contextual note
// (≤500 chars, stored as a headed block in the global-notes document via `upsertNoteBlock`).
//
// MUST be mounted `client:only="react"` — it imports @/lib/sync → @/lib/db (Dexie), which
// has no global on the workerd SSR runtime. The SSR route runs the 80 KB catalogue
// server-side and passes ONLY the filtered card payload + the initial answers map in as
// props; the bank never reaches the browser (mirrors SessionScreen / Part1Form).
//
// Persistence rides the existing optimistic path: tapping an answer does a sparse
// `saveInspection({ id, answers })` (read-merge preserves every other column) then
// `flushQueue`. Each answer is persisted BEFORE the deck advances, which is what makes
// Back lossless and a mid-Part reload resume correctly.
import { useEffect, useState } from "react";
import { CircleAlert, Info, NotebookPen } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { db } from "@/lib/db";
import { saveInspection, flushQueue, startAutoSync } from "@/lib/sync";
import { back, canAdvance, initialIndex, isTransition, nextIndex } from "@/lib/card-nav";
import { readNoteBlock, upsertNoteBlock, type Answer, type AnswersMap } from "@/lib/answers";
import { MAX_CONTEXTUAL_NOTE_LENGTH, MAX_GLOBAL_NOTES_LENGTH, M } from "@/lib/part1-config";
import type { QuestionCard } from "@/lib/questions";

// Caffeine token palette — matches Part1Form / SessionScreen / the dashboard shell.
const PANEL = "border bg-card text-card-foreground";
const FIELD_INPUT = "border-input bg-background text-foreground placeholder:text-muted-foreground";

// The three legal answers (FR-015), in the order the action bar presents them. Each carries the
// accent it lights up in when selected; the value is the opaque catalogue token. The
// semantic status hues stay (green=present, red=absent, blue=unknown) but are tuned to
// read in both Caffeine light and dark modes.
const ANSWER_OPTIONS: { value: Answer; label: string; selected: string }[] = [
  {
    value: "yes",
    label: "Yes",
    selected: "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  { value: "no", label: "No", selected: "border-red-500 bg-red-500/15 text-red-700 dark:text-red-200" },
  {
    value: "dont_know",
    label: "Don't know",
    selected: "border-blue-500 bg-blue-500/15 text-blue-700 dark:text-blue-200",
  },
];

interface Props {
  // The inspection id — the answer-map's owning row + the session-screen link target.
  id: string;
  // The ordered, personalized cards for this Part (catalogue-derived server-side).
  cards: QuestionCard[];
  // The persisted answers map (SSR-read with the question-ID keys kept verbatim). Seeds the
  // resume index and the first paint before the live Dexie row hydrates.
  initialAnswers: AnswersMap;
  // The persisted global-notes document (SSR snapshot). FR-018 contextual notes are headed
  // blocks inside it; seeds the note field before the live Dexie row hydrates.
  initialGlobalNotes: string;
  // The human Part label (e.g. "Part 2 — Standstill") prefixed onto each note's block header,
  // so a note in the global doc reads with its part context (FR-018 header).
  partLabel: string;
}

export default function QuestionCards({ id, cards, initialAnswers, initialGlobalNotes, partLabel }: Props) {
  const sessionHref = `/inspections/${id}/session`;
  const orderedIds = cards.map((c) => c.id);
  const length = orderedIds.length;

  const [saveError, setSaveError] = useState(false);

  // The answers come from the live Dexie row — the offline-first source of truth: it
  // includes unsynced offline writes the SSR `initialAnswers` snapshot lacks (and reflects
  // an offline answer without a server round-trip, the SessionScreen live-row pattern) —
  // falling back to the SSR map only until the row hydrates. The jsonb `answers` keeps its
  // `q_…` keys verbatim (the sync boundary excludes it from deep key-casing), so it indexes
  // by card id directly.
  const liveRow = useLiveQuery(() => db.inspections.get(id), [id]);
  const answers = (liveRow?.answers as AnswersMap | undefined) ?? initialAnswers;

  // The global-notes document (FR-010) — same live-row-with-SSR-fallback pattern as the
  // answers map, so an offline note reflects without a server round-trip. FR-018 stores each
  // card's contextual note as a headed block inside it (keyed by the card's note header).
  const globalNotes = liveRow?.globalNotes ?? initialGlobalNotes;

  // The contextual-note editor is a modal: `noteDraft` is null while closed, and the card's
  // existing block (parsed back from the document) once opened — so editing replaces in place
  // rather than duplicating. `noteSaveError` surfaces a failed local write inline.
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [noteSaveError, setNoteSaveError] = useState(false);
  // Set when this question's note would push the global-notes document past its 10,000-char
  // cap. The sync-boundary guard rejects an over-limit doc with a deterministic 400, which
  // `flushQueue` would park at the head of the FIFO outbox — blocking every later answer from
  // syncing on this device. So we block the save here, mirroring SessionScreen's overLimit gate.
  const [noteDocOverLimit, setNoteDocOverLimit] = useState(false);

  // The current card index. `navIndex` is null until the user navigates; until then the
  // index is DERIVED as the resume position from the freshest answers — so it "upgrades"
  // from the SSR snapshot to the live Dexie row once it hydrates. This is the offline-refresh
  // fix: a reload while offline resumes at the right card, honoring the answers that only
  // exist locally (not yet synced). The first answer / Back / Next locks `navIndex`, so the
  // live row finishing its load can never yank the user off a card they navigated to.
  const [navIndex, setNavIndex] = useState<number | null>(null);
  const index = navIndex ?? initialIndex(orderedIds, answers);

  // Slide direction for the card transition (#3): a forward move (answer / Next) slides the
  // new card in from the right, a Back from the left. Set alongside each navigation so the
  // keyed wrapper below replays the matching enter animation.
  const [direction, setDirection] = useState<"next" | "prev">("next");

  // Drain the outbox for this session (same resilient triggers as SessionScreen / Part1Form).
  useEffect(() => startAutoSync(), []);

  // Trap one history entry on mount so the OS/browser Back button (and back gesture) is
  // intercepted by `popstate` below instead of leaving the page on the first press.
  useEffect(() => {
    window.history.pushState({ veriffica: "card-deck" }, "");
  }, []);

  // Map Back (browser/OS or the in-card control, which calls `history.back()`) to one card
  // step. `back(index)` is the single rule: decrement, or exit to the session screen from
  // the first card. Re-arm the trap consumed by this Back so the next press is intercepted
  // too. The effect re-binds per `index` so the handler always reads the current card.
  useEffect(() => {
    const onPop = () => {
      const result = back(index);
      if (result.type === "exit") {
        window.location.assign(sessionHref);
        return;
      }
      window.history.pushState({ veriffica: "card-deck" }, "");
      setDirection("prev");
      setNavIndex(result.index);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, [index, sessionHref]);

  // Tap an answer: persist the whole map through the read-merge optimistic path, and only
  // advance once the local write resolves (so the answer is durable before Back can revisit
  // the card). A Dexie failure surfaces inline and does NOT advance — nothing was saved.
  function handleAnswer(answer: Answer) {
    const card = cards[index];
    const nextMap: AnswersMap = { ...answers, [card.id]: answer };
    setSaveError(false);
    void saveInspection({ id, answers: nextMap }).then(
      () => {
        setDirection("next");
        setNavIndex(nextIndex(index, length));
        void flushQueue();
      },
      () => {
        setSaveError(true);
      },
    );
  }

  // Explicit Next — only reachable when the current card is already answered (the gate is
  // `canAdvance`); used to move forward off a Back-visited card without re-answering.
  function handleNext() {
    setDirection("next");
    setNavIndex(nextIndex(index, length));
  }

  // In-card Back routes through the History API so it shares the `popstate` path with the
  // browser/OS Back (uniform behavior, including the first-card exit to the session screen).
  function handleBack() {
    window.history.back();
  }

  // Open the note editor for the current card, pre-filled from its existing block (or empty).
  function openNote(header: string) {
    setNoteSaveError(false);
    setNoteDocOverLimit(false);
    setNoteDraft(readNoteBlock(globalNotes, header) ?? "");
  }

  // Persist the note as a headed block in the global-notes document (FR-018). `upsertNoteBlock`
  // replaces this question's block in place — or removes it when the draft is empty — so
  // re-noting never duplicates. Rides the same read-merge optimistic path as answers.
  function saveNote(header: string) {
    if (noteDraft === null) return;
    const nextNotes = upsertNoteBlock(globalNotes, header, noteDraft);
    // Never enqueue a document the server guard will reject — an over-limit doc would deadlock
    // the outbox at its head, stalling later answers. Mirror SessionScreen's overLimit gate.
    if (nextNotes.length > MAX_GLOBAL_NOTES_LENGTH) {
      setNoteDocOverLimit(true);
      return;
    }
    setNoteDocOverLimit(false);
    setNoteSaveError(false);
    void saveInspection({ id, globalNotes: nextNotes }).then(
      () => {
        setNoteDraft(null);
        void flushQueue();
      },
      () => {
        setNoteSaveError(true);
      },
    );
  }

  // End-of-Part transition screen (FR-015): reached by advancing past the final card (or
  // resuming a fully-answered Part). `OK` returns to the session hub.
  if (isTransition(index, length)) {
    return (
      <div className={`flex flex-col items-center gap-6 rounded-xl border p-10 text-center ${PANEL}`}>
        <div>
          <h2 className="text-foreground text-xl font-semibold">Part complete</h2>
          <p className="text-muted-foreground mt-2">
            {length === 0
              ? "No questions apply to this car for this part."
              : "You've answered every question in this part."}
          </p>
        </div>
        <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
          <a href={sessionHref}>OK</a>
        </Button>
      </div>
    );
  }

  const card = cards[index];
  const selected = answers[card.id];
  // The block header keying this card's note in the global doc: the Part label + the card's
  // composed question header (e.g. "Part 2 — Standstill: Front suspension — cracked rubber parts").
  const noteHeader = `${partLabel}: ${card.header}`;
  // Whether this card already has a contextual note — drives the note button's filled state.
  const hasNote = readNoteBlock(globalNotes, noteHeader) !== null;
  // The note draft sits at the 500-char cap (`maxLength` blocks overflow; this just warns).
  const atNoteCap = (noteDraft ?? "").length >= MAX_CONTEXTUAL_NOTE_LENGTH;

  return (
    // overflow-x-hidden masks the keyed card's slide-in translateX (~2rem) so it
    // can't reveal the canvas at the right edge or induce horizontal page scroll
    // (#3). Clip sits on this stable, non-sliding deck root — not the keyed div.
    // pb-40 reserves space for the fixed bottom action bar (Phase 4) so the last
    // content and the save-error message are never hidden behind it.
    <div className="space-y-6 overflow-x-hidden pb-40">
      {/* Per-Part progress: current card / total (FR-015). Back moved into the fixed
          action bar below (row order: Back · Add note · Next). */}
      <div className="text-muted-foreground text-sm">
        Question {index + 1} of {length}
      </div>

      {/* Keyed on `index` so each card change replays the enter animation — a slide from the
          right on a forward move, from the left on Back (#3). The catalogue stays server-side. */}
      <div
        key={index}
        className={`animate-in fade-in space-y-6 duration-500 ${
          direction === "next" ? "slide-in-from-right-8" : "slide-in-from-left-8"
        }`}
      >
        <Card className={PANEL}>
          <CardContent className="flex items-start justify-between gap-3 p-6">
            <div className="space-y-2">
              {/* Section (bold) above subsection, on separate lines — the inspection hierarchy. */}
              <p className="text-muted-foreground text-xs font-bold tracking-wider uppercase">{card.section}</p>
              {card.subsection && (
                <p className="text-muted-foreground text-xs tracking-wider uppercase">{card.subsection}</p>
              )}
              <p className="text-foreground text-lg font-medium">{card.label}</p>
            </div>

            {/* FR-017 education popup: shown ONLY when the card carries a resolved explanation
                (server-resolved; the 80 KB catalogue never reaches the client). */}
            {card.explanation !== null && (
              <Dialog>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    aria-label="Why this matters"
                    className="text-muted-foreground hover:bg-accent hover:text-foreground shrink-0 rounded-full p-1 transition-colors"
                  >
                    <Info className="size-5" />
                  </button>
                </DialogTrigger>
                <DialogContent className={`${PANEL} py-9`}>
                  <DialogHeader>
                    <DialogTitle className="text-foreground">{card.label}</DialogTitle>
                    <DialogDescription className="text-muted-foreground whitespace-pre-line">
                      {card.explanation}
                    </DialogDescription>
                  </DialogHeader>
                </DialogContent>
              </Dialog>
            )}
          </CardContent>
        </Card>
      </div>

      {saveError && (
        <p className="text-destructive flex items-center gap-1 text-sm">
          <CircleAlert className="size-4 shrink-0" />
          Could not save on this device. Please try again.
        </p>
      )}

      {/* Fixed bottom action bar (Phase 4): the answer controls are pinned to the viewport
          bottom so they stay reachable regardless of content height. `inset-x-0` spans the
          viewport (position: fixed is viewport-relative); the inner `mx-auto max-w-3xl` wrapper
          re-aligns the controls to the page's content column. The bar sits OUTSIDE the keyed,
          sliding card, so it holds still while cards animate. Two stacked rows, top→bottom:
          (Add note · Next), then (Yes · No · Don't know). The `pb-40` on the deck root above
          reserves scroll space so nothing hides behind it.

          Row 1 — the FR-018 contextual-note affordance (left) and the Next gate (right): Next
          appears only once the current card is answered (the mandatory-answer gate). Tapping an
          answer auto-advances; Next is for moving forward off a Back-visited, already-answered
          card. Row 2 — the three legal answers (FR-015). */}
      <div className="bg-background fixed inset-x-0 bottom-0 border-t shadow-lg">
        <div
          className="mx-auto max-w-3xl space-y-3 px-4 pt-3 sm:px-8"
          // Pad past the iOS home indicator so the answer row clears the safe area (the
          // page's `safe-area` wrapper can't reach a viewport-fixed element).
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
        >
          {/* Three equal columns so Add note stays dead-center whether or not Next is
              rendered (Next is gated out on an unanswered card). Back pins left, Next
              pins right; a flex/justify-between row would let Add note drift when Next
              is absent. Row order left→right: Back · Add note · Next. */}
          <div className="grid grid-cols-3 items-center gap-2">
            <button
              type="button"
              onClick={handleBack}
              className="border-border bg-muted text-foreground hover:bg-accent focus-visible:ring-ring/50 flex items-center gap-1.5 justify-self-start rounded-lg border px-3 py-2 text-sm shadow-xs transition-all outline-none focus-visible:ring-[3px]"
            >
              <span aria-hidden="true">&larr;</span>
              Back
            </button>

            <button
              type="button"
              onClick={() => {
                openNote(noteHeader);
              }}
              className={`focus-visible:ring-ring/50 flex items-center gap-1.5 justify-self-center rounded-lg border px-3 py-2 text-sm shadow-xs transition-all outline-none focus-visible:ring-[3px] ${
                hasNote
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-muted text-foreground hover:bg-accent"
              }`}
            >
              <NotebookPen className="size-4 shrink-0" />
              {hasNote ? "Edit note" : "Add note"}
            </button>

            <div className="justify-self-end">
              {canAdvance(index, orderedIds, answers) && (
                <Button onClick={handleNext} className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Next &rarr;
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {ANSWER_OPTIONS.map((opt) => {
              const isSelected = selected === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    handleAnswer(opt.value);
                  }}
                  aria-pressed={isSelected}
                  className={`focus-visible:ring-ring/50 rounded-lg border px-2 py-3 text-center font-medium shadow-xs transition-all outline-none focus-visible:ring-[3px] sm:px-4 ${
                    isSelected ? `${opt.selected} shadow-sm` : "border-border bg-muted text-foreground hover:bg-accent"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* FR-018 note editor: a 500-char contextual note saved as a headed block in the global
          notes document (replacing this question's prior block). Controlled open via `noteDraft`. */}
      <Dialog
        open={noteDraft !== null}
        onOpenChange={(open) => {
          if (!open) setNoteDraft(null);
        }}
      >
        <DialogContent className={PANEL}>
          <DialogHeader>
            <DialogTitle className="text-foreground">Note</DialogTitle>
            <DialogDescription className="text-muted-foreground">{card.header}</DialogDescription>
          </DialogHeader>

          <textarea
            value={noteDraft ?? ""}
            onChange={(e) => {
              setNoteDraft(e.target.value);
            }}
            rows={5}
            maxLength={MAX_CONTEXTUAL_NOTE_LENGTH}
            placeholder="What did you notice about this?"
            className={`focus-visible:ring-ring/50 flex w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] ${FIELD_INPUT}`}
          />
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            {noteDocOverLimit ? (
              <span className="text-destructive flex items-center gap-1">
                <CircleAlert className="size-3 shrink-0" />
                {M.globalNotes}
              </span>
            ) : noteSaveError ? (
              <span className="text-destructive flex items-center gap-1">
                <CircleAlert className="size-3 shrink-0" />
                Could not save on this device.
              </span>
            ) : atNoteCap ? (
              <span className="text-amber-600 dark:text-amber-400">{M.contextualNote}</span>
            ) : (
              <span />
            )}
            <span className={atNoteCap ? "text-amber-600 dark:text-amber-400" : undefined}>
              {(noteDraft ?? "").length} / {MAX_CONTEXTUAL_NOTE_LENGTH}
            </span>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNoteDraft(null);
              }}
              className="hover:bg-accent hover:text-accent-foreground border bg-transparent"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                saveNote(noteHeader);
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Save note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
