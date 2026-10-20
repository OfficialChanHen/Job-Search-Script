"use client";
import { useEffect, useState } from "react";
import { copyText, floatFood, floatXP, toast } from "@/lib/client/effects";
import { loadSheetRows } from "@/lib/client/sheetRows";
import { FOLLOW_UP_DAYS, followMsg, followUps, liSearch } from "@/lib/game/followups";
import { paceStats } from "@/lib/game/pace";
import { NS, markFollowed, markReviewed, type ResumeEntry } from "@/lib/game/progress";
import { breakdown, byMonth, channelOf, placeOf, roleOf, sheetStats, type Group } from "@/lib/game/results";
import { REVIEW_GAPS, dueReviews } from "@/lib/game/reviews";
import { localDay } from "@/lib/game/time";
import { BADGES } from "@/lib/game/xp";
import { compileVocab, shortName, skillsIn } from "@/lib/jobs/resumes";
import { SHEET_COLS, isAppsScriptUrl, pushToSheet, sheetRow } from "@/lib/jobs/sheet";
import { SYNC_ENABLED } from "@/lib/supabase/env";
import { supabaseBrowser } from "@/lib/supabase/client";
import { importLegacy, parseBackup } from "@/lib/sync/importLegacy";
import { useGame } from "./GameContext";
import { Icon } from "./Icon";
import { useNow } from "./useNow";
import { useUi, type Drawer as DrawerKind } from "./UiContext";

const TITLES: Record<Exclude<DrawerKind, "">, [string, string]> = {
  tools: ["Tools", "Everything that isn't the job list or the game."],
  followups: ["Follow-ups", `Applications ${FOLLOW_UP_DAYS} or more days old with no reply.`],
  reviews: ["Reviews", "LeetCode problems due for another look."],
  results: ["Results", "How your applications are doing, from your tracker sheet."],
  badges: ["Badges", "Earned by real progress. Each one is worth 25 XP."],
  sheet: ["Google Sheet", "Your tracker fills itself in."],
  resumes: ["Your resumes", "Which one fits each job best."],
  pace: ["Your pace", "Applications today and this week."],
  account: ["Sign in", "Keep your progress in sync on your phone and computer."],
};

