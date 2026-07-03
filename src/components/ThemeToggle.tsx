// Standalone Light⇄Dark quick-toggle for the homepage Topbar. The dashboard flips
// theme from AccountMenu; the marketing homepage has no account menu, so this is the
// equivalent control there.
//
// MUST stay `client:only="react"`: the effective theme depends on the stored cookie
// and (for `system`) `matchMedia`, neither readable during SSR. Rendering it only on
// the client avoids a hydration mismatch on the icon/label.
import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, effectiveTheme, getThemeChoice, setThemeChoice } from "@/lib/theme";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => effectiveTheme(getThemeChoice()) === "dark");

  function toggleTheme() {
    const next = effectiveTheme(getThemeChoice()) === "dark" ? "light" : "dark";
    setThemeChoice(next);
    applyTheme();
    setIsDark(next === "dark");
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex size-9 items-center justify-center rounded-md text-white/90 transition-colors outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40"
    >
      {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}
