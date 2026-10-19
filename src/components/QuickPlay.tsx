"use client";
import { useEffect, useRef, useState } from "react";
import type { Job, JobData } from "@/lib/data/types";
import { confetti, floatFood, floatText } from "@/lib/client/effects";
import { addTriage, setStatus, type StatusEntry } from "@/lib/game/progress";
import type { Store } from "@/lib/sync/store";
import { useUi } from "./UiContext";

const TIPS = [
  "Tailor the top 3 resume bullets to the job title. It's the part recruiters actually read.",
  "Apply within 48 hours of a posting going live; early applicants get screened first.",
  "Found someone on the team? A 2-line LinkedIn note beats a cover letter.",
  "Local roles have far fewer applicants than remote ones.",
  "One LeetCode medium a day beats a 6-hour weekend cram.",
  "“Engineer I” and “Associate” roles don't care when you graduated, only that you're early career.",
  "Say your approach out loud while you code. Interviewers grade communication too.",
  "Keep a STAR story ready for a bug you fixed, a conflict, and something you shipped.",
];
const REDUCED = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const MODE = { onsite: "🏢 In-person", hybrid: "🔀 Hybrid", remote: "🌐 Remote", "": "" } as const;

/** Triage the current tab one job at a time: ← pass, ↑ save, → open and apply. */
export default function QuickPlay({ rows, status, data, store, solved }:
  { rows: Job[]; status: Record<string, StatusEntry>; data: JobData; store: Store; solved: Record<string, string> }) {
  const { qp, setQp } = useUi();
  if (!qp) return null;
  return <Deck initial={rows.filter(j => !status[j.id])} data={data} store={store} solved={solved} close={() => setQp(false)} />;
}

function Deck({ initial, data, store, solved, close }: { initial: Job[]; data: JobData; store: Store; solved: Record<string, string>; close: () => void }) {
  const [deck] = useState(initial);         // fixed for this session, so marking jobs doesn't reshuffle it
  const [i, setI] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [fly, setFly] = useState("");
  const [combo, setCombo] = useState(0);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  const lastAt = useRef(0), busy = useRef(false), card = useRef<HTMLDivElement>(null);
  const j = deck[i];

  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);
  useEffect(() => { if (!j && deck.length) confetti(200); }, [j, deck.length]);

  const next = (dir: "left" | "up" | "right", xp: number) => {
    const now = Date.now();
    const c = now - lastAt.current < 12000 ? combo + 1 : 1;
    lastAt.current = now; setCombo(c);
    addTriage(store);
    const r = card.current?.getBoundingClientRect();
    if (r) floatText(`+${xp + 2} XP`, undefined, 0);
    if (c > 0 && c % 10 === 0) confetti(90);
    busy.current = true; setFly("fly-" + dir);
    setTimeout(() => { setI(x => x + 1); setFly(""); setConfirming(false); busy.current = false; }, REDUCED ? 0 : 230);
  };
  const act = (a: string) => {
    if (!j || busy.current) return;
    if (a === "pass" || a === "nope") { setStatus(store, j.id, "hidden"); next("left", 0); }
    else if (a === "save" || a === "later") { setStatus(store, j.id, "saved"); next("up", 10); }
    else if (a === "apply") { window.open(j.direct || j.url, "_blank", "noopener"); setConfirming(true); }
    else if (a === "yes") { setStatus(store, j.id, "applied"); floatFood(4); next("right", 50); }
  };
  const actRef = useRef(act);
  useEffect(() => { actRef.current = act; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, string> = confirming
        ? { Enter: "yes", ArrowUp: "later", Backspace: "later", ArrowLeft: "nope" }
        : { ArrowLeft: "pass", ArrowUp: "save", ArrowRight: "apply" };
      if (e.key === "Escape") close();
      else if (map[e.key]) actRef.current(map[e.key]);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, close]);

  const p = j ? data.preps[j.prep] : undefined, co = j?.ck ? data.companies[j.ck] : undefined;
  return (
    <div className="qp" role="dialog" aria-modal="true" aria-label="Quick Play">
      <div className="qp-top"><span>{j ? `${deck.length - i} left in this view` : ""}</span><span className="qp-combo">{combo >= 3 ? `🔥 combo ×${combo}` : ""}</span><button onClick={close}>✕ Esc</button></div>
      <div className={"qp-card " + fly} ref={card}>
        {!j ? <div className="empty-deck">🎉 <b>Inbox zero!</b><br /><span className="count-note">You&apos;ve triaged every job in this view. Try another tab or job type.</span></div> : <>
          <div className="top">
            <div><h3>{j.title}</h3><div className="meta"><span className="co">{j.company || "—"}</span><span className="dot">📍</span>{j.location}</div></div>
            <div className={"score" + (j.score >= 10 ? " hot" : "")}>{j.score}<small>match</small></div>
          </div>
          <div className="badges">
            {j.direct && j.direct !== j.url && <span className="chip flag-direct">🔗 Company site</span>}
            <span className={"chip " + (j.jobType === "Full-time" ? "type-ft" : "type-other")}>{j.jobType || "Type ?"}</span>
            {MODE[j.mode] && <span className="chip flag-src">{MODE[j.mode]}</span>}
            <span className="chip flag-src">{j.catLabel}</span>
            {j.exp && <span className="chip flag-src">🎓 {j.exp}</span>}
            {j.chips.slice(0, 6).map(c => <span key={c} className="chip">{c}</span>)}
          </div>
          {j.sm && (j.sm.sum || j.sm.do) && <div className="sumline">{(j.sm.sum || "").slice(0, 260)}{j.sm.do && <ul>{j.sm.do.slice(0, 2).map((x, k) => <li key={k}>{x}</li>)}</ul>}</div>}
          {co?.s && <div className="coline">🏢 {co.s.slice(0, 220)}</div>}
          {p && <div className="focus"><b>{p.coding ? "🧠 Coding interview likely" : "🗣 Usually no coding round"}</b>. {p.focus}
            {p.problems.length > 0 && <ol>{p.problems.slice(0, 3).map(([n, name]) => <li key={n}>{solved[n] ? "✅ " : ""}#{n} {name}</li>)}</ol>}</div>}
        </>}
      </div>
      {j && !confirming && <div className="qp-controls">
        <button className="pass" onClick={() => act("pass")}>← Pass</button>
        <button className="save" onClick={() => act("save")}>↑ Save</button>
        <button className="go" onClick={() => act("apply")}>Open and apply →</button>
      </div>}
      {j && confirming && <div className="qp-confirm">
        <p>Did you submit the application?</p>
        <button className="yes" onClick={() => act("yes")}>✓ Yes, applied <small>(Enter)</small></button>
        <button onClick={() => act("later")}>Not yet, save it <small>(↑)</small></button>
        <button className="pass" onClick={() => act("nope")}>✕ Didn&apos;t apply, pass <small>(←)</small></button>
      </div>}
      <div className="qp-hint">Keys: ← pass, ↑ save, → open and apply. After opening: Enter if you applied, ↑ to save, ← to pass. Esc exits. Uses your current tab and filters.</div>
      <div className="qp-tip">💡 {tip}</div>
    </div>
  );
}
