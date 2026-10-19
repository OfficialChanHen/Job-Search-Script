"use client";
import { useRef, useState } from "react";
import { copyText, floatFood, floatXP, toast } from "@/lib/client/effects";
import { loadSheetRows } from "@/lib/client/sheetRows";
import { FOLLOW_UP_DAYS, followMsg, followUps, liSearch } from "@/lib/game/followups";
import { NS, markFollowed, markReviewed, type ResumeEntry } from "@/lib/game/progress";
import { breakdown, byMonth, channelOf, placeOf, roleOf, sheetStats, type Group } from "@/lib/game/results";
import { REVIEW_GAPS, dueReviews } from "@/lib/game/reviews";
import { localDay } from "@/lib/game/time";
import { compileVocab, shortName, skillsIn } from "@/lib/jobs/resumes";
import { SHEET_COLS, isAppsScriptUrl, pushToSheet, sheetRow } from "@/lib/jobs/sheet";
import { useGame } from "./GameContext";
import { useUi } from "./UiContext";

/* ═══ side panels under the progress card ═══════════════════════ */
export function SidePanel() {
  const { side, setSide } = useUi();
  if (!side) return null;
  const close = <button className="mini" onClick={() => setSide("")}>Close</button>;
  return (
    <div className="side-panel">
      {side === "followups" && <FollowUps close={close} />}
      {side === "reviews" && <Reviews close={close} />}
      {side === "results" && <Results close={close} />}
    </div>
  );
}

function FollowUps({ close }: { close: React.ReactNode }) {
  const { p, byId, store } = useGame();
  const list = followUps(p, byId);
  const mark = (key: string, how: "done" | "skip") => {
    markFollowed(store, key, how);
    if (how === "done") { floatXP(15); floatFood(2); }
  };
  return <>
    <h2>📬 Follow-ups due {close}</h2>
    <div className="lead">Applications {FOLLOW_UP_DAYS}+ days old with no reply. A short, polite nudge to the recruiter (or the person you messaged) revives a surprising number. Following up earns 15 XP and 2 hours of food.</div>
    <div className="fu-list">
      {list.length ? list.map(f => (
        <div className="fu" key={f.key}>
          <div><b>{f.company}</b>, {f.title}<div className="sub2">Applied {f.date}, {f.days} days ago</div></div>
          <div className="btns">
            <a className="mini" href={liSearch(f.company + " recruiter")} target="_blank" rel="noopener">🧑‍💼 Find recruiter</a>
            <button className="mini" onClick={() => copyText(followMsg(f), "📋 Follow-up message copied")}>📋 Message</button>
            <button className="mini ok" onClick={() => mark(f.key, "done")}>✓ Followed up</button>
            <button className="mini" onClick={() => mark(f.key, "skip")}>Dismiss</button>
          </div>
        </div>
      )) : <div className="lead">🎉 Nothing due. You&apos;re on top of it.</div>}
    </div>
  </>;
}

function Reviews({ close }: { close: React.ReactNode }) {
  const { p, store, data } = useGame();
  const info = (n: number) => {
    for (const t of Object.values(data.topics)) { const x = t.problems.find(([m]) => m === n); if (x) return x; }
    for (const pr of data.preps) { const x = pr.problems.find(([m]) => m === n); if (x) return x; }
    return [n, "Problem", "https://leetcode.com/problemset/"] as const;
  };
  const list = dueReviews(p);
  return <>
    <h2>🔁 LeetCode reviews due {close}</h2>
    <div className="lead">Solved problems come back after 3, 7 and 14 days so they stick for interviews. Re-solve from scratch, then mark it. Each review earns 10 XP, an hour of food, and trains that topic&apos;s hunter.</div>
    <div className="fu-list">
      {list.length ? list.map(r => { const [, name, url] = info(r.n); return (
        <div className="fu" key={r.n}>
          <div><b>#{r.n} {name}</b><div className="sub2">Review {r.stage + 1} of {REVIEW_GAPS.length}, due {r.due}</div></div>
          <div className="btns">
            <a className="mini primary" href={url} target="_blank" rel="noopener">Open ↗</a>
            <button className="mini ok" onClick={() => { markReviewed(store, r.n); floatXP(10); floatFood(1); }}>✓ Reviewed</button>
          </div>
        </div>); })
        : <div className="lead">Nothing due. Solve problems from any job&apos;s 🧠 prep panel or a hunter&apos;s training list and they&apos;ll show up here on schedule.</div>}
    </div>
  </>;
}

