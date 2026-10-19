"use client";
import { memo, useState } from "react";
import type { Company, Job, Prep } from "@/lib/data/types";
import { floatFood, floatXP, toast } from "@/lib/client/effects";
import { NS, setStatus, toggleSolved, type JobStatus, type KitJob, type ResumeEntry, type SheetRow, type StatusEntry } from "@/lib/game/progress";
import { copySheetRow, pushToSheet, sheetRow } from "@/lib/jobs/sheet";
import type { Store } from "@/lib/sync/store";
import { FitBox, FitChip, KitPanel, RefPanel } from "./CardPanels";

const MODE: Record<string, string> = { onsite: "In person", hybrid: "Hybrid", remote: "Remote" };
const srcName = (s: string) => s.replace(/^GitHub\//, "").replace(/^JSearch\//, "");
const XP_FOR: Record<string, number> = { applied: 50, saved: 10 };
type Tab = "about" | "prep" | "kit" | "ref";

export interface CardProps {
  job: Job; prep: Prep | undefined; company: Company | undefined; status: StatusEntry | undefined;
  solved: Record<string, string>; sheetRow: SheetRow | undefined; latest: string; store: Store;
  sheetUrl: string; synced: boolean; resumes: ResumeEntry[]; kit: KitJob | undefined; outreach: string | undefined;
}

/** The one caution worth showing on the card itself; the rest live in the apply kit. */
function warning(j: Job): string {
  if (j.closed) return "Closed";
  const y = parseInt(j.exp, 10);
  if (!isNaN(y) && y >= 2) return `${y}+ years asked`;
  if (j.gradWindow) return "Check the grad window";
  if (j.reposts >= 3) return `Posted ${j.reposts} times`;
  if (j.stale) return "Over 30 days old";
  return "";
}

function About({ j, company, resumes, sheet }: { j: Job; company: Company | undefined; resumes: ResumeEntry[]; sheet: SheetRow | undefined }) {
  const m = j.sm || {};
  const list = (xs?: string[]) => xs?.length ? <ul>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul> : null;
  const d = j.drive;
  return (
    <div className="about">
      <section>
        {m.sum ? <p>{m.sum}</p> : <p className="dim">The full posting hasn&apos;t been read yet. It&apos;s read during the morning run.</p>}
        {m.do && <><h4 className="eyebrow">What you&apos;d do</h4>{list(m.do)}</>}
        {m.need && <><h4 className="eyebrow">What they want</h4>{list(m.need)}</>}
        <div className="chips-row">
          {m.pay && <span className="tag good">{m.pay}</span>}
          {(m.stack || j.chips).slice(0, 8).map(t => <span key={t} className="tag quiet">{t}</span>)}
        </div>
        {d && <p className="dim">{Math.round(d.mi)} miles from Shakopee, about {d.min} minutes round trip and ${d.cost.toFixed(2)} of gas a shift.
          {d.eff != null ? ` After driving it pays about $${d.eff.toFixed(2)} an hour.` : " Pay isn't listed."}</p>}
        <p className="dim">Found on {j.source} on {j.date}.{sheet?.status ? ` Your sheet says: ${sheet.status}.` : ""}</p>
      </section>
      <section>
        <h4 className="eyebrow">{j.company || "The company"}</h4>
        {company?.s ? <p>{company.s}</p> : <p className="dim">No description found. <a href={`https://www.google.com/search?q=${encodeURIComponent(j.company + " company")}`} target="_blank" rel="noopener">Search for {j.company}</a>.</p>}
        <h4 className="eyebrow">Resume fit</h4>
        <FitBox j={j} resumes={resumes} />
      </section>
    </div>
  );
}

function PrepPanel({ prep, solved, store }: { prep: Prep; solved: Record<string, string>; store: Store }) {
  const tick = (n: number) => {
    const now = toggleSolved(store, n);
    floatXP(now ? 20 : -20);
    if (now) floatFood(2);
  };
  return (
    <div className="prep">
      <p><b>{prep.coding ? "A coding interview is likely." : "Usually no coding interview."}</b> {prep.focus}</p>
      {prep.problems.length ? <>
        <ul className="checks">{prep.problems.map(([n, name, url]) => (
          <li key={n} className={solved[n] ? "done" : ""}>
            <label><input type="checkbox" checked={!!solved[n]} onChange={() => tick(n)} aria-label={`Mark #${n} solved`} />
              <a href={url} target="_blank" rel="noopener">#{n} {name}</a></label>
          </li>))}
        </ul>
        <p className="dim">Each solve is 20 XP, 2 hours of food, and training for that topic&apos;s hunter.</p>
      </> : null}
    </div>
  );
}

function JobCard({ job: j, prep, company, status, solved, sheetRow: sheet, latest, store, sheetUrl, synced, resumes, kit, outreach }: CardProps) {
  const [tab, setTab] = useState<Tab | null>(null);
  const s = status?.s || "";
  const set = (next: JobStatus | "") => {
    setStatus(store, j.id, next);
    floatXP((XP_FOR[next] || 0) - (XP_FOR[s] || 0));
    if (next === "applied" && s !== "applied") {
      floatFood(4);
      if (sheetUrl && !synced) pushToSheet(sheetUrl, j, prep)
        .then(() => { store.set(NS.synced, j.id, 1); toast("Added to your Google Sheet: " + j.company); })
        .catch(() => toast("Couldn't add it to the sheet. Check the URL in Tools.", true));
    }
  };
  const copyRow = () => copySheetRow(sheetRow(j, prep, s === "saved" ? "Saved" : "Applied").map(String))
    .then(() => toast("Copied. Paste it into a blank row of your sheet."), () => toast("Couldn't copy", true));
  const warn = warning(j), href = j.direct || j.url;
  const tabs: [Tab, string][] = [["about", "About"], ["prep", prep?.coding ? "LeetCode" : "Prep"], ["kit", "Apply kit"], ["ref", outreach ? "Referral ✓" : "Referral"]];
  return (
    <article className={"job" + (s ? " " + s : "") + (j.closed ? " closed" : "")}>
      <div className="job-main">
        <h3><a href={href} target="_blank" rel="noopener">{j.title}</a></h3>
        <p className="job-meta">{j.company || "Unknown company"}<span className="sep" aria-hidden /> {j.location}</p>
        <div className="chips-row">
          {j.date === latest && <span className="tag accent">New</span>}
          <span className={"tag" + (j.jobType === "Full-time" ? "" : " quiet")}>{j.jobType || "Type not listed"}</span>
          {MODE[j.mode] && <span className="tag quiet">{MODE[j.mode]}</span>}
          {j.exp && !(parseInt(j.exp, 10) >= 2) && <span className="tag quiet">{j.exp.replace(/\byrs?\b/, m => m === "yr" ? "year" : "years")}</span>}
          {warn && <span className="tag caution">{warn}</span>}
          <FitChip j={j} resumes={resumes} />
        </div>
      </div>
      <div className="job-side">
        <span className="match" title="How well it fits: skills, entry level, full-time, in person, a direct company link">{j.score} match</span>
      </div>
      <div className="job-actions">
        <a className="pill primary" href={href} target="_blank" rel="noopener"><span className="long">{j.direct ? "Apply on their site" : `Apply on ${srcName(j.source)}`}</span><span className="short">Apply</span></a>
        <button className={"pill" + (s === "applied" ? " on good" : "")} onClick={() => set(s === "applied" ? "" : "applied")}>{s === "applied" ? `Applied ${status!.t.slice(5)}` : "I applied"}</button>
        <button className={"pill" + (s === "saved" ? " on" : "")} onClick={() => set(s === "saved" ? "" : "saved")}>{s === "saved" ? "Saved" : "Save"}</button>
        <button className={"link-btn" + (tab ? " on" : "")} onClick={() => setTab(t => t ? null : "about")} aria-expanded={!!tab}>{tab ? "Hide details" : "Details"}</button>
      </div>
      {tab && (
        <div className="details">
          <div className="pencil-tabs" role="tablist">
            {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          {tab === "about" && <About j={j} company={company} resumes={resumes} sheet={sheet} />}
          {tab === "prep" && prep && <PrepPanel prep={prep} solved={solved} store={store} />}
          {tab === "kit" && <KitPanel j={j} store={store} resumes={resumes} kit={kit} applied={s === "applied"} onApplied={() => set(s === "applied" ? "" : "applied")} />}
          {tab === "ref" && <RefPanel j={j} store={store} sent={outreach} />}
          <div className="details-foot">
            <button className="link-btn" onClick={copyRow}>Copy as a sheet row</button>
            {!j.direct && <a className="link-btn" target="_blank" rel="noopener"
              href={"https://www.google.com/search?q=" + encodeURIComponent(`"${j.title}" "${j.company}" (site:greenhouse.io OR site:lever.co OR site:ashbyhq.com OR site:myworkdayjobs.com OR careers)`)}>Find it on their site</a>}
            <button className="link-btn" onClick={() => set(s === "hidden" ? "" : "hidden")}>{s === "hidden" ? "Show it again" : "Hide this job"}</button>
          </div>
        </div>
      )}
    </article>
  );
}
export default memo(JobCard);
