// The shared sentiment distribution chart (S-06, FR-019) — a presentational, catalogue-free
// stacked horizontal bar + legend used by all three consumers: the session-hub Total Score, the
// Summary's global chart, and each per-Part chart.
//
// It renders a SENTIMENT tally — Positive (good) / Negative (bad) / Don't know — NOT raw yes/no.
// The caller maps raw answers to sentiment per-Part via `sentimentDistribution()` +
// `positiveAnswer(part)` (Parts 2–4: No = positive; Part 5: Yes = positive), so this component is
// polarity-agnostic: it just lays out three colored counts. Emerald = positive, red = negative,
// blue = Don't-know.
//
// PURE: no Dexie / catalogue / React-state import — plain numbers in, so it is safe on any island
// (or SSR). FR-019, deliberately: there is NO combined headline quality % — the three slices'
// shares of ANSWERED are shown, never collapsed into a single score (liability-bounding).

// The three sentiment hues, tuned to read in both Caffeine light and dark modes — the bar fill
// (solid) paired with the legend text hue.
const SLICES = [
  {
    key: "positive" as const,
    label: "Positive",
    bar: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  { key: "negative" as const, label: "Negative", bar: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  { key: "unknown" as const, label: "Don't know", bar: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
];

interface Props {
  positive: number;
  negative: number;
  unknown: number;
  /** The visible-question denominator (how many questions apply to this car / Part). */
  total: number;
}

export default function DistributionBar({ positive, negative, unknown, total }: Props) {
  const counts = { positive, negative, unknown };
  const answered = positive + negative + unknown;

  // Two distinct empty states: a Part with no applicable questions vs. nothing answered yet.
  if (total === 0) {
    return <p className="text-muted-foreground text-sm">No questions for this car.</p>;
  }

  return (
    <div className="space-y-3">
      {/* The stacked bar: each slice's width is its share of ANSWERED (not of total), so the
          bar reads as the composition of what's been answered. A muted track shows through when
          nothing is answered yet. */}
      <div className="bg-muted flex h-3 w-full overflow-hidden rounded-full" aria-hidden="true">
        {answered > 0 &&
          SLICES.map((s) => {
            const value = counts[s.key];
            if (value === 0) return null;
            return <div key={s.key} className={s.bar} style={{ width: `${String((value / answered) * 100)}%` }} />;
          })}
      </div>

      {/* Legend: each slice's count and its share of answered. `answered of total` gives the
          denominator context without a single combined quality % (FR-019). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {SLICES.map((s) => {
          const value = counts[s.key];
          const share = answered > 0 ? Math.round((value / answered) * 100) : 0;
          return (
            <span key={s.key} className={s.text}>
              {s.label} {value}
              {answered > 0 && <span className="text-muted-foreground"> ({share}%)</span>}
            </span>
          );
        })}
      </div>

      <p className="text-muted-foreground text-xs">
        {answered === 0 ? "Nothing answered yet" : `${String(answered)} of ${String(total)} answered`}
      </p>
    </div>
  );
}
