"use client";
import { useState } from "react";
import type { Job } from "@/lib/data/types";
import { copyText, floatFood, floatXP } from "@/lib/client/effects";
import { liSearch, outreachMsg } from "@/lib/game/followups";
import { NS, toggleOutreach, type KitJob, type ResumeEntry } from "@/lib/game/progress";
import { STD_FIELDS, isGame, kitDrafts, knockouts, tellNote } from "@/lib/jobs/kit";
import { fitFor, shortName } from "@/lib/jobs/resumes";
import type { Store } from "@/lib/sync/store";

export function FitChip({ j, resumes }: { j: Job; resumes: ResumeEntry[] }) {
  const f = fitFor(j, resumes);
  if (!f) return null;
  const b = f.best;
  const tip = f.need.length ? `Covers ${b.have.length} of the ${f.need.length} skills this posting names` + (b.missing.length ? `. Not on it: ${b.missing.join(", ")}` : "") : "Best match for this role type";
  return <span className="chip flag-res" title={tip}>📄 {shortName(b.r.name)}{f.need.length ? `, ${b.have.length} of ${f.need.length} skills` : ""}</span>;
}

export function FitBox({ j, resumes }: { j: Job; resumes: ResumeEntry[] }) {
  const f = fitFor(j, resumes);
  if (!f) return <p className="none">Drop your resume PDFs into <b>📄 My resumes</b> (toolbar) to see which one fits this job best.</p>;
  return <>
    {f.all.map(x => (
      <div className="rrow" key={x.r.name}><span>{shortName(x.r.name)}{x === f.best ? " ⭐" : ""}</span>
        <div className="track"><div className="fill" style={{ width: Math.round(x.pct * 100) + "%" }} /></div>
        <span className="num">{f.need.length ? `${x.have.length}/${f.need.length} skills` : x.role >= 12 ? "built for this role" : x.role ? "suits this role" : "—"}</span></div>
    ))}
    {f.best.missing.length > 0 && <p className="src">Posting mentions, not on your <b>{shortName(f.best.r.name)}</b> resume: {f.best.missing.join(", ")}.
      Add one only if you&apos;ve actually used it. Interviewers ask about everything listed.</p>}
  </>;
}

export function RefPanel({ j, store, sent }: { j: Job; store: Store; sent: string | undefined }) {
  const [msg, setMsg] = useState(() => outreachMsg(j));
  const toggle = () => {
    const on = toggleOutreach(store, j.id);
    floatXP(on ? 30 : -30);
    if (on) floatFood(2);
  };
  return (
    <div className="ref">
      <b>🤝 Get a referral</b>. A note to someone on the team gets far more replies than a cold application.
      <div className="links">
        <a className="mini" href={liSearch(j.company + " University of Wisconsin")} target="_blank" rel="noopener">🎓 UW–Madison alumni</a>
        <a className="mini" href={liSearch(j.company + " recruiter")} target="_blank" rel="noopener">🧑‍💼 Recruiters</a>
        <a className="mini" href={liSearch(j.company + " software engineer")} target="_blank" rel="noopener">👩‍💻 Engineers</a>
      </div>
      <textarea value={msg} onChange={e => setMsg(e.target.value)} aria-label="Referral message" />
      <div className="row2">
        <span className={"cc" + (msg.length > 300 ? " over" : "")}>{msg.length} of 300 characters. LinkedIn connection notes max out at 300.</span>
        <span>
          <button className="mini" onClick={() => copyText(msg, "📋 Message copied. Paste it into LinkedIn.")}>📋 Copy message</button>{" "}
          <button className={"mini " + (sent ? "ok" : "primary")} onClick={toggle}>{sent ? `✓ Reached out ${sent.slice(5)}` : "✉ I reached out (+30 XP)"}</button>
        </span>
      </div>
    </div>
  );
}

function Draft({ j, store, k, label, resumes, kit }: { j: Job; store: Store; k: "why" | "you"; label: string; resumes: ResumeEntry[]; kit: KitJob | undefined }) {
  const saved = kit?.[k];
  const text = saved !== undefined ? saved : kitDrafts(j, resumes)[k];
  const t = tellNote(text);
  const set = (v: string | undefined) => {
    const cur = { ...(kit ?? {}) };
    if (v === undefined) delete cur[k]; else cur[k] = v;
    store.set(NS.kitJob, j.id, cur);
  };
  return (
    <div className="kdraft">
      <div className="khead"><b>{label}</b><span className={"tell" + (t.warn ? " warn" : "")}>{t.note}</span></div>
      <textarea value={text} onChange={e => set(e.target.value)} />
      <div className="row2">
        <button className="mini" onClick={() => set(undefined)}>↺ Start over</button>
        <button className="mini" onClick={() => copyText(text, "📋 Copied")}>📋 Copy</button>
      </div>
    </div>
  );
}

export function KitPanel({ j, store, resumes, kit, applied, onApplied }: { j: Job; store: Store; resumes: ResumeEntry[]; kit: KitJob | undefined; applied: boolean; onApplied: () => void }) {
  const std = (k: string) => store.get<string>(NS.kitStd, k) ?? STD_FIELDS.find(f => f[0] === k)?.[2] ?? "";
  const f = fitFor(j, resumes);
  return (
    <div className="kit">
      <div className="kcol">
        <h4>Before you apply</h4>
        <ul className="ko">{knockouts(j, std("grad")).map(([k, t], i) => <li key={i} className={k}>{k === "bad" ? "✕" : k === "warn" ? "!" : "✓"}<span>{t}</span></li>)}</ul>
        <h4>Resume to send</h4>
        {isGame(j) ? <p>Game role. Send your <b>Riot</b> resume with TANKS! near the top. In the resume editor, use <b>+ Copy variant</b> to make one named for {j.company}.</p>
          : f ? <>
            <p>Send <b>{shortName(f.best.r.name)}</b>{f.need.length ? ` (covers ${f.best.have.length} of ${f.need.length} skills named)` : ""}.</p>
            {f.best.missing.length > 0 && <p className="src">Not on it: {f.best.missing.join(", ")}. Leave those off unless you&apos;ve used them.</p>}
          </> : <p className="none">Add your resume PDFs in <b>📄 My resumes</b> and this picks the best one for each job.</p>}
        <details className="usual"><summary>Your usual answers, ready to copy</summary>
        <div className="stds">{STD_FIELDS.map(([k, label]) => (
          <label className="std" key={k}><span>{label}</span>
            <input defaultValue={std(k)} onBlur={e => store.set(NS.kitStd, k, e.target.value)} placeholder="—" />
            <button className="mini" title="Copy" onClick={e => copyText((e.currentTarget.previousElementSibling as HTMLInputElement).value)}>📋</button>
          </label>))}
        </div></details>
      </div>
      <div className="kcol">
        <h4>Short answers</h4>
        <p className="src">Starting points built from the posting. Rewrite them so they sound like you. The [bracketed] part is what a reader actually remembers.</p>
        <Draft j={j} store={store} k="why" label={`Why ${j.company || "this company"}?`} resumes={resumes} kit={kit} />
        <Draft j={j} store={store} k="you" label="About you, and why you fit" resumes={resumes} kit={kit} />
        <div className="kgo">
          <a className="mini primary" href={j.direct || j.url} target="_blank" rel="noopener">Open posting ↗</a>
          <button className={"mini " + (applied ? "ok" : "")} onClick={onApplied}>{applied ? "✓ Applied" : "I submitted it ✓"}</button>
        </div>
      </div>
    </div>
  );
}
