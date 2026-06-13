// THROWAWAY demo island (F-02). Drives and observes the offline → online
// round-trip; to be removed when S-02's real dashboard subsumes it.
//
// Dexie-backed, so it MUST be mounted `client:only="react"` (see offline-demo.astro).
// Never let `@/lib/db` (imported transitively via `@/lib/sync`) reach an SSR path.
import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { flushQueue, resetLocalStoreOnUserChange, saveInspection, startAutoSync } from "@/lib/sync";

interface Props {
  userId: string | null;
}

export default function OfflineDemo({ userId }: Props) {
  // `useLiveQuery` re-renders on every Dexie write; `undefined` while loading.
  const inspections = useLiveQuery(() => db.inspections.orderBy("updatedAt").toArray());

  useEffect(() => {
    // If a different account signed in on this browser, wipe the per-origin store
    // first, then start resilient outbox draining (online + visibility + retry
    // net). `startAutoSync` returns a cleanup we run on unmount.
    let stop: (() => void) | undefined;
    void (async () => {
      if (userId) await resetLocalStoreOnUserChange(userId);
      stop = startAutoSync();
    })();
    return () => {
      stop?.();
    };
  }, [userId]);

  async function handleSave() {
    await saveInspection({
      id: crypto.randomUUID(),
      status: "draft",
      name: `Inspection ${new Date().toLocaleTimeString()}`,
    });
    // Already online? Drain now — no `online` event will fire to trigger it.
    // Offline saves stay queued and drain on the next reconnect.
    if (navigator.onLine) await flushQueue();
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Offline demo</h1>
      <p className="mb-4 text-sm text-gray-500">
        Save a record, toggle DevTools offline, save again, then reconnect. Rows persist locally and flip{" "}
        <code>synced</code> 0 → 1 once the server confirms.
      </p>

      <button
        type="button"
        onClick={() => void handleSave()}
        className="mb-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
      >
        Save record
      </button>

      <ul className="space-y-2">
        {inspections?.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <span className="truncate font-mono text-xs">{row.id}</span>
            <span className="px-2">{row.status}</span>
            <span data-testid="sync-status" className={row.synced ? "text-green-600" : "text-amber-600"}>
              {row.synced ? "synced" : "pending"}
            </span>
          </li>
        ))}
      </ul>

      {inspections?.length === 0 && <p className="text-sm text-gray-400">No records yet.</p>}
    </div>
  );
}
