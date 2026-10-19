"use client";
import { useEffect, useMemo, useRef } from "react";
import { floatText, toast } from "@/lib/client/effects";
import { getScene } from "@/lib/client/scene";
import { loadSprites } from "@/lib/client/sprites";
import { daRun, startDA, stopDA } from "@/lib/game/da";
import { followUps } from "@/lib/game/followups";
import { dueReviews } from "@/lib/game/reviews";
import {
  efficiency, goldNow, goldPerHour, huntHours, hunterKeys, partyUnits, settle, trained, zoneDef, type VillageState,
} from "@/lib/game/village/engine";
import { BADGES, levelFor, levelStart, titleFor } from "@/lib/game/xp";
import type { Store } from "@/lib/sync/store";
import { useGame, type Game } from "./GameContext";
import { useUi } from "./UiContext";
import { fmtClock, useNow } from "./useNow";

export const fmtN = (x: number) => {
  x = Math.floor(x);
  if (Math.abs(x) < 10000) return x.toLocaleString();
  if (Math.abs(x) < 1e6) return (x / 1000).toFixed(x < 1e5 ? 1 : 0) + "k";
  if (Math.abs(x) < 1e9) return (x / 1e6).toFixed(1) + "M";
  return x.toExponential(1).replace("e+", "e");
};
export const fmtHrs = (h: number) => {
  const m = Math.max(0, Math.round(h * 60));
  if (m < 60) return m + "m";
  if (m < 48 * 60) return Math.floor(m / 60) + "h " + (m % 60) + "m";
  return Math.round(m / 1440) + " days";
};

/** The village as of right now: hunting since the last save, not yet written. */
export function useLiveVillage(g: Game, tick: number): VillageState | null {
  return useMemo(() => g.village ? settle(g.village, g.ctx, tick).v : null, [g.village, g.ctx, tick]);
}

/** Feed the scene and mount its canvas into `host` while `active`. */
export function useScene(g: Game, live: VillageState | null, host: React.RefObject<HTMLDivElement | null>, active: boolean) {
  useEffect(() => { loadSprites(); }, []);
  useEffect(() => { if (active && host.current) getScene().mount(host.current); }, [active, host]);
  useEffect(() => {
    if (!live) return;
    const p = partyUnits(live, g.ctx);
    getScene().update({
      units: Object.fromEntries(p.units.map(u => [u.k, u])), fed: huntHours(live, g.p) > 0 && p.units.length > 0,
      eff: efficiency(p, live.zone), dps: p.dps, zone: zoneDef(live.zone), bld: live.bld, daRunning: !!g.p.daRun.run,
      anyTrained: hunterKeys(g.data.topics).some(k => trained(g.ctx, k)),
    });
  }, [g, live]);
}

export function toggleDA(store: Store, village: VillageState | null) {
  if (daRun(store).run) {
    const r = stopDA(store, village);
    if (!r) return toast("That session was under a minute, so it wasn't logged");
    floatText(`+${fmtN(r.g)} gold`, "var(--ochre)");
    floatText(`+${(r.m / 60).toFixed(1)}h food`, "var(--ochre)", 22);
    toast(`Logged ${fmtHrs(r.m / 60)} of DataAnnotation. Your village earned ${fmtN(r.g)} gold.`);
  } else {
    startDA(store);
    toast("DataAnnotation timer started. Every minute earns gold for the village.");
  }
}

/** The game column: who you are, what the village is doing, and what to do next. */
export default function GamePanel() {
  const g = useGame();
  const { setQp, setVil, setDrawer, vil, tab } = useUi();
  const now = useNow(1000);
  const live = useLiveVillage(g, now);
  const host = useRef<HTMLDivElement>(null);
  useScene(g, live, host, vil === null);
  useEffect(() => {      // only animate while the map is on screen
    const el = host.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(es => { if (vil === null) getScene().setVisible(es[0].isIntersecting); });
    io.observe(el);
    return () => io.disconnect();
  }, [vil, tab]);

  const s = g.stats, lvl = levelFor(s.xp), lo = levelStart(lvl), hi = levelStart(lvl + 1);
  const pct = Math.round((s.xp - lo) / (hi - lo) * 100);
  const nFu = followUps(g.p, g.byId).length, nRev = dueReviews(g.p).length, got = Object.keys(g.p.unlocked).length;
  const run = g.p.daRun.run;
  const questsLeft = s.quests.filter(([, n, goal]) => n < goal).length;

  let status: React.ReactNode = null, hungry = false;
  if (live) {
    const p = partyUnits(live, g.ctx), food = huntHours(live, g.p), zone = zoneDef(live.zone).name;
    if (!p.units.length) status = <>Solve a LeetCode problem to recruit your first hunter.</>;
    else if (food <= 0) { hungry = true; status = <>Your hunters are asleep with no food. One application feeds them for 4 hours.</>; }
    else status = <>{p.units.length} {p.units.length === 1 ? "hunter is" : "hunters are"} out in {zone}, earning <b>{fmtN(goldPerHour(live, p))}</b> gold an hour. Food lasts <b>{fmtHrs(food)}</b>.</>;
  }

  return (
    <div className="game">
      <div className="game-head">
        <div>
          <p className="eyebrow">Level {lvl}</p>
          <h2 className="display">{titleFor(lvl)}</h2>
        </div>
        <div className="game-head-side">
          {s.streak > 0 && <span className="tag">{s.streak}-day streak</span>}
          <span className="tag quiet">{s.xp.toLocaleString()} XP</span>
        </div>
      </div>
      <div className="xpbar" role="progressbar" aria-label="XP to the next level" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: pct + "%" }} /></div>

      <div className="scene" ref={host} onClick={() => setVil("")} title="Open the village">
        {live && <div className="scene-chips">
          <span className="scene-chip">{zoneDef(live.zone).name}</span>
          <span className="scene-chip">{fmtN(goldNow(live, g.p))} gold</span>
        </div>}
      </div>
      {status && <p className={"sentence" + (hungry ? " moment" : "")}>{status}</p>}

      <div className="game-actions">
        <button className="pill primary big" onClick={() => setQp(true)}>Quick Play</button>
        <button className="pill big" onClick={() => setVil("")}>Village</button>
      </div>

      <section className="quests" aria-label="Today's quests">
        <p className={"eyebrow" + (questsLeft ? " moment-text" : "")}>{questsLeft ? "Today" : "Today, all done"}</p>
        <ul>{s.quests.map(([q, n, goal]) => (
          <li key={q} className={n >= goal ? "done" : ""}><span className="ck" aria-hidden>{n >= goal ? "✓" : ""}</span><span>{q}</span><span className="num">{Math.min(n, goal)} of {goal}</span></li>
        ))}</ul>
      </section>

      <button className={"da" + (run ? " on" : "")} onClick={() => toggleDA(g.store, live)}>
        <span><b>DataAnnotation</b><span className="sub">{run ? "Working. Tap to stop and log it." : "Start the timer when you start a task."}</span></span>
        <span className="num">{run ? fmtClock(now - run) : "Start"}</span>
      </button>

      <div className="game-links">
        <button className="link-btn" onClick={() => setDrawer("followups")}>Follow-ups{nFu ? <span className="count">{nFu}</span> : null}</button>
        <button className="link-btn" onClick={() => setDrawer("reviews")}>Reviews{nRev ? <span className="count">{nRev}</span> : null}</button>
        <button className="link-btn" onClick={() => setDrawer("badges")}>Badges {got} of {BADGES.length}</button>
      </div>
    </div>
  );
}