/** A side sheet on desktop, a bottom sheet on phones. Esc or the backdrop closes it. */
export function Drawer() {
  const { drawer, setDrawer } = useUi();
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(""); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer, setDrawer]);
  if (!drawer) return null;
  const [title, lead] = TITLES[drawer];
  const back = ["sheet", "resumes", "pace", "results"].includes(drawer);
  return (
    <div className="drawer-back" onClick={e => { if (e.target === e.currentTarget) setDrawer(""); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-head">
          <div>
            {back && <button className="link-btn" onClick={() => setDrawer("tools")}>← Tools</button>}
            <h2 className="display">{title}</h2>
            <p className="lead">{lead}</p>
          </div>
          <button className="icon-btn" onClick={() => setDrawer("")} aria-label="Close">✕</button>
        </header>
        <div className="drawer-body">
          {drawer === "tools" && <Tools />}
          {drawer === "followups" && <FollowUps />}
          {drawer === "reviews" && <Reviews />}
          {drawer === "results" && <Results />}
          {drawer === "badges" && <Badges />}
          {drawer === "sheet" && <SheetPanel />}
          {drawer === "resumes" && <ResumesPanel />}
          {drawer === "pace" && <PacePanel />}
          {drawer === "account" && <SignIn />}
        </div>
      </aside>
    </div>
  );
}

/* ── tools menu ──────────────────────────────────────────────── */
const MY_LINKS: [string, string][] = [
  ["LinkedIn", "https://linkedin.com/in/chan-hen-13727b233"], ["GitHub", "https://github.com/OfficialChanHen"],
  ["Portfolio", "https://chanhen.space"], ["Hourelle", "https://hourelle.com"],
];
function Tools() {
  const { setDrawer } = useUi();
  const { store, p, byId } = useGame();
  const url = store.get<string>(NS.pref, "sheetUrl");
  const resumes = store.entries<ResumeEntry>(NS.resume).length;
  const exportCsv = () => {
    const rows = Object.entries(p.status).filter(([, v]) => v.s === "applied" || v.s === "saved").flatMap(([id, v]) => {
      const j = byId.get(id);
      if (!j) return [];
      const date = v.t || "";
      return [sheetRow(j, v.s === "applied" ? "Applied" : "Saved", date)];
    });
    const csv = [SHEET_COLS, ...rows].map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "tracked_jobs.csv";
    a.click();
  };
  const importFile = async (f: File) => {
    try {
      const s = importLegacy(store, parseBackup(await f.text()));
      toast(`Imported ${s.applied} applications, ${s.solved} solved problems and ${s.badges} badges` + (s.village ? ", plus your village." : "."));
    } catch (e) { toast(e instanceof Error ? e.message : "Couldn't read that file", true); }
  };
  const item = (title: string, sub: string, onClick: () => void) => (
    <button className="menu-item" onClick={onClick}><b>{title}</b><span>{sub}</span></button>);
  return <>
    <div className="menu">
      {item("Results", "Interview rate by channel, place and role", () => { setDrawer("results"); loadSheetRows(store); })}
      {item("Google Sheet", url ? "Connected. Applied jobs are added for you." : "Not connected yet", () => setDrawer("sheet"))}
      {item("Your resumes", resumes ? `${resumes} added` : "Add PDFs to see which fits each job", () => setDrawer("resumes"))}
      {item("Your pace", "Applications by hour and by day", () => setDrawer("pace"))}
      {item("Export tracked jobs", "A CSV in your sheet's column order", exportCsv)}
      <label className="menu-item" htmlFor="import-backup"><b>Import a backup</b><span>From the old dashboard&apos;s backup file</span></label>
    </div>
    <input id="import-backup" type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
    <h3 className="eyebrow">Your links</h3>
    <p className="lead">Tap one to copy it for an application.</p>
    <div className="chips-row">
      {MY_LINKS.map(([name, link]) => <button key={name} className="pill" onClick={() => copyText(link, `Copied your ${name} link`)}>{name}</button>)}
    </div>
  </>;
}

/* ── follow-ups, reviews, badges ─────────────────────────────── */
function FollowUps() {
  const { p, byId, store } = useGame();
  const list = followUps(p, byId);
  const mark = (key: string, how: "done" | "skip") => { markFollowed(store, key, how); if (how === "done") { floatXP(15); floatFood(2); } };
  if (!list.length) return <p className="empty-note">Nothing due. You&apos;re on top of it.</p>;
  return <>
    <p className="lead">A short, polite note to the recruiter brings back a surprising number. Each one earns 15 XP and 2 hours of food.</p>
    <ul className="rows">{list.map(f => (
      <li key={f.key}>
        <div><b>{f.company}</b><span className="sub">{f.title}. Applied {f.days} days ago.</span></div>
        <div className="row-actions">
          <a className="pill" href={liSearch(f.company + " recruiter")} target="_blank" rel="noopener">Find the recruiter</a>
          <button className="pill" onClick={() => copyText(followMsg(f), "Follow-up message copied")}>Copy a message</button>
          <button className="pill primary" onClick={() => mark(f.key, "done")}>I followed up</button>
          <button className="link-btn" onClick={() => mark(f.key, "skip")}>Skip</button>
        </div>
      </li>))}
    </ul>
  </>;
}

function Reviews() {
  const { p, store, data } = useGame();
  const info = (n: number) => {
    for (const t of Object.values(data.topics)) { const x = t.problems.find(([m]) => m === n); if (x) return x; }
    for (const pr of data.preps) { const x = pr.problems.find(([m]) => m === n); if (x) return x; }
    return [n, "Problem", "https://leetcode.com/problemset/"] as const;
  };
  const list = dueReviews(p);
  if (!list.length) return <p className="empty-note">Nothing due. Solved problems come back here on schedule.</p>;
  return <>
    <p className="lead">Solve it again from scratch, then mark it. Problems come back after 3, 7, 14, 30 and 60 days, then every 90. Each review trains that topic&apos;s hunter.</p>
    <ul className="rows">{list.map(r => { const [, name, url] = info(r.n); return (
      <li key={r.n}>
        <div><b>#{r.n} {name}</b><span className="sub">{r.stage < REVIEW_GAPS.length ? `Review ${r.stage + 1} of ${REVIEW_GAPS.length}` : "Keep-up review"}, due {r.due}</span></div>
        <div className="row-actions">
          <a className="pill" href={url} target="_blank" rel="noopener">Open on LeetCode</a>
          <button className="pill primary" onClick={() => { markReviewed(store, r.n); floatXP(10); floatFood(1); }}>Reviewed</button>
        </div>
      </li>); })}
    </ul>
  </>;
}

function Badges() {
  const { p } = useGame();
  return <div className="badge-grid">{BADGES.map(([id, name, desc]) => (
    <div key={id} className={"badge" + (p.unlocked[id] ? " got" : "")}>
      <Icon id={p.unlocked[id] ? "icon:cup" : "icon:cup-silver"} size={28} />
      <div><b>{name}</b><span>{p.unlocked[id] ? "Earned " + p.unlocked[id] : desc}</span></div>
    </div>))}
  </div>;
}

/* ── results ─────────────────────────────────────────────────── */
function Results() {
  const { store, p } = useGame();
  const url = store.get<string>(NS.pref, "sheetUrl");
  if (!url) return <p className="empty-note">Connect your Google Sheet first. Results come from its Status column.</p>;
  const { rows, c, positive } = sheetStats(p.sheetRows);
  if (!rows.length) return <><p className="empty-note">No rows loaded yet.</p><button className="pill" onClick={() => loadSheetRows(store, true)}>Load my sheet</button></>;
  const decided = rows.length - c.pending, rate = decided ? Math.round(positive / decided * 100) : 0;
  const segs: [string, number, string][] = [["Interview or offer", positive, "var(--teal)"], ["Rejected", c.rejected, "var(--brick)"],
    ["No reply", c.noreply, "var(--border2)"], ["Waiting", c.pending, "var(--ochre)"]];
  const table = (title: string, list: [string, Group][]) => (
    <section><h3 className="eyebrow">{title}</h3>{list.map(([k, v]) => {
      const r = v.decided ? v.pos / v.decided : 0;
      return <div className="rrow" key={k}><span>{k}</span>
        <div className="track"><div className="fill" style={{ width: Math.max(r ? 4 : 0, Math.round(r * 100)) + "%" }} /></div>
        <span className="num">{v.decided ? `${v.pos} of ${v.decided}` : `${v.n} waiting`}</span></div>;
    })}</section>);
  const byChannel = breakdown(rows, r => channelOf(r.application ?? r.url));
  const best = byChannel.filter(([, v]) => v.decided >= 5).sort((a, b) => b[1].pos / b[1].decided - a[1].pos / a[1].decided)[0];
  return <>
    <p className="sentence"><b>{rate}%</b> of your decided applications led to an interview. That&apos;s {positive} interviews from {rows.length} applications, with {c.pending} still waiting.</p>
    <div className="stack" role="img" aria-label="Outcomes">{segs.filter(s => s[1]).map(([l, n, col]) => <span key={l} title={`${l}: ${n}`} style={{ flex: n, background: col }} />)}</div>
    <div className="legend">{segs.map(([l, n, col]) => <span key={l}><i style={{ background: col }} />{l} {n}</span>)}</div>
    <p className="note">{best && best[1].pos
      ? <>Your best channel so far is <b>{best[0]}</b>: {best[1].pos} of {best[1].decided} got an interview.</>
      : <>No channel has turned 5 decided applications into an interview yet. Referrals and follow-ups usually move this more than volume.</>}</p>
    {table("By channel", byChannel)}
    {table("By place", breakdown(rows, r => placeOf(r.location)))}
    {table("By role", breakdown(rows, r => roleOf(r.title)))}
    {table("By month", byMonth(rows))}
    <button className="link-btn" onClick={() => loadSheetRows(store, true)}>Refresh from the sheet</button>
  </>;
}

/* ── sheet, resumes, pace ────────────────────────────────────── */
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
      .then(() => { toast("Saved. A test row was added to your sheet."); loadSheetRows(store, true); }, () => toast("Couldn't reach that URL", true));
  };
  return <>
    <p className="lead">When you mark a job applied, a row goes into your tracker. Results and follow-ups read its Status column. The address is saved to your account, so your phone gets it too.</p>
    <label className="field"><span>Apps Script web app URL</span>
      <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" /></label>
    <div className="row-actions"><button className="pill primary" onClick={save}>Save and test</button></div>
    <p className={"status-line " + (saved ? "ok" : "")}>{saved ? "Connected." : "Not connected yet."} Setup steps are in sheet-sync/README.md.</p>
  </>;
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
  const [over, setOver] = useState(false);
  const add = async (files: File[]) => {
    const vocab = compileVocab(data.vocab);
    for (const file of files) {
      try {
        const text = (await fileText(file)).replace(/\s+/g, " ").trim();
        if (text.length < 200) { toast(`${file.name}: couldn't read any text (scanned image?)`, true); continue; }
        const entry: ResumeEntry = { name: file.name, skills: skillsIn(vocab, text), chars: text.length, added: localDay() };
        store.set(NS.resume, file.name, entry);
        toast(`${shortName(file.name)}: ${entry.skills.length} skills found`);
      } catch (e) { toast(`${file.name}: couldn't read it (${e instanceof Error ? e.message : e})`, true); }
    }
  };
  return <>
    <p className="lead">Your PDFs are read in this browser. Only the list of skills found is kept, never the file.</p>
    <label className={"drop" + (over ? " over" : "")}
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]); }}>
      <input type="file" accept=".pdf,.txt,.md,.html,application/pdf" multiple hidden onChange={e => { add([...(e.target.files || [])]); e.target.value = ""; }} />
      <span>Drop PDFs here, or <u>choose files</u></span>
    </label>
    <ul className="rows">{resumes.map(r => (
      <li key={r.name}>
        <div><b>{shortName(r.name)}</b><span className="sub">{r.skills.length} skills: {r.skills.join(", ")}</span></div>
        <div className="row-actions"><button className="link-btn" onClick={() => store.delete(NS.resume, r.name)}>Remove</button></div>
      </li>))}
    </ul>
  </>;
}

