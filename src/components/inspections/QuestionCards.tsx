// The Parts 2–5 answering surface (S-05, FR-015): a full-screen card deck, one question
// per screen, with mandatory answering, lossless Back, a per-Part progress indicator, and
// an end-of-Part transition screen. (The FR-017 education popup and FR-018 contextual note
// land in Phase 4; the card payload already carries `explanation` for that.)
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
import { CircleAlert } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { saveInspection, flushQueue, startAutoSync } from "@/lib/sync";
import { back, canAdvance, initialIndex, isTransition, nextIndex } from "@/lib/card-nav";
import type { Answer, AnswersMap } from "@/lib/answers";
import type { QuestionCard } from "@/lib/questions";

// Cosmic glass palette — matches Part1Form / SessionScreen / the dashboard shell.
const PANEL = "border-white/10 bg-white/5 text-white backdrop-blur-xl";

// The three legal answers (FR-015), in the order the card presents them. Each carries the
// accent it lights up in when selected; the value is the opaque catalogue token.
const ANSWER_OPTIONS: { value: Answer; label: string; selected: string }[] = [
  { value: "yes", label: "Yes", selected: "border-emerald-400 bg-emerald-500/20 text-emerald-100" },
  { value: "no", label: "No", selected: "border-red-400 bg-red-500/20 text-red-100" },
  { value: "dont_know", label: "Don't know", selected: "border-blue-300 bg-blue-400/15 text-blue-100" },
];

interface Props {
  // The inspection id — the answer-map's owning row + the session-screen link target.
  id: string;
  // The ordered, personalized cards for this Part (catalogue-derived server-side).
  cards: QuestionCard[];
  // The persisted answers map (SSR-read with the question-ID keys kept verbatim). Seeds the
  // resume index and the first paint before the live Dexie row hydrates.
  initialAnswers: AnswersMap;
}

export default function QuestionCards({ id, cards, initialAnswers }: Props) {
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

  // End-of-Part transition screen (FR-015): reached by advancing past the final card (or
  // resuming a fully-answered Part). `OK` returns to the session hub.
  if (isTransition(index, length)) {
    return (
      <div className={`flex flex-col items-center gap-6 rounded-xl border p-10 text-center ${PANEL}`}>
        <div>
          <h2 className="text-xl font-semibold text-white">Part complete</h2>
          <p className="mt-2 text-blue-100/60">
            {length === 0
              ? "No questions apply to this car for this part."
              : "You've answered every question in this part."}
          </p>
        </div>
        <Button asChild className="bg-purple-600 text-white hover:bg-purple-500">
          <a href={sessionHref}>OK</a>
        </Button>
      </div>
    );
  }

  const card = cards[index];
  const selected = answers[card.id];

  return (
    <div className="space-y-6">
      {/* Per-Part progress: current card / total (FR-015). */}
      <div className="flex items-center justify-between text-sm text-blue-100/60">
        <span>
          Question {index + 1} of {length}
        </span>
        <button
          type="button"
          onClick={handleBack}
          className="text-purple-300 transition-colors hover:text-purple-100 hover:underline"
        >
          &larr; Back
        </button>
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
          <CardContent className="space-y-2 p-6">
            <p className="text-xs tracking-wider text-blue-100/40 uppercase">
              {card.subsection ? `${card.section} — ${card.subsection}` : card.section}
            </p>
            <p className="text-lg font-medium text-white">{card.label}</p>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
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
                className={`rounded-lg border px-4 py-3 text-center font-medium transition-colors ${
                  isSelected
                    ? opt.selected
                    : "border-white/15 bg-white/10 text-white hover:border-white/30 hover:bg-white/15"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {saveError && (
        <p className="flex items-center gap-1 text-sm text-red-300">
          <CircleAlert className="size-4 shrink-0" />
          Could not save on this device. Please try again.
        </p>
      )}

      {/* Next appears only once the current card is answered — the mandatory-answer gate
          (a fresh card has no forward affordance but answering). Tapping an answer
          auto-advances; Next is for moving forward off a Back-visited, already-answered card. */}
      <div className="flex justify-end">
        {canAdvance(index, orderedIds, answers) && (
          <Button onClick={handleNext} className="bg-purple-600 text-white hover:bg-purple-500">
            Next &rarr;
          </Button>
        )}
      </div>
    </div>
  );
}
