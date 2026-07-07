// The Summary island (S-06, FR-019/FR-020/FR-021) — the north-star report surface. Renders,
// top-to-bottom: the global Positive/Negative/Don't-know SENTIMENT distribution, a per-Part
// distribution for each of Parts 2–5 (each tappable to open its question/answer modal), and the
// editable 10,000-char global-notes document. Tapping a Part opens a read-only modal listing that
// Part's questions grouped by section (collapsible), each answer colored by SENTIMENT — so a
// clean car (all "No" in Parts 2–4) reads emerald, not alarming red (see the polarity lesson).
//
// MUST be mounted `client:only="react"` — it imports @/lib/sync → @/lib/db (Dexie), which has no
// global on the workerd SSR runtime. The SSR route (`summary.astro`) runs the 80 KB catalogue
// server-side and passes ONLY the per-Part count/ID payloads + the ordered per-Part card metadata
// ({ id, label, section, subsection }) + the answers map; the bank never reaches the browser.
//
// Everything live derives from the Dexie row (with the SSR props as fallback until it hydrates),
// exactly like SessionScreen — so an offline answer/notes edit reflects without a round-trip.
// The FR-021 lifecycle: Finalize writes `status: 'completed'` (optimistic) and the whole report
// flips read-only off the LIVE status (notes locked, no modal Edit, no Finalize); Reopen — behind
// a confirm — writes `status: 'draft'` and re-enables editing. No reload: `readOnly` is derived
// from the live Dexie row, so the mode flips the instant the local write lands, offline included.
import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Lock, RotateCcw } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { db } from "@/lib/db";
import { saveInspection, flushQueue, startAutoSync } from "@/lib/sync";
import {
  countsForFlags,
  questionIdsForFlags,
  totalCount,
  type SessionCounts,
  type SessionQuestionIds,
} from "@/lib/session-counts";
import { MAX_GLOBAL_NOTES_LENGTH, M } from "@/lib/part1-config";
import {
  answerSentiment,
  positiveAnswer,
  sentimentDistribution,
  sumSentiments,
  type Answer,
  type AnswerSentiment,
  type AnswersMap,
} from "@/lib/answers";
import DistributionBar from "@/components/inspections/DistributionBar";
import type { PartId, RelevantToggle, RuntimeFlag } from "@/lib/questions";

// The scored Parts (2–5) in physical-inspection order — Part 1 is config, not answered.
const SCORED_PARTS: PartId[] = ["part2", "part3", "part4", "part5"];

// Part display metadata (PRD's five parts, prd.md:56, physical order). Part numbers only for
// the 2–5 range this screen summarizes.
const PART_TITLES: Record<PartId, string> = {
  part2: "Standstill",
  part3: "Engine",
  part4: "Drive",
  part5: "Documents",
};
const PART_NUMBERS: Record<PartId, number> = { part2: 2, part3: 3, part4: 4, part5: 5 };

// Caffeine token palette — matches SessionScreen / the dashboard shell.
const PANEL = "border bg-card text-card-foreground";
const DIALOG_PANEL = "border bg-popover text-popover-foreground";
const FIELD_INPUT = "border-input bg-background text-foreground placeholder:text-muted-foreground";

// Lifecycle action buttons (Finalize / Reopen) — the SessionScreen "View Summary" anchor tokens.
const PRIMARY_BTN =
  "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium shadow-xs transition-colors outline-none focus-visible:ring-[3px]";
const OUTLINE_BTN =
  "border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium shadow-xs transition-colors outline-none focus-visible:ring-[3px]";

const MAX_NOTES = MAX_GLOBAL_NOTES_LENGTH;
const NOTES_TOO_LONG = M.globalNotes;
const SAVE_DEBOUNCE_MS = 600;

// The per-answer sentiment → { text hue, literal label } used by the modal rows. The literal
// Yes/No is shown (FR-020) but colored by sentiment: a Part-2 "No" is emerald, a Part-5 "No" red.
const SENTIMENT_TEXT: Record<AnswerSentiment, string> = {
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-400",
  unknown: "text-blue-600 dark:text-blue-400",
  unanswered: "text-muted-foreground",
};
const ANSWER_LABEL: Record<string, string> = { yes: "Yes", no: "No", dont_know: "Don't know" };

