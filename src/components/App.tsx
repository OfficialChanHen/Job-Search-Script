"use client";
import { useEffect, useRef, useState } from "react";
import type { JobData } from "@/lib/data/types";
import { loadJobData } from "@/lib/client/data";
import { confetti, setToastImpl, toast } from "@/lib/client/effects";
import { getStore, useStoreRev } from "@/lib/client/store";
import { checkProgress } from "@/lib/game/check";
import { NS } from "@/lib/game/progress";
import { newVillage, normalize, review, settle, type VillageState } from "@/lib/game/village/engine";
import { gameStats, levelFor, titleFor } from "@/lib/game/xp";
import { snapshot } from "@/lib/game/progress";
import { supabaseBrowser } from "@/lib/supabase/client";
import { supabaseBackend } from "@/lib/sync/supabaseBackend";
import type { Store } from "@/lib/sync/store";
import Account from "./Account";
import { GameProvider, useDerived, useGame, type Game } from "./GameContext";
import Hud from "./Hud";
import JobBoard from "./JobBoard";

export default function App() {
  const [data, setData] = useState<JobData | null>(null);
  const [store] = useState(getStore);
  const [err, setErr] = useState("");
  useEffect(() => {
    loadJobData().then(setData, e => setErr(String(e.message || e)));
  }, []);
  if (err) return <div className="wrap"><div className="empty">Couldn&apos;t load jobs: {err}</div></div>;
  if (!data) return <div className="wrap"><div className="empty">Loading your job hunt…</div></div>;
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
      <div className="wrap">
        <header className="hero">
          <div className="eyebrow">Chan Hen&apos;s job hunt</div>
          <h1>Entry-level SWE &amp; tech roles</h1>
          <Summary />
          <div className="sub">Updated {data.meta.generated}. Latest scrape {data.meta.latest}. US only, ranked by skill match, full-time first, in-person first.</div>
        </header>
        <Account />
        <Hud />
        <JobBoard />
      </div>
      <Toast />
      <canvas id="confetti" />
    </GameProvider>
  );
}

function Summary() {
  const { data, p } = useGame();
  const open = data.jobs.filter(j => !j.closed && p.status[j.id]?.s !== "hidden" && j.type !== "parttime");
  const applied = Object.values(p.status).filter(v => v.s === "applied").length;
  return (
    <div className="summary">
      <strong className="num">{open.filter(j => j.date === data.meta.latest).length}</strong> new today,{" "}
      <strong className="num">{open.filter(j => j.jobType === "Full-time").length}</strong> full-time,{" "}
      <strong className="num">{open.filter(j => j.direct).length}</strong> with a direct company link,{" "}
      <strong className="num">{applied}</strong> applied
    </div>
  );
}

/* ── sign-in state → sync ───────────────────────────────────── */
function useSync(store: Store) {
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
      let earned = 0, starved = 0;
      store.mutate<VillageState>(NS.village, "state", v => {
        const r = settle(normalize(v), ref.current.ctx, Date.now());
        earned = r.gold; starved = r.starved;
        return r.v;
      });
      if (away > 15 * 60_000 && earned >= 1) setTimeout(() => toast(`🏰 While you were away, your hunters earned ${Math.floor(earned).toLocaleString()} gold.` +
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
    if (r.news.length) setTimeout(() => { toast(r.news[0] + (r.news.length > 1 ? ` And ${r.news.length - 1} more.` : "")); confetti(70); }, 450);
  }, [game.rev]);
}

/* ── badges, quest clears, level-ups ────────────────────────── */
function useCelebrations(game: Game) {
  const first = useRef(true);
  useEffect(() => {
    const { store, byId, stats } = game;
    const facts = { zones: stats.zones, raidWins: stats.raidWins, bldMax: stats.bldMax, hunters: stats.hunters };
    const r = checkProgress(store, () => gameStats(snapshot(store), byId, facts), new Date());
    if (first.current) { first.current = false; return; }      // don't celebrate old progress on load
    if (r.cleared) { toast("🎯 All daily quests cleared! +50 XP"); confetti(160); }
    r.badges.forEach(([, ico, name], i) => setTimeout(() => { toast(`${ico} Badge unlocked: ${name}! +25 XP`); confetti(120); }, 300 + i * 1200));
    if (r.levelUp) setTimeout(() => { toast(`⬆ Level ${r.levelUp}! You're now a ${titleFor(levelFor(r.stats.xp))}`); confetti(260); }, r.badges.length ? 1400 : 200);
  }, [game]);
}

function Toast() {
  const [t, setT] = useState<{ msg: string; err: boolean; show: boolean }>({ msg: "", err: false, show: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setToastImpl((msg, err) => {
      setT({ msg, err: !!err, show: true });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setT(x => ({ ...x, show: false })), 2600);
    });
  }, []);
  return <div id="toast" className={(t.show ? "show" : "") + (t.err ? " err" : "")} role="status">{t.msg}</div>;
}
