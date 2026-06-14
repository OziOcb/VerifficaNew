// The dashboard's single interactive island (client:load). Owns all lifecycle
// interactivity: tiles grouped Draft/Completed, the startup-instruction and limit
// pop-ups, create, and delete. Seeds from the SSR `inspections` prop and keeps a
// local copy so deletes update the grid (and free a slot) without a round-trip.
//
// MUST stay Dexie-free — it is server-rendered then hydrated, so importing
// @/lib/db / @/lib/sync would drag IndexedDB onto an SSR path (see src/lib/db.ts).
// The synchronous mutations go through @/lib/inspections, never the F-02 outbox.
import { useState } from "react";
import { PlayCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  createInspection,
  deleteInspection,
  hideStartupKey,
  type Inspection,
  type InspectionStatus,
} from "@/lib/inspections";
import { StartupInstructions } from "@/components/dashboard/StartupInstructions";

const LIMIT = 2;

// Cosmic glass palette shared with the public home page (Home.astro). The shadcn
// primitives are light-themed by default; these className overrides recolor them
// for the dark cosmic shell (tailwind-merge lets the later utilities win).
const GLASS_PANEL = "border-white/10 bg-white/5 text-white backdrop-blur-xl";
const DIALOG_PANEL = "border-white/10 bg-slate-900/95 text-white backdrop-blur-xl";
const PRIMARY_BTN = "bg-purple-600 text-white hover:bg-purple-500";
const OUTLINE_BTN = "border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white";

// DB widens status to string; narrow it for grouping, defaulting unknown to draft.
function statusOf(value: string): InspectionStatus {
  return value === "completed" ? "completed" : "draft";
}

// Deterministic DD/MM/YYYY from UTC parts. `toLocaleDateString()` formats in the
// runtime's locale + timezone, so the workerd SSR output (UTC, en-US default) and
// the browser's locale output disagree → React hydration mismatch. Building the
// string from fixed UTC components renders identically on server and client.
function formatDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getUTCFullYear()}`;
}

interface Props {
  inspections: Inspection[];
  userId: string;
}

export default function DashboardBoard({ inspections: initial, userId }: Props) {
  const [inspections, setInspections] = useState<Inspection[]>(initial);
  const [showStartup, setShowStartup] = useState(false);
  const [showLimit, setShowLimit] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);

  const startupKey = hideStartupKey(userId);
  const atLimit = inspections.length >= LIMIT;
  const drafts = inspections.filter((i) => statusOf(i.status) === "draft");
  const completed = inspections.filter((i) => statusOf(i.status) === "completed");

  async function create() {
    setBusy(true);
    const result = await createInspection();
    setBusy(false);
    if (result.ok) {
      window.location.assign(`/inspections/${result.id}`);
      return;
    }
    // Backstop: a stale prop let an over-limit insert through; show the pop-up.
    setShowStartup(false);
    if (result.limitReached) setShowLimit(true);
  }

  function handleStart() {
    if (atLimit) {
      setShowLimit(true);
      return;
    }
    const hidden = localStorage.getItem(startupKey) === "1";
    if (hidden) {
      void create();
    } else {
      setDontShowAgain(false);
      setShowStartup(true);
    }
  }

  function confirmStartup() {
    if (dontShowAgain) localStorage.setItem(startupKey, "1");
    void create();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    const ok = await deleteInspection(id);
    if (ok) setInspections((prev) => prev.filter((i) => i.id !== id));
    setPendingDelete(null);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-white">Your inspections</h1>
        <Button type="button" onClick={handleStart} disabled={busy} className={PRIMARY_BTN}>
          <Plus className="size-4" />
          Start new inspection
        </Button>
      </header>

      {inspections.length === 0 ? (
        <div className={`rounded-xl border border-dashed border-white/15 p-10 text-center ${GLASS_PANEL}`}>
          <p className="mb-4 text-blue-100/70">
            You have no inspections yet. Start your first one to assess a used car step by step.
          </p>
          <Button type="button" onClick={handleStart} disabled={busy} className={PRIMARY_BTN}>
            <Plus className="size-4" />
            Start new inspection
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          <InspectionGroup
            title="Draft"
            rows={drafts}
            onResume={(id) => {
              window.location.assign(`/inspections/${id}`);
            }}
            onDelete={setPendingDelete}
          />
          <InspectionGroup
            title="Completed"
            rows={completed}
            onResume={(id) => {
              window.location.assign(`/inspections/${id}`);
            }}
            onDelete={setPendingDelete}
          />
        </div>
      )}

      {/* Startup instruction pop-up */}
      <Dialog open={showStartup} onOpenChange={setShowStartup}>
        <DialogContent className={DIALOG_PANEL}>
          <DialogHeader>
            <DialogTitle className="text-white">How to use the Veriffica</DialogTitle>
          </DialogHeader>
          <StartupInstructions />
          <label className="flex items-center gap-2 text-sm text-blue-100/80">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => {
                setDontShowAgain(e.target.checked);
              }}
              className="size-4 rounded border-white/20 bg-white/5"
            />
            Don&apos;t show this again
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowStartup(false);
              }}
              disabled={busy}
              className={OUTLINE_BTN}
            >
              Cancel
            </Button>
            <Button type="button" onClick={confirmStartup} disabled={busy} className={PRIMARY_BTN}>
              {busy ? "Creating…" : "Start inspection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Limit-reached pop-up */}
      <Dialog open={showLimit} onOpenChange={setShowLimit}>
        <DialogContent className={DIALOG_PANEL}>
          <DialogHeader>
            <DialogTitle className="text-white">Inspection limit reached</DialogTitle>
            <DialogDescription className="text-blue-100/60">
              You can keep up to {LIMIT} inspections at a time. Delete one to start a new inspection.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                setShowLimit(false);
              }}
              className={PRIMARY_BTN}
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Destructive delete confirm */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent className={DIALOG_PANEL}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete this inspection?</AlertDialogTitle>
            <AlertDialogDescription className="text-blue-100/60">
              This permanently deletes “{pendingDelete?.name ?? "this inspection"}”. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={OUTLINE_BTN}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()} className="bg-red-600 text-white hover:bg-red-500">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface GroupProps {
  title: string;
  rows: Inspection[];
  onResume: (id: string) => void;
  onDelete: (inspection: Inspection) => void;
}

function InspectionGroup({ title, rows, onResume, onDelete }: GroupProps) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-xs font-medium tracking-wider text-blue-100/40 uppercase">
        {title} ({rows.length})
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((row) => (
          <Card key={row.id} className={GLASS_PANEL}>
            <CardHeader>
              <CardTitle className="truncate text-white">{row.name ?? "Untitled inspection"}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-blue-100/60">Started {formatDate(row.createdAt)}</CardContent>
            <CardFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onResume(row.id);
                }}
                className={OUTLINE_BTN}
              >
                <PlayCircle className="size-4" />
                Resume
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onDelete(row);
                }}
                className="text-red-300 hover:bg-white/10 hover:text-red-200"
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}
