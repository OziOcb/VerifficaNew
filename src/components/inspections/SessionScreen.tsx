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
import { CircleAlert } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { saveInspection, flushQueue, startAutoSync } from "@/lib/sync";

// Cosmic glass palette — matches Part1Form / the dashboard shell.
const PANEL = "border-white/10 bg-white/5 text-white backdrop-blur-xl";
const FIELD_INPUT = "border-white/20 bg-white/10 text-white placeholder:text-white/40";

// FR-010: the global notes document is a distinct 10,000-char inspection-level doc
// (separate from the 1,000-char Part 1 `notes`). Enforced app-side (mirrors Part 1).
const MAX_NOTES = 10_000;
const NOTES_TOO_LONG = "Global notes cannot be longer than 10,000 characters.";

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
  visibleCounts: { part2: number; part3: number; part4: number; part5: number };
  totalVisible: number;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function SessionScreen({ inspection, visibleCounts, totalVisible }: Props) {
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

  const parts = [
    { n: 1, title: "Vehicle configuration", count: null as number | null },
    { n: 2, title: "Condition", count: visibleCounts.part2 },
    { n: 3, title: "Documents", count: visibleCounts.part3 },
    { n: 4, title: "Test drive", count: visibleCounts.part4 },
    { n: 5, title: "Summary", count: visibleCounts.part5 },
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

      <section className={`rounded-xl border p-5 ${PANEL}`}>
        <h2 className="mb-3 text-lg font-semibold text-white">Parts</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {parts.map((p) => (
            <a
              key={p.n}
              href={`/inspections/${inspection.id}/session/part/${String(p.n)}`}
              className="rounded-lg border border-white/15 bg-white/10 p-4 transition-colors hover:border-white/30 hover:bg-white/15"
            >
              <p className="text-xs tracking-wider text-blue-100/40 uppercase">Part {p.n}</p>
              <p className="mt-1 font-medium text-white">{p.title}</p>
              <p className="mt-2 text-sm text-blue-100/60">
                {p.count === null
                  ? "Edit configuration"
                  : `${String(p.count)} ${p.count === 1 ? "question" : "questions"}`}
              </p>
            </a>
          ))}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
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