function Results({ close }: { close: React.ReactNode }) {
  const { store, p } = useGame();
  const url = store.get<string>(NS.pref, "sheetUrl");
  const refresh = <button className="mini" onClick={() => loadSheetRows(store, true)}>↻ Refresh</button>;
  const head = <h2>📈 Your results <span>{refresh} {close}</span></h2>;
  if (!url) return <>{head}<div className="lead">Connect your sheet in <b>⚙ Sheet sync</b> first. Results come from its Status column.</div></>;
  const { rows, c, positive } = sheetStats(p.sheetRows);
  if (!rows.length) return <>{head}<div className="lead">No rows loaded yet. Click <b>↻ Refresh</b>. If it keeps failing, redeploy the latest <code>Code.gs</code>.</div></>;
  const decided = rows.length - c.pending, rate = decided ? Math.round(positive / decided * 100) : 0;
  const segs: [string, number, string][] = [["Interview or offer", positive, "var(--good-mark)"], ["Rejected", c.rejected, "var(--crit)"],
    ["No reply (incl. 30+ days)", c.noreply, "var(--baseline)"], ["Waiting (under 30 days)", c.pending, "var(--series-1)"]];
  const table = (title: string, list: [string, Group][]) => (
    <div><h3>{title}</h3>{list.map(([k, v]) => {
      const r = v.decided ? v.pos / v.decided : 0;
      return <div className="rrow" key={k}><span>{k}</span>
        <div className="track"><div className="fill" style={{ width: Math.max(r ? 4 : 0, Math.round(r * 100)) + "%" }} /></div>
        <span className="num">{v.decided ? `${v.pos}/${v.decided} got interviews` : `${v.n} waiting`}{v.n < 5 && <span className="small"> (small sample)</span>}</span></div>;
    })}</div>);
  const byChannel = breakdown(rows, r => channelOf(r.url));
  const best = byChannel.filter(([, v]) => v.decided >= 5).sort((a, b) => b[1].pos / b[1].decided - a[1].pos / a[1].decided)[0];
  return <>
    {head}
    <div className="lead">From your tracker sheet&apos;s Status column. &quot;Applied&quot; rows older than 30 days count as no reply.</div>
    <div className="res-kpis">
      {[["Applications", rows.length], ["Interview rate", rate + "%"], ["Interviews", positive], ["Rejected", c.rejected], ["No reply", c.noreply]].map(([l, v]) =>
        <div key={l}><div className="l">{l}</div><div className="v">{v}</div></div>)}
    </div>
    <div className="stack" role="img" aria-label="Outcomes">{segs.filter(s => s[1]).map(([l, n, col]) => <span key={l} title={`${l}: ${n}`} style={{ flex: n, background: col }} />)}</div>
    <div className="legend">{segs.map(([l, n, col]) => <span key={l}><i style={{ background: col }} />{l} <b className="num">{n}</b></span>)}</div>
    <div className="res-grid">
      {table("By channel", byChannel)}
      {table("By location", breakdown(rows, r => placeOf(r.location)))}
      {table("By role type", breakdown(rows, r => roleOf(r.title)))}
      {table("By month applied", byMonth(rows))}
    </div>
    <div className="insight">💡 {best && best[1].pos
      ? <>Best channel so far: <b>{best[0]}</b>. {best[1].pos} of {best[1].decided} decided applications got an interview. Lean into it.</>
      : <>No channel with 5+ decided applications has produced an interview yet. The fix is usually <b>who sees your application</b>, not how many you send. Use 🤝 referrals and 📬 follow-ups on your next applications.</>}</div>
  </>;
}

/* ═══ toolbar above the job list ═══════════════════════════════ */
export function Toolbar() {
  const { tool, setTool, side, setSide } = useUi();
  const { store, data, p, byId } = useGame();
  const url = store.get<string>(NS.pref, "sheetUrl");
  const resumes = store.entries<ResumeEntry>(NS.resume);
  const exportCsv = () => {
    const rows = Object.entries(p.status).filter(([, v]) => v.s === "applied" || v.s === "saved").map(([id, v]) => {
      const j = byId.get(id);
      if (!j) return null;
      const date = v.t ? `${v.t.slice(5, 7)}/${v.t.slice(8, 10)}/${v.t.slice(0, 4)}` : "";
      return sheetRow(j, data.preps[j.prep], v.s === "applied" ? "Applied" : "Saved", date);
    }).filter(Boolean) as string[][];
    const csv = [SHEET_COLS, ...rows].map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "tracked_jobs.csv";
    a.click();
  };
  const toggle = (t: typeof tool) => setTool(tool === t ? "" : t);
  return (
    <div className="toolbar">
      <button onClick={() => toggle("resumes")} title="Drop your resumes to see which fits each job (stays in your account)">📄 My resumes{resumes.length ? ` (${resumes.length})` : ""}</button>
      <button onClick={() => { setSide(side === "results" ? "" : "results"); loadSheetRows(store); }} title="Response rates from your Google Sheet">📈 Results</button>
      <button className={url ? "sync-on" : ""} onClick={() => toggle("sheet")} title="Connect your Google Sheet">⚙ Sheet sync</button>
      <button onClick={exportCsv} title="Download Applied and Saved in your sheet's column order">⬇ Export tracked</button>
    </div>
  );
}

