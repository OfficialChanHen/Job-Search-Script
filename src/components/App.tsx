"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { JobData } from "@/lib/data/types";
import { loadJobData } from "@/lib/client/data";
import { confetti, floatText, setToastImpl, toast } from "@/lib/client/effects";
import { loadSheetRows } from "@/lib/client/sheetRows";
import { getStore, useStoreRev } from "@/lib/client/store";
import { checkProgress } from "@/lib/game/check";
import { NS, snapshot } from "@/lib/game/progress";
import { huntHours, newVillage, normalize, review, settle, workGold, type VillageState } from "@/lib/game/village/engine";
import { gameStats, levelFor, titleFor } from "@/lib/game/xp";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SYNC_ENABLED } from "@/lib/supabase/env";
import { supabaseBackend } from "@/lib/sync/supabaseBackend";
import type { Store } from "@/lib/sync/store";
import GamePanel, { fmtHrs } from "./GamePanel";
import { GameProvider, useDerived, useGame, type Game } from "./GameContext";
import JobBoard from "./JobBoard";
import { Drawer } from "./Panels";
import { UiProvider, useUi } from "./UiContext";
import { useNow } from "./useNow";
import { VillageWindow } from "./Village";

export default function App() {
  const [data, setData] = useState<JobData | null>(null);
  const [store] = useState(getStore);
  const [err, setErr] = useState("");
  useEffect(() => { loadJobData().then(setData, e => setErr(String(e.message || e))); }, []);
  if (err) return <div className="loading">Couldn&apos;t load the jobs: {err}</div>;
  if (!data) return <div className="loading">Loading your job hunt…</div>;
  return <Loaded data={data} store={store} />;
}

function Loaded({ data, store }: { data: JobData; store: Store }) {
  const rev = useStoreRev(store);
  const game = useDerived(data, store, rev);
  useSync(store);
  useVillageClock(game);
  useCelebrations(game);
  return (
    <GameProvider value={game}>
      <UiProvider>
        <Shell />
        <VillageWindow />
        <Drawer />
        <Toast />
        <canvas id="confetti" aria-hidden />
      </UiProvider>
    </GameProvider>
  );
}

function Shell() {
  const { tab } = useUi();
  return (
    <>
      <TopBar />
      <div className={"shell tab-" + tab}>
        <main className="jobs-col"><JobBoard /></main>
        <aside className="game-col" aria-label="Your village"><GamePanel /></aside>
      </div>
      <BottomTabs />
    </>
  );
}

function TopBar() {
  const { store } = useGame();
  const { setDrawer } = useUi();
  const [user, setUser] = useState<string | null>(null);
  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) return;
    sb.auth.getUser().then(({ data }) => setUser(data.user?.email ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setUser(s?.user.email ?? null));
    const q = new URLSearchParams(location.search);
    if (q.has("signed-in")) toast("Signed in. Your progress now syncs across your devices.");
    if (q.has("auth-error")) toast("That sign-in link didn't work. Ask for a new one.", true);
    if (q.has("signed-in") || q.has("auth-error")) history.replaceState(null, "", location.pathname);
    return () => sub.subscription.unsubscribe();
  }, []);
  const state = user ? store.syncState : "local";
  const label = !user ? (SYNC_ENABLED ? "Saved on this device" : "Saved in this browser")
    : state === "idle" ? "Synced" : state === "syncing" ? "Syncing" : state === "offline" ? "Offline, will sync" : "Retrying sync";
  return (
    <header className="topbar">
      <Link className="wordmark" href="/">Job hunt</Link>
      <div className="topbar-side">
        <span className="sync" title={user ?? undefined}>{label}</span>
        {user
          ? <button className="pill quiet" onClick={async () => { await supabaseBrowser()?.auth.signOut(); toast("Signed out. This device keeps a copy."); }} title={user}>Sign out</button>
          : SYNC_ENABLED && <button className="pill" onClick={() => setDrawer("account")}>Sign in</button>}
        <button className="pill" onClick={() => setDrawer("tools")}>Tools</button>
      </div>
    </header>
  );
}

/** Phones: Jobs and Village as tabs. The Village tab shows food left, so the game is never far. */
function BottomTabs() {
  const { tab, setTab } = useUi();
  const g = useGame();
  const now = useNow(30_000);
  const food = g.village ? huntHours(settle(g.village, g.ctx, now).v, g.p) : 0;
  const quests = g.stats.quests.filter(([, n, goal]) => n < goal).length;
  return (
    <nav className="tabbar" aria-label="Sections">
      <button className={tab === "jobs" ? "on" : ""} onClick={() => setTab("jobs")} aria-current={tab === "jobs" ? "page" : undefined}>
        <span>Jobs</span><small>{quests ? `${quests} quests left` : "Quests done"}</small>
      </button>
      <button className={tab === "village" ? "on" : ""} onClick={() => setTab("village")} aria-current={tab === "village" ? "page" : undefined}>
        <span>Village</span><small className={food <= 0 ? "moment-text" : ""}>{food > 0 ? `${fmtHrs(food)} of food` : "Out of food"}</small>
      </button>
    </nav>
  );
}

