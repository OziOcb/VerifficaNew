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

// Caffeine token palette (S-10). tailwind-merge lets these later utilities win over
// the shadcn primitive defaults; flipping the `.dark` class recolors them per-mode.
const GLASS_PANEL = "border bg-card text-card-foreground";
const DIALOG_PANEL = "border bg-popover text-popover-foreground";
const PRIMARY_BTN = "bg-primary text-primary-foreground hover:bg-primary/90";
const OUTLINE_BTN = "border bg-background hover:bg-accent hover:text-accent-foreground";

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
        <h1 className="text-foreground text-2xl font-bold">Your inspections</h1>
        <Button type="button" onClick={handleStart} disabled={busy} className={PRIMARY_BTN}>
          <Plus className="size-4" />
          Start new inspection
        </Button>
      </header>

      {inspections.length === 0 ? (
        <div className={`rounded-xl border border-dashed p-10 text-center ${GLASS_PANEL}`}>
          <p className="text-muted-foreground mb-4">
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
            <DialogTitle className="text-foreground">How to use the Veriffica</DialogTitle>
          </DialogHeader>
          <StartupInstructions />
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => {
                setDontShowAgain(e.target.checked);
              }}
              className="border-input bg-background size-4 rounded"
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
            <DialogTitle className="text-foreground">Inspection limit reached</DialogTitle>
            <DialogDescription className="text-muted-foreground">
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
            <AlertDialogTitle className="text-foreground">Delete this inspection?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This permanently deletes “{pendingDelete?.name ?? "this inspection"}”. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={OUTLINE_BTN}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
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
      <h2 className="text-muted-foreground mb-3 text-xs font-medium tracking-wider uppercase">
        {title} ({rows.length})
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((row) => (
          <Card key={row.id} className={GLASS_PANEL}>
            <CardHeader>
              <CardTitle className="text-foreground truncate">{row.name ?? "Untitled inspection"}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">Started {formatDate(row.createdAt)}</CardContent>
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
                className="text-destructive hover:bg-accent hover:text-destructive"
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
