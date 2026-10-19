"use client";
import { useState } from "react";
import { BADGES, levelFor, levelStart, titleFor } from "@/lib/game/xp";
import { useGame } from "./GameContext";

/** Level, XP, daily quests, streak and badges. */
export default function Hud() {
  const { stats: s, p } = useGame();
  const [showBadges, setShowBadges] = useState(false);
  const lvl = levelFor(s.xp), lo = levelStart(lvl), hi = levelStart(lvl + 1);
  const pct = Math.round((s.xp - lo) / (hi - lo) * 100);
  const got = Object.keys(p.unlocked).length;
  return (
    <>
      <section className="hud" aria-label="Job hunt progress">
        <div className="hud-player">
          <div className="lvl"><small>Lv</small>{lvl}</div>
          <div className="hud-main">
            <div className="hud-title"><span>{titleFor(lvl)}</span><span className="xp">{s.xp.toLocaleString()} XP</span></div>
            <div className="xpbar" role="progressbar" aria-label="XP to next level" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: pct + "%" }} />
            </div>
            <div className="hud-next">{(hi - s.xp).toLocaleString()} XP to level {lvl + 1}. Applying earns 50, solving 20, outreach 30, an interview 200.</div>
          </div>
        </div>
        <div>
          <div className="hud-h">Daily quests <span className="streak">{s.streak ? `🔥 ${s.streak}-day streak` : "Start a streak today"}</span></div>
          <ul className="quests">
            {s.quests.map(([q, n, goal]) => (
              <li key={q} className={n >= goal ? "done" : ""}>
                <span className="ck">{n >= goal ? "✓" : ""}</span><span className="q">{q}</span><span className="n">{Math.min(n, goal)}/{goal}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="hud-side">
          <button className="badge-btn" onClick={() => setShowBadges(b => !b)} aria-expanded={showBadges}>🏆 {got}/{BADGES.length} badges</button>
        </div>
      </section>
      {showBadges && (
        <div className="badges-panel">
          {BADGES.map(([id, ico, name, desc]) => (
            <div key={id} className={"badge" + (p.unlocked[id] ? " got" : "")}>
              <span className="ico">{ico}</span>
              <div><b>{name}</b><span>{p.unlocked[id] ? "Unlocked " + p.unlocked[id] : desc}</span></div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