// The three legal answers as an inline-edit segmented control (FR-020) — the SAME styling tokens
// as the card deck's action bar (QuestionCards.tsx:45), so a retoggle here reads identically to
// answering on a card. Presentational-only; the value is the opaque catalogue token.
const EDIT_OPTIONS: { value: Answer; label: string; selected: string }[] = [
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

/** The per-Part ordered question metadata the route passes in (catalogue-derived server-side). */
export interface SummaryCard {
  id: string;
  label: string;
  section: string;
  subsection: string | null;
}

interface SummaryInspection {
  id: string;
  name: string | null;
  status: string;
  globalNotes: string | null;
  chargingPortEquipped: boolean | null;
  evBatteryDocsAvailable: boolean | null;
  turboEquipped: boolean | null;
  mechanicalCompressorEquipped: boolean | null;
  importedFromEu: boolean | null;
}

interface Props {
  inspection: SummaryInspection;
  // The catalogue-derived count + ID payloads (base + per-relevant-flag deltas), same as
  // SessionScreen — the island recomputes live counts/IDs from these for the persisted flag set.
  counts: SessionCounts;
  questionIds: SessionQuestionIds;
  // The persisted answers map (SSR snapshot); the live Dexie row takes over once it hydrates.
  initialAnswers: AnswersMap;
  // The relevant flags' column↔flag bindings, so the island reads the persisted flag columns
  // off the live row to recompute personalized counts (the catalogue never reaches here).
  flagBindings: RelevantToggle[];
  // The ordered per-Part question metadata for the modal (grouped by section at render).
  cards: Record<PartId, SummaryCard[]>;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Group a Part's ordered cards by `section`, preserving first-seen (catalogue) order. */
function groupBySection(cards: SummaryCard[]): { section: string; cards: SummaryCard[] }[] {
  const groups: { section: string; cards: SummaryCard[] }[] = [];
  const bySection = new Map<string, SummaryCard[]>();
  for (const card of cards) {
    let bucket = bySection.get(card.section);
    if (!bucket) {
      bucket = [];
      bySection.set(card.section, bucket);
      groups.push({ section: card.section, cards: bucket });
    }
    bucket.push(card);
  }
  return groups;
}

export default function SummaryScreen({ inspection, counts, questionIds, initialAnswers, flagBindings, cards }: Props) {
  // Notes editor — the SessionScreen debounced-persist pattern verbatim (single shared live row,
  // so editing notes here reflects on the session hub and vice versa).
  const [draft, setDraft] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // Which Part's modal is open (null = closed), and which sections are collapsed within it.
  const [openPart, setOpenPart] = useState<PartId | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Inline-edit state (FR-020), local to the modal: `editMode` reveals the per-question toggles;
  // `answerSaveError` surfaces a failed local write inline (mirrors QuestionCards' `saveError`).
  // Both reset to false on open/close (transient — the modal always reopens read-only).
  const [editMode, setEditMode] = useState(false);
  const [answerSaveError, setAnswerSaveError] = useState(false);

  // Finalize/reopen state (FR-021): `confirmReopen` gates the destructive-style confirm dialog;
  // `lifecycleError` surfaces a failed optimistic status write inline (mirrors the answer path).
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [lifecycleError, setLifecycleError] = useState(false);

  useEffect(() => startAutoSync(), []);

  const liveRow = useLiveQuery(() => db.inspections.get(inspection.id), [inspection.id]);
  const persisted = liveRow?.globalNotes ?? inspection.globalNotes ?? "";
  const notes = draft ?? persisted;
  const overLimit = notes.length > MAX_NOTES;

  // Debounced persist via read-merge `saveInspection` — copied from SessionScreen (all setState
  // inside the timeout, never synchronously in the effect body, per react-hooks/set-state-in-effect).
  useEffect(() => {
    if (draft === null || overLimit) return;
    const timer = setTimeout(() => {
      setSaveStatus("saving");
      void saveInspection({ id: inspection.id, globalNotes: draft }).then(
        () => {
          setSaveStatus("saved");
          void flushQueue();
        },
        () => {
          setSaveStatus("error");
        },
      );
    }, SAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft, overLimit, inspection.id]);

  // The active-flag set DERIVED from the persisted flag columns (live row, SSR fallback), so a
  // flag set in Part 1 — even offline — reflects here without a round-trip (SessionScreen pattern).
  const flagRow = liveRow ?? inspection;
  const activeFlags = new Set<RuntimeFlag>();
  for (const t of flagBindings) if (flagRow[t.column]) activeFlags.add(t.flag);

  // The inspection lifecycle status, live (SSR fallback). `readOnly` is the single flag gating the
  // whole report: a Completed inspection locks the notes, hides the modal Edit button, and swaps
  // Finalize for Reopen. Derived from the live row so an optimistic finalize/reopen flips the mode
  // with no reload — and survives an offline reload (the status rides the same Dexie row). (FR-021.)
  const liveStatus = liveRow?.status ?? inspection.status;
  const readOnly = liveStatus === "completed";
  const isDraft = !readOnly;

  const liveCounts = countsForFlags(counts, activeFlags);
  const totalVisible = totalCount(liveCounts);

  // Live answers + per-Part visible IDs; intersecting with the visible set so an orphaned answer
  // (a now-hidden question, pre-S-07) is never counted (FR-019). jsonb keys stay verbatim.
  const answers = (liveRow?.answers as AnswersMap | undefined) ?? initialAnswers;
  const liveIds = questionIdsForFlags(questionIds, activeFlags);

  // Per-Part SENTIMENT (each Part's polarity applies) and the global sum (the Total Score chart).
  const perPart = (part: PartId) => sentimentDistribution(liveIds[part], answers, positiveAnswer(part));
  const globalSentiment = sumSentiments(SCORED_PARTS.map(perPart));

  function toggleSection(section: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  function openModal(part: PartId) {
    setCollapsed(new Set()); // reset to all-expanded each open (closing resets transient state)
    setEditMode(false); // the modal always reopens read-only (FR-020)
    setAnswerSaveError(false);
    setOpenPart(part);
  }

  // Inline answer edit (FR-020): write the whole map through the read-merge optimistic path then
  // flush — identical to QuestionCards.handleAnswer (QuestionCards.tsx:154). Because `answers`
  // derives from the live Dexie row, every chart recomputes the instant the local write lands.
  // Re-tapping the current answer is a no-op (there is no "unanswer" in the domain). A local write
  // failure surfaces inline and drops nothing.
  function handleEditAnswer(cardId: string, value: Answer) {
    if (answers[cardId] === value) return;
    setAnswerSaveError(false);
    void saveInspection({ id: inspection.id, answers: { ...answers, [cardId]: value } }).then(
      () => {
        void flushQueue();
      },
      () => {
        setAnswerSaveError(true);
      },
    );
  }

  // Finalize / reopen (FR-021) — optimistic status writes on the proven `saveInspection` path
  // (`SaveInput.status`, sync.ts:93), identical in shape to the answer write. No confirm on
  // finalize (it is reversible via Reopen); Reopen is confirmed below. A local write failure
  // surfaces inline via `lifecycleError`.

  // Finalize (Draft → Completed): persist the status optimistically, then return to the dashboard —
  // where the finalized inspection lives as a Completed report, reopened by tapping it (→ read-only
  // /summary). The redirect waits until the outbox has actually DRAINED, for two reasons: the
  // dashboard is a static SSR render, so it only shows this row under Completed once the write is
  // server-side; and `/dashboard` is not in the SW cache, so navigating there OFFLINE would hit the
  // browser's error page. So: offline (or not-yet-drained) we stay on /summary, which has already
  // flipped read-only in place (`readOnly` derives from the live row) — the optimistic state that
  // reconciles + becomes reachable from the dashboard on reconnect.
  function finalize() {
    setLifecycleError(false);
    void saveInspection({ id: inspection.id, status: "completed" }).then(
      () => {
        void redirectWhenSynced();
      },
      () => {
        setLifecycleError(true);
      },
    );
  }

  // Drain the outbox, then redirect to the dashboard only once it is empty (the finalize synced).
  // Polls briefly to ride out a concurrent autosync drain that made our `flushQueue` a no-op behind
  // its in-flight guard; bails the instant we detect we're offline (stay on the read-only report).
  async function redirectWhenSynced() {
    for (let i = 0; i < 10; i++) {
      await flushQueue();
      if ((await db.changeQueue.count()) === 0) {
        window.location.assign("/dashboard");
        return;
      }
      if (!navigator.onLine) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  // Reopen (Completed → Draft): persist in place — `readOnly` derives from the live row, so the
  // report re-enables editing the instant the local put lands, without leaving the page.
  function reopen() {
    setLifecycleError(false);
    void saveInspection({ id: inspection.id, status: "draft" }).then(
      () => {
        void flushQueue();
      },
      () => {
        setLifecycleError(true);
      },
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <a
          href={readOnly ? "/dashboard" : `/inspections/${inspection.id}/session`}
          className="text-primary hover:text-primary/80 -ml-2 inline-flex items-center rounded-md px-2 py-1.5 text-sm transition-colors hover:underline"
        >
          &larr; {readOnly ? "Back to dashboard" : "Back to session"}
        </a>
        <h1 className="text-foreground mt-4 text-2xl font-bold">{inspection.name ?? "Inspection"} — Summary</h1>
        <p className="text-muted-foreground mt-1">
          The Positive / Negative / Don&apos;t-know distribution for this car — overall and per part. Tap a part to
          review its answers.
        </p>
      </header>

      {/* Global Total Score — the summed per-Part sentiment across Parts 2–5 (FR-019, no quality %). */}
      <Card className={PANEL}>
        <CardHeader>
          <CardTitle className="text-foreground">Total Score</CardTitle>
        </CardHeader>
        <CardContent>
          <DistributionBar
            positive={globalSentiment.positive}
            negative={globalSentiment.negative}
            unknown={globalSentiment.unknown}
            total={totalVisible}
          />
        </CardContent>
      </Card>

      {/* Per-Part charts — each tappable to open its read-only question/answer modal. */}
      <section className="space-y-3">
        <h2 className="text-foreground text-lg font-semibold">By part</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {SCORED_PARTS.map((part) => {
            const s = perPart(part);
            return (
              <button
                key={part}
                type="button"
                onClick={() => {
                  openModal(part);
                }}
                className="border-border bg-card hover:bg-accent focus-visible:ring-ring/50 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-[3px]"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-muted-foreground text-xs tracking-wider uppercase">Part {PART_NUMBERS[part]}</p>
                    <p className="text-foreground font-medium">{PART_TITLES[part]}</p>
                  </div>
                  <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                </div>
                <DistributionBar
                  positive={s.positive}
                  negative={s.negative}
                  unknown={s.unknown}
                  total={liveCounts[part]}
                />
              </button>
            );
          })}
        </div>
      </section>

      {/* Editable global notes — the same shared live-row document as the session hub. */}
      <Card className={PANEL}>
        <CardHeader>
          <CardTitle className="text-foreground">Global notes</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            id="globalNotes"
            value={notes}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            rows={8}
            readOnly={readOnly}
            aria-invalid={overLimit ? true : undefined}
            placeholder={readOnly ? "No notes were recorded." : "Notes about the whole inspection…"}
            className={`focus-visible:ring-ring/50 flex w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] ${FIELD_INPUT} ${
              readOnly ? "cursor-not-allowed opacity-70" : ""
            }`}
          />
          <div className="mt-1 flex items-center justify-between text-xs">
            {overLimit ? (
              <span className="text-destructive flex items-center gap-1">
                <CircleAlert className="size-3 shrink-0" />
                {NOTES_TOO_LONG}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {saveStatus === "saving" && "Saving…"}
                {saveStatus === "saved" && "Saved."}
                {saveStatus === "error" && <span className="text-destructive">Could not save on this device.</span>}
              </span>
            )}
            <span className={overLimit ? "text-destructive" : "text-muted-foreground"}>
              {notes.length.toLocaleString()} / {MAX_NOTES.toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Finalize / Reopen lifecycle (FR-021). Draft → a Finalize button (no confirm — reversible).
          Completed → a read-only banner + a Reopen button behind the confirm dialog below. */}
      <Card className={PANEL}>
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            {readOnly && <Lock className="text-muted-foreground size-4 shrink-0" />}
            {readOnly ? "Completed report" : "Finalize inspection"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {readOnly
              ? "This inspection is finalized and read-only. Reopen it to change answers or notes."
              : "Close this inspection as a read-only report. You can reopen it later if you need to make changes."}
          </p>
          {readOnly ? (
            <button
              type="button"
              onClick={() => {
                setConfirmReopen(true);
              }}
              className={OUTLINE_BTN}
            >
              <RotateCcw className="size-4 shrink-0" />
              Reopen for editing
            </button>
          ) : (
            <button type="button" onClick={finalize} className={PRIMARY_BTN}>
              <CheckCircle2 className="size-4 shrink-0" />
              Finalize inspection
            </button>
          )}
          {lifecycleError && (
            <p className="text-destructive flex items-center gap-1 text-xs">
              <CircleAlert className="size-3 shrink-0" />
              Could not save on this device.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Reopen confirm — the destructive-style AlertDialog pattern from DashboardBoard. Confirming
          reverts to Draft, re-enabling inline editing + Finalize (re-finalization required). */}
      <AlertDialog
        open={confirmReopen}
        onOpenChange={(open) => {
          if (!open) setConfirmReopen(false);
        }}
      >
        <AlertDialogContent className={DIALOG_PANEL}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Reopen this inspection?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This returns the inspection to Draft so you can change answers and notes. You&apos;ll need to finalize it
              again to close it as a report.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={OUTLINE_BTN}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmReopen(false);
                reopen();
              }}
            >
              Reopen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Per-Part question/answer modal. Read-only by default; the Edit toggle (Draft only) reveals
          per-question answer controls (FR-020). Controlled open via `openPart`. */}
      <Dialog
        open={openPart !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOpenPart(null);
            setEditMode(false); // reopen always read-only
            setAnswerSaveError(false);
          }
        }}
      >
        <DialogContent className={`${PANEL} max-h-[85vh] overflow-y-auto`}>
          {openPart !== null && (
            <>
              <DialogHeader>
                <DialogTitle className="text-foreground">
                  Part {PART_NUMBERS[openPart]} — {PART_TITLES[openPart]}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {editMode
                    ? "Tap an answer to update it — changes save on this device instantly."
                    : "Your answers, colored by whether they're good or bad for this car."}
                </DialogDescription>
              </DialogHeader>

              {/* Edit toggle — Draft only (a Completed report is read-only, Phase 4). No Save
                  button: each toggle persists immediately via the optimistic path. */}
              {isDraft && cards[openPart].length > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEditMode((v) => !v);
                      setAnswerSaveError(false);
                    }}
                    aria-pressed={editMode}
                    className={`focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm font-medium shadow-xs transition-colors outline-none focus-visible:ring-[3px] ${
                      editMode
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-muted text-foreground hover:bg-accent"
                    }`}
                  >
                    {editMode ? "Done" : "Edit answers"}
                  </button>
                  {answerSaveError && (
                    <span className="text-destructive flex items-center gap-1 text-xs">
                      <CircleAlert className="size-3 shrink-0" />
                      Could not save on this device.
                    </span>
                  )}
                </div>
              )}

              {cards[openPart].length === 0 ? (
                <p className="text-muted-foreground text-sm">No questions apply to this car for this part.</p>
              ) : (
                <div className="space-y-3">
                  {groupBySection(cards[openPart]).map((group) => {
                    const isCollapsed = collapsed.has(group.section);
                    return (
                      <div key={group.section} className="border-border rounded-lg border">
                        <button
                          type="button"
                          onClick={() => {
                            toggleSection(group.section);
                          }}
                          aria-expanded={!isCollapsed}
                          className="hover:bg-accent flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                          ) : (
                            <ChevronDown className="text-muted-foreground size-4 shrink-0" />
                          )}
                          <span className="text-foreground text-sm font-semibold">{group.section}</span>
                          <span className="text-muted-foreground ml-auto text-xs">{group.cards.length}</span>
                        </button>

                        {!isCollapsed && (
                          <ul className="border-border divide-border divide-y border-t">
                            {group.cards.map((card) => {
                              const answer = answers[card.id];
                              const sentiment = answerSentiment(answer, positiveAnswer(openPart));
                              return (
                                <li key={card.id} className="px-3 py-2.5">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      {card.subsection && (
                                        <p className="text-muted-foreground text-xs tracking-wider uppercase">
                                          {card.subsection}
                                        </p>
                                      )}
                                      <p className="text-foreground text-sm">{card.label}</p>
                                    </div>
                                    {!editMode && (
                                      <span className={`shrink-0 text-sm font-medium ${SENTIMENT_TEXT[sentiment]}`}>
                                        {answer ? ANSWER_LABEL[answer] : "Not answered"}
                                      </span>
                                    )}
                                  </div>
                                  {editMode && (
                                    <div className="mt-2 grid grid-cols-3 gap-2">
                                      {EDIT_OPTIONS.map((opt) => {
                                        const isSelected = answer === opt.value;
                                        return (
                                          <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => {
                                              handleEditAnswer(card.id, opt.value);
                                            }}
                                            aria-pressed={isSelected}
                                            className={`focus-visible:ring-ring/50 rounded-lg border px-2 py-1.5 text-center text-sm font-medium shadow-xs transition-all outline-none focus-visible:ring-[3px] ${
                                              isSelected
                                                ? `${opt.selected} shadow-sm`
                                                : "border-border bg-muted text-foreground hover:bg-accent"
                                            }`}
                                          >
                                            {opt.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
