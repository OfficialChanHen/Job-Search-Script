"use client";
import { memo, useState } from "react";
import type { Company, Job, Prep } from "@/lib/data/types";
import { confetti, floatFood, floatXP, toast } from "@/lib/client/effects";
import { NS, setStatus, toggleSolved, type JobStatus, type KitJob, type ResumeEntry, type SheetRow, type StatusEntry } from "@/lib/game/progress";
import { FitBox, FitChip, KitPanel, RefPanel } from "./CardPanels";
import { copySheetRow, pushToSheet, sheetRow } from "@/lib/jobs/sheet";
import type { Store } from "@/lib/sync/store";

const MODE = { onsite: "🏢 In-person", hybrid: "🔀 Hybrid", remote: "🌐 Remote", "": "" } as const;
const srcName = (s: string) => s.replace(/^GitHub\//, "").replace(/^JSearch\//, "");
const XP_FOR: Record<string, number> = { applied: 50, saved: 10 };

export interface CardProps {
  job: Job;
  prep: Prep | undefined;
  company: Company | undefined;
  status: StatusEntry | undefined;
  solved: Record<string, string>;
  sheetRow: SheetRow | undefined;
  latest: string;
  store: Store;
  sheetUrl: string;
  synced: boolean;
  resumes: ResumeEntry[];
  kit: KitJob | undefined;
  outreach: string | undefined;
}

function Chips({ j, latest, sheet, resumes }: { j: Job; latest: string; sheet: SheetRow | undefined; resumes: ResumeEntry[] }) {
  const d = j.drive;
  return (
    <div className="badges">
      {j.date === latest && <span className="chip flag-new">NEW</span>}
      {j.direct && j.direct !== j.url && <span className="chip flag-direct" title="Found the posting on the company's own site">🔗 Company site</span>}
      <span className={"chip " + (j.jobType === "Full-time" ? "type-ft" : "type-other")}>{j.jobType || "Type ?"}</span>
      {MODE[j.mode] && <span className="chip flag-src">{MODE[j.mode]}</span>}
      <span className="chip flag-src">{j.catLabel}</span>
      {j.exp && <span className="chip flag-src">🎓 {j.exp}</span>}
      {j.closed && <span className="chip flag-closed" title="No longer on the company's job board">⛔ Closed</span>}
      {j.reposts >= 3 && <span className="chip flag-warn" title={`Same title, company and location posted on ${j.reposts} different days. High-volume hiring, or an evergreen listing. Worth a referral before applying.`}>🔁 Posted {j.reposts}×</span>}
      {j.stale && <span className="chip flag-src" title="Found 30+ days ago and this source can't be re-checked. It may be filled.">📅 30+ days old</span>}
      {sheet?.status && <span className="chip flag-sheet">📗 {sheet.status}</span>}
      {d && <span className="chip flag-src" title={`From Shakopee: about ${d.mi} road miles each way, ${d.min} min round trip, $${d.cost.toFixed(2)} gas and wear per shift`}>🚗 {Math.round(d.mi)} mi, ${d.cost.toFixed(2)} a shift, {d.min} min round trip</span>}
      {d && (d.eff != null
        ? <span className={"chip " + (d.ok ? "type-ft" : "flag-warn")} title={`Pays $${d.pay?.toFixed(2)}/hr. Over a 4-hour shift, after gas and drive time: $${d.eff.toFixed(2)}/hr`}>💵 ${d.eff.toFixed(2)}/hr after driving{d.ok ? "" : " (borderline)"}</span>
        : <span className="chip flag-src" title="The posting doesn't list pay. Check it before driving far.">💵 pay not listed</span>)}
      <FitChip j={j} resumes={resumes} />
      {j.gradWindow && <span className="chip flag-warn" title="New-grad posting. Check the required graduation window; many also accept grads within 12 to 24 months.">⚠ check grad window</span>}
      {j.chips.map(c => <span key={c} className="chip">{c}</span>)}
      <span className="chip muted">{j.source}, {j.date}</span>
    </div>
  );
}

function SummaryPanel({ j, company, resumes }: { j: Job; company: Company | undefined; resumes: ResumeEntry[] }) {
  const m = j.sm || {};
  const list = (xs?: string[]) => xs?.length ? <ul>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul> : null;
  return (
    <div className="sumbox three">
      <div>
        <h4>📄 The job</h4>
        {m.sum || m.do || m.need ? <>
          {m.sum && <p>{m.sum}</p>}
          {m.do && <><h4>What you&apos;d do</h4>{list(m.do)}</>}
          {m.need && <><h4>What they want</h4>{list(m.need)}</>}
          <div className="kv">
            {j.exp && <span className="chip flag-src">🎓 {j.exp}</span>}
            {m.pay && <span className="chip type-ft">💵 {m.pay}</span>}
            {(m.stack || []).map(t => <span key={t} className="chip">{t}</span>)}
          </div>
        </> : <p className="none">The full posting hasn&apos;t been read yet (that happens in the daily run). Open it with Apply.</p>}
      </div>
      <div>
        <h4>🏢 {j.company || "The company"}</h4>
        {company?.s ? <>
          <p>{company.s}</p>
          <div className="src">Source: {company.src === "Wikipedia" && company.u ? <a href={company.u} target="_blank" rel="noopener">Wikipedia</a> : "the job posting"}</div>
        </> : <>
          <p className="none">No company description found.</p>
          <div className="src"><a href={`https://www.google.com/search?q=${encodeURIComponent(j.company + " company")}`} target="_blank" rel="noopener">Search {j.company} ↗</a></div>
        </>}
      </div>
      <div><h4>🎯 Resume fit</h4><FitBox j={j} resumes={resumes} /></div>
    </div>
  );
}

function PrepPanel({ prep, solved, store }: { prep: Prep; solved: Record<string, string>; store: Store }) {
  const tick = (n: number) => {
    const now = toggleSolved(store, n);
    floatXP(now ? 20 : -20);
    if (now) { floatFood(2); confetti(24); }
  };
  return (
    <div className="prep">
      <div className="focus"><strong>{prep.coding ? "Coding interview likely." : "Usually no coding interview."}</strong> {prep.focus}</div>
      {prep.problems.length ? <>
        <ol>{prep.problems.map(([n, name, url]) => (
          <li key={n} className={solved[n] ? "solved" : ""}>
            <label><input type="checkbox" checked={!!solved[n]} onChange={() => tick(n)} aria-label={`Mark #${n} solved`} />
              <a href={url} target="_blank" rel="noopener">#{n} {name}</a></label>
          </li>))}
        </ol>
        <div className="solved-note">Tick a problem when you solve it: +20 XP and 2 hours of food for your hunters. It stays ticked on every job.</div>
      </> : <div className="none">No LeetCode needed for this role type.</div>}
    </div>
  );
}

function JobCard({ job: j, prep, company, status, solved, sheetRow: sheet, latest, store, sheetUrl, synced, resumes, kit, outreach }: CardProps) {
  const [open, setOpen] = useState<{ sum?: boolean; prep?: boolean; kit?: boolean; ref?: boolean }>({});
  const s = status?.s || "";
  const set = (next: JobStatus | "") => {
    setStatus(store, j.id, next);
    floatXP((XP_FOR[next] || 0) - (XP_FOR[s] || 0));
    if (next === "applied" && s !== "applied") {
      floatFood(4);
      if (sheetUrl && !synced) pushToSheet(sheetUrl, j, prep)
        .then(() => { store.set(NS.synced, j.id, 1); toast("✓ Added to Google Sheet: " + j.company); })
        .catch(() => toast("Sheet sync failed. Check the URL.", true));
    }
  };
  const copyRow = () => copySheetRow(sheetRow(j, prep, s === "saved" ? "Saved" : "Applied").map(String))
    .then(() => toast("📋 Copied. Click a blank row's first cell in your sheet and paste."), () => toast("Copy failed", true));
  const cls = (s === "applied" ? "job applied" : s === "saved" ? "job saved" : "job") + (j.closed ? " is-closed" : "");
  return (
    <div className={cls}>
      <div className={"score" + (j.score >= 10 ? " hot" : "")} title="Match score: skills, entry-level, full-time, in-person, direct company link">{j.score}<small>match</small></div>
      <div>
        <h3><a href={j.direct || j.url} target="_blank" rel="noopener">{j.title}</a></h3>
        <div className="meta"><span className="co">{j.company || "—"}</span><span className="dot">📍</span>{j.location}</div>
        <Chips j={j} latest={latest} sheet={sheet} resumes={resumes} />
        <div className="actions">
          <button className={s === "applied" ? "on-applied" : ""} onClick={() => set(s === "applied" ? "" : "applied")}>✓ Applied{s === "applied" && status ? " " + status.t.slice(5) : ""}</button>
          <button className={s === "saved" ? "on-saved" : ""} onClick={() => set(s === "saved" ? "" : "saved")}>★ Save{s === "saved" ? "d" : ""}</button>
          <button className={open.sum ? "on" : ""} onClick={() => setOpen(o => ({ ...o, sum: !o.sum }))}>📄 Summary</button>
          <button className={open.prep ? "on" : ""} onClick={() => setOpen(o => ({ ...o, prep: !o.prep }))}>{prep?.coding ? "🧠 LeetCode prep" : "🧠 Interview prep"}</button>
          <button className={open.kit ? "on" : ""} onClick={() => setOpen(o => ({ ...o, kit: !o.kit }))}>🎒 Apply kit</button>
          <button className={open.ref ? "on" : ""} onClick={() => setOpen(o => ({ ...o, ref: !o.ref }))}>🤝 Referral{outreach ? " ✓" : ""}</button>
          <button onClick={copyRow} title="Copy as a row for your Google Sheet">📋 Copy row</button>
          <button onClick={() => set(s === "hidden" ? "" : "hidden")}>{s === "hidden" ? "↩ Unhide" : "Hide"}</button>
        </div>
      </div>
      <div className="apply-col">
        {j.direct ? <>
          <a className="apply-btn" href={j.direct} target="_blank" rel="noopener" title="The company's own posting">Apply ↗</a>
          {j.direct !== j.url && <a className="via" href={j.url} target="_blank" rel="noopener">via {srcName(j.source)}</a>}
        </> : <>
          <a className="apply-btn" href={j.url} target="_blank" rel="noopener">Apply on {srcName(j.source)} ↗</a>
          <a className="via" target="_blank" rel="noopener" title="Search for this exact role on the company's career site"
             href={"https://www.google.com/search?q=" + encodeURIComponent(`"${j.title}" "${j.company}" (site:greenhouse.io OR site:lever.co OR site:ashbyhq.com OR site:myworkdayjobs.com OR site:icims.com OR site:smartrecruiters.com OR site:workable.com OR careers)`)}>🔎 Find on company site</a>
        </>}
      </div>
      {open.sum && <SummaryPanel j={j} company={company} resumes={resumes} />}
      {open.prep && prep && <PrepPanel prep={prep} solved={solved} store={store} />}
      {open.ref && <RefPanel j={j} store={store} sent={outreach} />}
      {open.kit && <KitPanel j={j} store={store} resumes={resumes} kit={kit} applied={s === "applied"} onApplied={() => set(s === "applied" ? "" : "applied")} />}
    </div>
  );
}
export default memo(JobCard);
