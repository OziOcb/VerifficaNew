// Relevance-filtered equipment toggles for the session hub (S-04, FR-014, Phase 4).
// Presentational: the parent passes the toggles the current config makes relevant (already
// catalogue-derived via `relevantToggles`), the active-flag set, and an `onToggle` callback
// that persists the change. Flipping a toggle moves the visible counts + Total Score
// denominator in the parent immediately (no server round-trip).
import type { FlagColumn, RelevantToggle, RuntimeFlag } from "@/lib/questions";

// UI copy keyed by DB column (the stable identity the toggle carries through to persistence).
const FLAG_LABELS: Record<FlagColumn, string> = {
  chargingPortEquipped: "Charging port present",
  evBatteryDocsAvailable: "EV battery documentation available",
  turboEquipped: "Turbocharger fitted",
  mechanicalCompressorEquipped: "Mechanical supercharger fitted",
  importedFromEu: "Imported from the EU",
};

interface Props {
  toggles: RelevantToggle[];
  active: ReadonlySet<RuntimeFlag>;
  onToggle: (column: FlagColumn, next: boolean) => void;
}

export default function EquipmentToggles({ toggles, active, onToggle }: Props) {
  if (toggles.length === 0) return null;

  return (
    <section className="border-border bg-card text-card-foreground rounded-xl border p-5">
      <h2 className="text-foreground text-lg font-semibold">Equipment</h2>
      <p className="text-muted-foreground mt-1 mb-4 text-sm">
        Confirm what this car has — relevant questions appear in the parts above.
      </p>
      <ul className="space-y-2">
        {toggles.map((t) => {
          const on = active.has(t.flag);
          return (
            <li key={t.column}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => {
                  onToggle(t.column, !on);
                }}
                className="border-border bg-muted text-foreground hover:bg-accent focus-visible:ring-ring/50 flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left text-sm shadow-xs transition-all outline-none focus-visible:ring-[3px]"
              >
                <span>{FLAG_LABELS[t.column]}</span>
                <span
                  aria-hidden
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full shadow-xs transition-colors ${
                    on ? "bg-primary" : "bg-input"
                  }`}
                >
                  <span
                    className={`bg-background absolute top-0.5 size-5 rounded-full shadow-sm transition-transform ${
                      on ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
