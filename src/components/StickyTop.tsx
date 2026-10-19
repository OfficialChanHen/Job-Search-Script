"use client";
import { useEffect, useState } from "react";
import { copyText, floatText, toast } from "@/lib/client/effects";
import { daRun, startDA, stopDA } from "@/lib/game/da";
import { paceStats } from "@/lib/game/pace";
import { useGame } from "./GameContext";
import { useUi } from "./UiContext";

const MY_LINKS: [string, string][] = [
  ["LinkedIn", "https://linkedin.com/in/chan-hen-13727b233"],
  ["GitHub", "https://github.com/OfficialChanHen"],
  ["Portfolio", "https://chanhen.space"],
  ["Hourelle", "https://hourelle.com"],
];
export const fmtClock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
/** Re-render every `ms` (clocks and "last hour" counts). */
export function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function toggleDA(store: ReturnType<typeof useGame>["store"], village: ReturnType<typeof useGame>["village"]) {
  if (daRun(store).run) {
    const r = stopDA(store, village);
    if (!r) return toast("That session was under a minute, so it wasn't logged");
    floatText(`+${r.g.toLocaleString()} 🪙`, "var(--warn)");
    floatText(`+${(r.m / 60).toFixed(1)}h 🍖`, "var(--warn)", 22);
    toast(`💼 Logged ${Math.floor(r.m / 60)}h ${r.m % 60}m of DataAnnotation. Your village got ${r.g.toLocaleString()} gold.`);
  } else {
    startDA(store);
    toast("💼 DataAnnotation timer started. Every minute earns gold for your village.");
  }
}

export default function StickyTop() {
  const { p, store, village } = useGame();
  const { tool, setTool } = useUi();
  const now = useNow(1000);
  const pace = paceStats(p.status, now);
  const run = p.daRun.run;
  return (
    <div className="sb-top">
      <div className="my-links" aria-label="My links (tap to copy)">
        {MY_LINKS.map(([name, url]) => (
          <span className="my-link" key={name}>
            <button type="button" title={`Copy ${url}`} onClick={() => copyText(url, `📋 Copied your ${name} link`)}>{name} <span>{url.replace(/^https?:\/\//, "")}</span></button>
            <a href={url} target="_blank" rel="noopener" title={`Open ${name}`} aria-label={`Open ${name}`}>↗</a>
          </span>
        ))}
      </div>
      <button className="pace" onClick={() => setTool(tool === "pace" ? "" : "pace")} title="Applications today and your pace. Click for the hourly chart.">
        ✓ <b>{pace.todayCount}</b> applied today<span className="opt">, <b>{pace.lastHour}</b> in the last hour, {pace.avgMin ? `about ${Math.round(pace.avgMin)} min each` : `${pace.perHr.toFixed(1)} an hour`}</span>
      </button>
      <button className={"pace da-pill" + (run ? " on" : "")} onClick={() => toggleDA(store, village)}
        title="DataAnnotation work timer. Every hour of work earns gold and food for your village. Start it on one device and stop it on another.">
        {run ? <>💼 <b>{fmtClock(now - run)}</b> Stop</> : "💼 Start DataAnnotation"}
      </button>
    </div>
  );
}

export function PacePanel() {
  const { p } = useGame();
  const { tool } = useUi();
  const now = useNow(60_000);
  if (tool !== "pace") return null;
  const s = paceStats(p.status, now);
  const best = s.days.reduce((a, b) => b[1] > a[1] ? b : a, ["", 0] as [string, number]);
  const hourLbl = (h: number) => (h % 12 || 12) + (h < 12 ? "am" : "pm");
  const bars = (vals: number[], labels: string[]) => {
    const max = Math.max(...vals, 1);
    return vals.map((v, i) => <div key={i} className="bar" style={{ height: v ? Math.max(4, Math.round(v / max * 52)) : 0 }}>
      <span className="tip">{labels[i]}: {v} application{v === 1 ? "" : "s"}</span></div>);
  };
  return (
    <div className="settings pace-panel">
      <h2>⏱ Application pace</h2>
      <div className="pace-kpis">
        {[["Applied today", s.todayCount], ["Last hour", s.lastHour], ["Per hour", s.perHr.toFixed(1)],
          ["Avg time each", s.avgMin ? Math.round(s.avgMin) + " min" : "—"], ["Best day (7 days)", best[1]]].map(([l, v]) =>
          <div key={l}><div className="l">{l}</div><div className="v">{v}</div></div>)}
      </div>
      <div className="chart-head" style={{ marginTop: 12 }}><h2>Today, by hour</h2></div>
      <div className="hourbars">{bars(s.hours, s.hours.map((_, h) => hourLbl(h)))}</div>
      <div className="bar-axis"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
      <div className="chart-head" style={{ marginTop: 12 }}><h2>Last 7 days</h2></div>
      <div className="hourbars">{bars(s.days.map(d => d[1]), s.days.map(d => d[0]))}</div>
      <div className="bar-axis"><span>{s.days[0][0]}</span><span>today</span></div>
    </div>
  );
}
