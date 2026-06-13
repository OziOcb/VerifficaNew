// The real signout control. This is the ONE dashboard island that imports
// @/lib/db, so it MUST be mounted `client:only="react"` — Dexie has no global on
// workerd/SSR (see src/lib/db.ts). It honours the F-02 obligation to wipe the
// per-origin local store BEFORE the session ends, so the next account signing in
// on this browser can never read the previous owner's rows. After the wipe it
// submits the existing server signout form (clears the cookie, redirects to /).
import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";

export default function SignOutButton() {
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);

  function handleSignOut() {
    setBusy(true);
    void (async () => {
      try {
        await db.delete(); // drop the whole local IndexedDB store
      } catch {
        // Best-effort wipe — never block signout on a Dexie hiccup.
      }
      // NB: the per-user "don't show again" preference (hideStartupKey) is left
      // in place on purpose — it is user-scoped, so it must survive logout.
      formRef.current?.submit(); // native submit -> server clears session, redirects to /
    })();
  }

  return (
    <form ref={formRef} method="POST" action="/api/auth/signout">
      <Button
        type="button"
        variant="outline"
        onClick={handleSignOut}
        disabled={busy}
        className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
      >
        <LogOut className="size-4" />
        {busy ? "Signing out…" : "Sign out"}
      </Button>
    </form>
  );
}