/* ── sign-in state → sync, and your sheet's rows ───────────── */
function useSync(store: Store) {
  useEffect(() => {
    loadSheetRows(store);
    const t = setInterval(() => loadSheetRows(store), 20 * 60_000);
    return () => clearInterval(t);
  }, [store]);
  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) return;
    let current = "";
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      const uid = session?.user.id ?? "";
      if (uid === current) return;
      current = uid;
      if (uid) store.connect(supabaseBackend(sb, uid)).catch(() => {});
      else store.disconnect();
    });
    const refresh = () => { if (document.visibilityState === "visible") store.sync(); else store.flush().catch(() => {}); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    const t = setInterval(() => store.sync(), 5 * 60_000);
    return () => { sub.subscription.unsubscribe(); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("online", refresh); clearInterval(t); };
  }, [store]);
}

/* ── the village keeps hunting: settle on open, every few minutes and on leave ── */
function useVillageClock(game: Game) {
  const ref = useRef(game);
  useEffect(() => { ref.current = game; });
  useEffect(() => {
    const { store, ctx } = ref.current;
    const raw = store.get<VillageState>(NS.village, "state");
    if (!raw) {
      store.mutate<VillageState>(NS.village, "state", v => v ? normalize(v) : newVillage(ctx, Date.now()));
    } else {
      const away = Date.now() - normalize(raw).last;
      let got = { wood: 0, stone: 0, gems: 0 }, starved = 0;
      store.mutate<VillageState>(NS.village, "state", v => {
        const r = settle(normalize(v), ref.current.ctx, Date.now());
        got = r.mats; starved = r.starved;
        return r.v;
      });
      const parts = ([["wood", got.wood], ["stone", got.stone], ["gems", got.gems]] as const).filter(([, n]) => n >= 1).map(([m, n]) => `${Math.floor(n)} ${m}`);
      if (away > 15 * 60_000 && parts.length) setTimeout(() => toast(`While you were away, your hunters gathered ${parts.join(", ")}.` +
        (starved > 0.25 ? " They ran out of food a while ago." : "")), 1200);
    }
    const tick = () => store.mutate<VillageState>(NS.village, "state", v => settle(normalize(v), ref.current.ctx, Date.now()).v);
    const t = setInterval(tick, 5 * 60_000);
    const onHide = () => { if (document.visibilityState === "hidden") tick(); };
    document.addEventListener("visibilitychange", onHide);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onHide); };
  }, []);
  // new recruits join empty beds as soon as a solve lands
  useEffect(() => {
    const { store, ctx, village } = ref.current;
    if (!village) return;
    const r = review(village, ctx);
    if (JSON.stringify(r.v.party) === JSON.stringify(village.party) && JSON.stringify(r.v.seen) === JSON.stringify(village.seen)) return;
    store.mutate<VillageState>(NS.village, "state", v => review(normalize(v), ref.current.ctx).v);
    if (r.news.length) setTimeout(() => toast(r.news[0] + (r.news.length > 1 ? ` And ${r.news.length - 1} more.` : "")), 450);
  }, [game.rev]);
}

/* ── badges, quest clears, level-ups ────────────────────────── */
function useCelebrations(game: Game) {
  const first = useRef(true), paid = useRef<number | null>(null);
  // real work pays gold: show it the moment it lands
  useEffect(() => {
    if (!game.village) return;
    const g = workGold(game.village, game.p), was = paid.current;
    paid.current = g;
    if (was !== null && g - was >= 1) floatText(`+${Math.round(g - was).toLocaleString()} gold`, "var(--ochre)", 44);
  }, [game]);
  useEffect(() => {
    const { store, byId, stats } = game;
    const facts = { zones: stats.zones, raidWins: stats.raidWins, bldMax: stats.bldMax, hunters: stats.hunters };
    const r = checkProgress(store, () => gameStats(snapshot(store), byId, facts), new Date());
    if (first.current) { first.current = false; return; }      // don't celebrate old progress on load
    if (r.cleared) { toast("Every quest done for today. That's 50 XP and a day's food."); confetti(80); }
    r.badges.forEach(([, name], i) => setTimeout(() => toast(`New badge: ${name}. 25 XP.`), 300 + i * 1200));
    if (r.levelUp) setTimeout(() => { toast(`Level ${r.levelUp}. You're now ${titleFor(levelFor(r.stats.xp))}.`); confetti(130); }, r.badges.length ? 1400 : 200);
  }, [game]);
}

function Toast() {
  const [t, setT] = useState<{ msg: string; err: boolean; show: boolean }>({ msg: "", err: false, show: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setToastImpl((msg, err) => {
      setT({ msg, err: !!err, show: true });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setT(x => ({ ...x, show: false })), 2800);
    });
  }, []);
  return <div id="toast" className={(t.show ? "show" : "") + (t.err ? " err" : "")} role="status">{t.msg}</div>;
}
