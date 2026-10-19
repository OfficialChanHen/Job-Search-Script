"use client";
import { useEffect, useRef, useState } from "react";
import { confetti, toast } from "@/lib/client/effects";
import { SYNC_ENABLED } from "@/lib/supabase/env";
import { supabaseBrowser } from "@/lib/supabase/client";
import { importLegacy, parseBackup } from "@/lib/sync/importLegacy";
import { useGame } from "./GameContext";

const STATE_TEXT = {
  local: "Saved in this browser only",
  idle: "Synced",
  syncing: "Syncing…",
  offline: "Offline. Changes will sync when you're back online.",
  error: "Sync problem. Retrying.",
};

export default function Account() {
  const { store } = useGame();
  const [email, setEmail] = useState("");
  const [user, setUser] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) return;
    sb.auth.getUser().then(({ data }) => setUser(data.user?.email ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setUser(s?.user.email ?? null));
    const q = new URLSearchParams(location.search);
    if (q.has("signed-in")) toast("✓ Signed in. Your progress now syncs across devices.");
    if (q.has("auth-error")) toast("That sign-in link didn't work. Request a new one.", true);
    if (q.has("signed-in") || q.has("auth-error")) history.replaceState(null, "", location.pathname);
    return () => sub.subscription.unsubscribe();
  }, []);

  const sendLink = async () => {
    const sb = supabaseBrowser();
    if (!sb || !email.includes("@")) return toast("Enter your email", true);
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
    if (error) return toast(error.message, true);
    setSent(true);
  };
  const google = async () => {
    const sb = supabaseBrowser();
    const { error } = await sb!.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback` } });
    if (error) toast(error.message, true);
  };
  const signOut = async () => { await supabaseBrowser()?.auth.signOut(); toast("Signed out. This browser keeps a copy."); };

  const importFile = async (f: File) => {
    try {
      const data = parseBackup(await f.text());
      const s = importLegacy(store, data);
      toast(`💾 Imported ${s.applied} applications, ${s.solved} solved problems and ${s.badges} badges` + (s.village ? ", plus your village." : "."));
      confetti(120);
      setOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't read that file", true);
    }
  };

  const state = user ? store.syncState : "local";
  return (
    <section className="account" aria-label="Account and sync">
      <span className={`sync-dot ${state}`} aria-hidden />
      <span className="account-text">
        {user ? <><b>{user}</b>. {STATE_TEXT[state]}{store.pendingCount && state === "idle" ? ` ${store.pendingCount} changes waiting.` : ""}</>
              : SYNC_ENABLED ? "Sign in to save your progress across your phone and computer." : "Saved in this browser only. Sync isn't set up yet."}
      </span>
      <span className="account-btns">
        {SYNC_ENABLED && !user && <button className="mini primary" onClick={() => setOpen(o => !o)}>Sign in</button>}
        {user && <button className="mini" onClick={signOut}>Sign out</button>}
        <button className="mini" onClick={() => file.current?.click()} title="Bring over progress from the old dashboard (its 💾 Back up progress button)">💾 Import backup</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
      </span>
      {open && !user && (
        <div className="account-form">
          {sent ? <p>Check your email for a sign-in link. Open it on this device.</p> : <>
            <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && sendLink()} autoComplete="email" />
            <button className="mini primary" onClick={sendLink}>Email me a link</button>
            <button className="mini" onClick={google}>Continue with Google</button>
          </>}
        </div>
      )}
    </section>
  );
}
