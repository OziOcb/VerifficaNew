// The session-hub island (S-04, FR-010). Renders the inspection's name, the Part 1–5
// navigation (with per-Part visible counts from the FR-014 engine), the Total Score
// distribution, the completion indicator, and the 10,000-char global-notes document.
//
// MUST be mounted `client:only="react"` — it imports @/lib/sync → @/lib/db (Dexie),
// which has no global on the workerd SSR runtime. The SSR page (`session.astro`) runs the
// visibility engine server-side and passes ONLY the per-Part counts + the inspection's
// scalar fields in as props; the 80 KB catalogue never reaches the browser.
//
// Phase 3 has no answer store yet, so the score/completion render their 0-answer state
// (US-01: they reflect only answered questions) — completion `0 of N`, an all-zero
// Yes/No/Don't-know distribution at 0%, with `totalVisible` as the denominator so the
// score/completion never drift from what the nav shows. S-05 fills the numerators; S-04
// equipment toggles (Phase 4) move the denominator.
import { useEffect, useState } from "react";
import { CircleAlert, Lock } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { answeredCount, type AnswersMap } from "@/lib/answers";
import type { PartId, RelevantToggle, RuntimeFlag } from "@/lib/questions";

// Cosmic glass palette — matches Part1Form / the dashboard shell.
const PANEL = "border-white/10 bg-white/5 text-white backdrop-blur-xl";
const FIELD_INPUT = "border-white/20 bg-white/10 text-white placeholder:text-white/40";

// FR-010: the global notes document is a distinct 10,000-char inspection-level doc
// (separate from the 1,000-char Part 1 `notes`). The cap + message now live in
// `@/lib/part1-config` so the client island and the sync-boundary server guard enforce
// the identical limit (single source of truth).
const MAX_NOTES = MAX_GLOBAL_NOTES_LENGTH;
const NOTES_TOO_LONG = M.globalNotes;

// Debounce window for persisting notes edits through the outbox.
const SAVE_DEBOUNCE_MS = 600;

interface SessionInspection {
  id: string;
  name: string | null;
  status: string;
  globalNotes: string | null;
  // The 5 equipment flags ride along for Phase 4's toggles (inert this phase).
  chargingPortEquipped: boolean | null;
  evBatteryDocsAvailable: boolean | null;
  turboEquipped: boolean | null;
  mechanicalCompressorEquipped: boolean | null;
  importedFromEu: boolean | null;
}

