// The dashboard top-bar account menu (S-10 / FR-022). Replaces the old inline
// email-chip + SignOutButton row with an account-icon dropdown: Settings link,
// a quick Light⇄Dark toggle, and Sign out.
//
// MUST stay `client:only="react"`: it folds in the Dexie-wiping signout (imports
// @/lib/db), and Dexie has no global on workerd/SSR (see src/lib/db.ts). It is the
// single dashboard island carrying that constraint now that SignOutButton is retired.
import { useRef, useState } from "react";
import { CircleUser, LogOut, Moon, Settings, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { db } from "@/lib/db";
import { applyTheme, effectiveTheme, getThemeChoice, setThemeChoice } from "@/lib/theme";

interface Props {
  userEmail?: string;
}

export default function AccountMenu({ userEmail }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  // Effective (resolved) mode drives the quick-toggle label/icon. Lazy initializer
  // reads the live document state — safe because this is a client:only island (never
  // SSR'd, so no hydration mismatch); keeping it in state re-renders on each flip.
  const [isDark, setIsDark] = useState(() => effectiveTheme(getThemeChoice()) === "dark");

  function toggleTheme() {
    const next = effectiveTheme(getThemeChoice()) === "dark" ? "light" : "dark";
    setThemeChoice(next);
    applyTheme();
    setIsDark(next === "dark");
  }

  function handleSignOut() {
    setBusy(true);
    void (async () => {
      try {
        await db.delete(); // drop the whole local IndexedDB store before the session ends
      } catch {
        // Best-effort wipe — never block signout on a Dexie hiccup.
      }
      // NB: the per-user "don't show again" preference (hideStartupKey) is left in
      // place on purpose — it is user-scoped, so it must survive logout.
      formRef.current?.submit(); // native submit -> server clears session, redirects to /
    })();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Account menu"
          className="text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-10 items-center justify-center rounded-md outline-none focus-visible:ring-2"
        >
          <CircleUser className="size-6" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {userEmail && <DropdownMenuLabel className="truncate font-normal">{userEmail}</DropdownMenuLabel>}
          {userEmail && <DropdownMenuSeparator />}
          <DropdownMenuItem asChild>
            <a href="/settings">
              <Settings className="size-4" />
              Settings
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              // Keep the menu open would be odd here; default close is fine, but
              // prevent the anchor-like default just in case.
              e.preventDefault();
              toggleTheme();
            }}
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {isDark ? "Light mode" : "Dark mode"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={busy}
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              handleSignOut();
            }}
          >
            <LogOut className="size-4" />
            {busy ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Hidden native form the signout item submits after the Dexie wipe. */}
      <form ref={formRef} method="POST" action="/api/auth/signout" className="hidden" />
    </>
  );
}