export function ToolPanels() {
  const { tool } = useUi();
  if (tool === "sheet") return <SheetPanel />;
  if (tool === "resumes") return <ResumesPanel />;
  return null;
}

function SheetPanel() {
  const { store } = useGame();
  const saved = store.get<string>(NS.pref, "sheetUrl") ?? "";
  const [url, setUrl] = useState(saved);
  const save = () => {
    const v = url.trim();
    if (v && !isAppsScriptUrl(v)) return toast("That doesn't look like an Apps Script /exec URL", true);
    if (v) store.set(NS.pref, "sheetUrl", v); else store.delete(NS.pref, "sheetUrl");
    if (!v) return toast("Sheet sync turned off");
    pushToSheet(v, { id: "__test__", company: "(sync test)", title: "Connection OK, delete this row", location: "", url: "", jobType: "" } as never, undefined)
      .then(() => { toast("✓ Saved. A test row was added to your sheet."); loadSheetRows(store, true); }, () => toast("Couldn't reach that URL", true));
  };
  return (
    <div className="settings">
      <h2>📗 Google Sheets auto-fill</h2>
      <p>When you mark a job <strong>✓ Applied</strong>, a row is added to your tracker sheet (Last Update, Company, Job, Location, Status, Application, Job Type, LeetCode Prep).
        📈 Results and 📬 Follow-ups read your sheet&apos;s Status column too. The URL is saved to your account, so your other devices get it. Setup steps are in <code>sheet-sync/README.md</code>.</p>
      <div className="field">
        <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
        <button className="save" onClick={save}>Save and test</button>
      </div>
      <div className={"status " + (saved ? "ok" : "off")}>{saved ? "✓ Connected. New Applied marks are added to your sheet automatically." : "Not connected. Applied marks stay in the app only."}</div>
    </div>
  );
}

async function fileText(file: File): Promise<string> {
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      pages.push(c.items.map(it => ("str" in it ? it.str : "")).join(" "));
    }
    return pages.join("\n");
  }
  const raw = await file.text();
  if (!/\.html?$/i.test(file.name)) return raw;
  const spaced = raw.replace(/<(\/?(p|div|h\d|li|ul|span|td|tr|br|section|header)\b[^>]*)>/gi, " <$1> ");
  return new DOMParser().parseFromString(spaced, "text/html").body.textContent || "";
}

function ResumesPanel() {
  const { store, data } = useGame();
  const resumes = store.entries<ResumeEntry>(NS.resume).map(([, r]) => r);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const add = async (files: File[]) => {
    const vocab = compileVocab(data.vocab);
    for (const file of files) {
      try {
        const text = (await fileText(file)).replace(/\s+/g, " ").trim();
        if (text.length < 200) { toast(`${file.name}: couldn't read any text (scanned image?)`, true); continue; }
        const entry: ResumeEntry = { name: file.name, skills: skillsIn(vocab, text), chars: text.length, added: localDay() };
        store.set(NS.resume, file.name, entry);
        toast(`📄 ${shortName(file.name)}: ${entry.skills.length} skills found`);
      } catch (e) { toast(`${file.name}: couldn't read it (${e instanceof Error ? e.message : e})`, true); }
    }
  };
  return (
    <div className="settings">
      <h2>📄 My resumes</h2>
      <p>Drop your resume PDFs here (text files work too). They&apos;re read <b>inside this browser</b>. Only the list of skills found is kept and synced, never the file.
        Every job then shows which resume covers the most of the skills its posting asks for.</p>
      <label className={"drop" + (over ? " over" : "")}
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]); }}>
        <input ref={input} type="file" accept=".pdf,.txt,.md,.html,application/pdf" multiple hidden onChange={e => { add([...(e.target.files || [])]); e.target.value = ""; }} />
        <span>⬇ Drag and drop PDFs here, or <u>choose files</u></span>
      </label>
      <div className="fu-list" style={{ marginTop: 10 }}>
        {resumes.length ? resumes.map(r => (
          <div className="fu" key={r.name}>
            <div><b>{shortName(r.name)}</b> <span className="sub2">{r.name}</span><div className="sub2">{r.skills.length} skills: {r.skills.join(", ")}</div></div>
            <div className="btns"><button className="mini" onClick={() => store.delete(NS.resume, r.name)}>Remove</button></div>
          </div>)) : <div className="lead">No resumes yet.</div>}
      </div>
    </div>
  );
}