interface Props {
  inspection: SessionInspection;
  // Whether the Part 1 config is valid. Parts 2–5 stay locked in the nav until it is.
  unlocked: boolean;
  // The catalogue-derived count payload (base + per-relevant-flag deltas) computed
  // server-side; the island recomputes live counts from it as the persisted flags change.
  counts: SessionCounts;
  // The ID-list analogue of `counts` — the per-Part visible question IDs (base + per-flag
  // deltas), so the island can tally how many are ANSWERED per Part (FR-010) by intersecting
  // with the live answers map. The 80 KB catalogue still never reaches the browser.
  questionIds: SessionQuestionIds;
  // The persisted answers map (SSR snapshot). The live Dexie row takes over once it hydrates,
  // so an offline answer reflects in the per-Part progress without a server round-trip.
  initialAnswers: AnswersMap;
  // The relevant flags' column↔flag bindings (catalogue-derived server-side). Not rendered
  // here — the toggles live in the Part 1 form; this is only how the screen reads the
  // persisted flag columns off the live row to recompute the personalized counts.
  flagBindings: RelevantToggle[];
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function SessionScreen({
  inspection,
  unlocked,
  counts,
  questionIds,
  initialAnswers,
  flagBindings,
}: Props) {
  // `draft` is the user's in-progress edit (null until they type). The displayed value
  // falls back to the locally-saved Dexie row, then the SSR prop — so an offline edit
  // not yet synced to the server is reflected (via `useLiveQuery`) without an effect
  // mirroring it into state (which `react-hooks/set-state-in-effect` forbids), and a
  // started edit always wins over the live row so typing is never clobbered.
  const [draft, setDraft] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // Drain the outbox for this session (same resilient triggers as Part1Form).
  useEffect(() => startAutoSync(), []);

  const liveRow = useLiveQuery(() => db.inspections.get(inspection.id), [inspection.id]);
  const persisted = liveRow?.globalNotes ?? inspection.globalNotes ?? "";
  const notes = draft ?? persisted;
  const overLimit = notes.length > MAX_NOTES;

  // Debounced persist via the read-merge `saveInspection` — a sparse `{ id, globalNotes }`
  // update that preserves the Part 1 config it never re-sends (Phase 2 §3). Runs only once
  // the user has edited (`draft !== null`) and the value is within the limit. All setState
  // happens inside the (async) timeout, never synchronously in the effect body.
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

  function handleNotesChange(value: string) {
    setDraft(value);
  }

  // The active-flag set is DERIVED from the persisted flag columns (the live Dexie row,
  // falling back to the SSR prop), so a flag set in Part 1 — even an offline edit not yet
  // synced — reflects here via `useLiveQuery` without a server round-trip, and a reload
  // re-hydrates the same set. The bindings carry the column↔flag map (e.g. importedFromEu →
  // importedFromEU) since the catalogue itself never reaches this island.
  const flagRow = liveRow ?? inspection;
  const activeFlags = new Set<RuntimeFlag>();
  for (const t of flagBindings) if (flagRow[t.column]) activeFlags.add(t.flag);

  // Live per-Part counts + Total Score / completion denominator, recomputed from the server
  // payload for the persisted flag set (FR-014). The 80 KB catalogue never reaches here.
  const liveCounts = countsForFlags(counts, activeFlags);
  const totalVisible = totalCount(liveCounts);

  // The live answers (Dexie row, falling back to the SSR snapshot until it hydrates) and the
  // live visible question IDs for the active flag set. Answered-per-Part = how many of a
  // Part's visible IDs have an answer — intersecting with the visible set so an orphaned
  // answer (a now-hidden question, pre-S-07) is never counted. jsonb keys stay verbatim.
  const answers = (liveRow?.answers as AnswersMap | undefined) ?? initialAnswers;
  const liveIds = questionIdsForFlags(questionIds, activeFlags);
  const answeredByPart = (part: PartId) => answeredCount(liveIds[part], answers);

  // Part names + order are the PRD's five parts (prd.md:56) — the real-world physical
  // inspection order (Info → Standstill → Engine → Drive → Documents; prd.md:194).
  const parts = [
    { n: 1, title: "Info", count: null as number | null, answered: 0 },
    { n: 2, title: "Standstill", count: liveCounts.part2, answered: answeredByPart("part2") },
    { n: 3, title: "Engine", count: liveCounts.part3, answered: answeredByPart("part3") },
    { n: 4, title: "Drive", count: liveCounts.part4, answered: answeredByPart("part4") },
    { n: 5, title: "Documents", count: liveCounts.part5, answered: answeredByPart("part5") },
  ];

  return (
    <div className="space-y-8">
      <header>
        <a
          href="/dashboard"
          className="text-sm text-purple-300 transition-colors hover:text-purple-100 hover:underline"
        >
          &larr; Back to dashboard
        </a>
        <h1 className="mt-4 text-2xl font-bold text-white">{inspection.name ?? "Inspection"}</h1>
        <p className="mt-1 text-blue-100/60">
          Your inspection session — pick a part to work on, or jot global notes below.
        </p>
      </header>

      <div className="relative">
        {/* Total Score + Completion are meaningless before there is a config: blur them
            until Part 1 is valid, with an overlay explaining how to reveal them. */}
        <div
          className={`grid gap-4 sm:grid-cols-2 ${unlocked ? "" : "pointer-events-none blur-sm select-none"}`}
          aria-hidden={unlocked ? undefined : true}
        >
          <Card className={PANEL}>
            <CardHeader>
              <CardTitle className="text-white">Total Score</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-white">0%</p>
              <div className="mt-3 flex gap-4 text-sm">
                <span className="text-emerald-300">Yes 0</span>
                <span className="text-red-300">No 0</span>
                <span className="text-blue-100/60">Don&apos;t know 0</span>
              </div>
            </CardContent>
          </Card>

          <Card className={PANEL}>
            <CardHeader>
              <CardTitle className="text-white">Completion</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-white">
                0 <span className="text-base font-normal text-blue-100/50">of {totalVisible}</span>
              </p>
              <p className="mt-3 text-sm text-blue-100/60">questions answered for this car</p>
            </CardContent>
          </Card>
        </div>
        {!unlocked && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/40 px-4 py-3 text-center text-sm text-blue-100/80 backdrop-blur-sm">
              <Lock className="size-4 shrink-0 text-blue-100/60" />
              Complete Part 1 (Info) to reveal the Total Score and Completion.
            </div>
          </div>
        )}
      </div>

      <section className={`rounded-xl border p-5 ${PANEL}`}>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">Parts</h2>
          {!unlocked && <Lock className="size-4 text-blue-100/50" />}
        </div>
        {!unlocked && (
          <p className="mb-4 text-sm text-blue-100/60">Complete Part 1 (Info) to unlock the personalized Parts 2–5.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {parts.map((p) => {
            // Part 1 (Info) is always reachable — it's where the config is made valid.
            // Parts 2–5 are locked (non-navigable) until the config is unlocked.
            const locked = p.n !== 1 && !unlocked;
            // Part 1 (count === null) is the config form; Parts 2–5 surface answered progress.
            const isConfig = p.count === null;
            const total = p.count ?? 0;
            // A Part is complete once every visible question is answered (FR-010 / #2).
            const completed = !isConfig && total > 0 && p.answered === total;
            const subtitle = isConfig
              ? "Edit configuration"
              : total === 0
                ? "No questions for this car"
                : p.answered > 0
                  ? // Started (#1): show answered / total rather than the bare total.
                    `${String(p.answered)} of ${String(total)} answered`
                  : `${String(total)} ${total === 1 ? "question" : "questions"}`;

            if (locked) {
              return (
                <div key={p.n} aria-disabled className="rounded-lg border border-white/10 bg-white/5 p-4 opacity-50">
                  <p className="text-xs tracking-wider text-blue-100/40 uppercase">Part {p.n}</p>
                  <p className="mt-1 font-medium text-white">{p.title}</p>
                  <p className="mt-2 text-sm text-blue-100/60">Locked</p>
                </div>
              );
            }
            return (
              <a
                key={p.n}
                href={`/inspections/${inspection.id}/session/part/${String(p.n)}`}
                className="rounded-lg border border-white/15 bg-white/10 p-4 transition-colors hover:border-white/30 hover:bg-white/15"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs tracking-wider text-blue-100/40 uppercase">Part {p.n}</p>
                  {completed && (
                    <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-200">
                      Completed
                    </span>
                  )}
                </div>
                <p className="mt-1 font-medium text-white">{p.title}</p>
                <p className="mt-2 text-sm text-blue-100/60">{subtitle}</p>
              </a>
            );
          })}
        </div>
      </section>

      <Card className={PANEL}>
        <CardHeader>
          <CardTitle className="text-white">Global notes</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            id="globalNotes"
            value={notes}
            onChange={(e) => {
              handleNotesChange(e.target.value);
            }}
            rows={8}
            aria-invalid={overLimit ? true : undefined}
            placeholder="Notes about the whole inspection…"
            className={`flex w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-purple-400/50 ${FIELD_INPUT}`}
          />
          <div className="mt-1 flex items-center justify-between text-xs">
            {overLimit ? (
              <span className="flex items-center gap-1 text-red-300">
                <CircleAlert className="size-3 shrink-0" />
                {NOTES_TOO_LONG}
              </span>
            ) : (
              <span className="text-blue-100/40">
                {saveStatus === "saving" && "Saving…"}
                {saveStatus === "saved" && "Saved."}
                {saveStatus === "error" && <span className="text-red-300">Could not save on this device.</span>}
              </span>
            )}
            <span className={overLimit ? "text-red-300" : "text-blue-100/40"}>
              {notes.length.toLocaleString()} / {MAX_NOTES.toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