function PacePanel() {
  const { p } = useGame();
  const now = useNow(60_000);
  const s = paceStats(p.status, now);
  const best = s.days.reduce((a, b) => b[1] > a[1] ? b : a, ["", 0] as [string, number]);
  const hourLbl = (h: number) => (h % 12 || 12) + (h < 12 ? "am" : "pm");
  const bars = (vals: number[], labels: string[]) => {
    const max = Math.max(...vals, 1);
    return vals.map((v, i) => <div key={i} className="bar" style={{ height: v ? Math.max(4, Math.round(v / max * 56)) : 0 }} title={`${labels[i]}: ${v}`} />);
  };
  return <>
    <p className="sentence">You&apos;ve applied to <b>{s.todayCount}</b> today{s.avgMin ? `, about ${Math.round(s.avgMin)} minutes each` : ""}. Your best day this week was {best[1]}.</p>
    <h3 className="eyebrow">Today, by hour</h3>
    <div className="bars">{bars(s.hours, s.hours.map((_, h) => hourLbl(h)))}</div>
    <div className="axis"><span>12am</span><span>noon</span><span>11pm</span></div>
    <h3 className="eyebrow">The last 7 days</h3>
    <div className="bars">{bars(s.days.map(d => d[1]), s.days.map(d => d[0]))}</div>
    <div className="axis"><span>{s.days[0][0]}</span><span>today</span></div>
  </>;
}

/* ── sign in ─────────────────────────────────────────────────── */
function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  if (!SYNC_ENABLED) return <p className="empty-note">Sync isn&apos;t set up on this copy of the site. Progress is saved in this browser.</p>;
  const sendLink = async () => {
    const sb = supabaseBrowser();
    if (!sb || !email.includes("@")) return toast("Enter your email", true);
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
    if (error) return toast(error.message, true);
    setSent(true);
  };
  const google = async () => {
    const { error } = await supabaseBrowser()!.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback` } });
    if (error) toast(error.message, true);
  };
  if (sent) return <p className="sentence">Check your email for a sign-in link, and open it on this device.</p>;
  return <>
    <label className="field"><span>Email</span>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && sendLink()} autoComplete="email" placeholder="you@example.com" /></label>
    <div className="row-actions">
      <button className="pill primary" onClick={sendLink}>Email me a link</button>
      <button className="pill" onClick={google}>Continue with Google</button>
    </div>
  </>;
}
