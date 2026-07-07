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
// Phase 2 scope: charts + editable notes + READ-ONLY modal. Inline answer editing is Phase 3;
// finalize/reopen + read-only-report enforcement is Phase 4.
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
const FIELD_INPUT = "border-input bg-background text-foreground placeholder:text-muted-foreground";

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
    setOpenPart(part);
  }

  return (
    <div className="space-y-8">
      <header>
        <a
          href={`/inspections/${inspection.id}/session`}
          className="text-primary hover:text-primary/80 -ml-2 inline-flex items-center rounded-md px-2 py-1.5 text-sm transition-colors hover:underline"
        >
          &larr; Back to session
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
            aria-invalid={overLimit ? true : undefined}
            placeholder="Notes about the whole inspection…"
            className={`focus-visible:ring-ring/50 flex w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] ${FIELD_INPUT}`}
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

      {/* Per-Part read-only question/answer modal (Phase 2). Controlled open via `openPart`. */}
      <Dialog
        open={openPart !== null}
        onOpenChange={(open) => {
          if (!open) setOpenPart(null);
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
                  Your answers, colored by whether they&apos;re good or bad for this car.
                </DialogDescription>
              </DialogHeader>

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
                                <li key={card.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                                  <div className="min-w-0">
                                    {card.subsection && (
                                      <p className="text-muted-foreground text-xs tracking-wider uppercase">
                                        {card.subsection}
                                      </p>
                                    )}
                                    <p className="text-foreground text-sm">{card.label}</p>
                                  </div>
                                  <span className={`shrink-0 text-sm font-medium ${SENTIMENT_TEXT[sentiment]}`}>
                                    {answer ? ANSWER_LABEL[answer] : "Not answered"}
                                  </span>
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
