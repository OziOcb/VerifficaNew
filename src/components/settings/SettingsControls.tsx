// The interactive settings controls (S-10 / FR-022): theme (System/Light/Dark),
// font size (S/M/L), and the FR-009 startup-guide re-enable toggle.
//
// All three preferences are DEVICE-LOCAL: theme + fontScale are cookies (via
// @/lib/theme), the startup flag is per-user localStorage (via hideStartupKey).
// So this island renders client-side and reflects THIS browser only. It reads the
// current values on mount and writes + applies them live on every change — the
// no-flash inline script in Layout.astro already handled first paint.
import { useState } from "react";
import {
  applyFontScale,
  applyTheme,
  type FontScale,
  getFontScale,
  getThemeChoice,
  initSystemFollow,
  setFontScale,
  setThemeChoice,
  type ThemeChoice,
} from "@/lib/theme";
import { hideStartupKey, isStartupGuideEnabled, startupFlagFor } from "@/lib/inspections";

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const FONT_OPTIONS: { value: FontScale; label: string }[] = [
  { value: "sm", label: "S" },
  { value: "base", label: "M" },
  { value: "lg", label: "L" },
];

interface Props {
  userId: string;
}

export default function SettingsControls({ userId }: Props) {
  // Lazy initializers read the live device state (cookies + localStorage). Safe
  // because this is a client:only island — never SSR'd, so there is no server/client
  // hydration mismatch on these browser-only values.
  const [theme, setTheme] = useState<ThemeChoice>(() => getThemeChoice());
  const [font, setFont] = useState<FontScale>(() => getFontScale());
  const [guideEnabled, setGuideEnabled] = useState(() =>
    isStartupGuideEnabled(localStorage.getItem(hideStartupKey(userId))),
  );

  function chooseTheme(choice: ThemeChoice) {
    setThemeChoice(choice);
    applyTheme();
    // When System is (re)selected, ensure the OS live-follow listener is armed
    // (idempotent) so later OS switches re-apply without a reload.
    if (choice === "system") initSystemFollow();
    setTheme(choice);
  }

  function chooseFont(scale: FontScale) {
    setFontScale(scale);
    applyFontScale();
    setFont(scale);
  }

  function toggleGuide(enabled: boolean) {
    localStorage.setItem(hideStartupKey(userId), startupFlagFor(enabled));
    setGuideEnabled(enabled);
  }

  return (
    <div className="space-y-8">
      <Segmented label="Theme" options={THEME_OPTIONS} value={theme} onChange={chooseTheme} />
      <Segmented
        label="Text size"
        options={FONT_OPTIONS}
        value={font}
        onChange={chooseFont}
        hint="Scales all text on this device."
      />

      <div>
        <h2 className="text-foreground mb-1 text-sm font-medium">Startup guide</h2>
        <p className="text-muted-foreground mb-3 text-sm">
          Show the “How to use Veriffica” pop-up again the next time you start a new inspection.
        </p>
        <label className="flex items-center gap-3 text-sm">
          <button
            type="button"
            role="switch"
            aria-checked={guideEnabled}
            onClick={() => {
              toggleGuide(!guideEnabled);
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              guideEnabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`bg-background inline-block size-5 rounded-full shadow transition-transform ${
                guideEnabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="text-foreground">{guideEnabled ? "On" : "Off"}</span>
        </label>
      </div>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  hint?: string;
}

function Segmented<T extends string>({ label, options, value, onChange, hint }: SegmentedProps<T>) {
  return (
    <div>
      <h2 className="text-foreground mb-1 text-sm font-medium">{label}</h2>
      {hint && <p className="text-muted-foreground mb-3 text-sm">{hint}</p>}
      <div className="bg-muted inline-flex gap-1 rounded-lg p-1">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                onChange(opt.value);
              }}
              className={`min-w-12 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
