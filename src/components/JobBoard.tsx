"use client";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { NS, type KitJob, type ResumeEntry, type SheetRow } from "@/lib/game/progress";
import { JOB_TYPES, TABS, matchesTab, onePerCompany, passesFilters, recentlyApplied, type Filters } from "@/lib/jobs/filters";
import { useGame } from "./GameContext";
import JobCard from "./JobCard";
import QuickPlay from "./QuickPlay";

const PAGE = 40;
const MAIN_VIEWS: [string, string][] = [["new", "New"], ["all", "All"], ["saved", "Saved"], ["applied", "Applied"]];
const MORE_VIEWS = TABS.filter(([k]) => !MAIN_VIEWS.some(([m]) => m === k)).map(([k, l]) => [k, l.replace(/^\S+\s/, "")] as [string, string]);

export default function JobBoard() {
  const { data, byId, p, store, rev } = useGame();
  const [view, setView] = useState("new");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState<"score" | "date">("score");
  const [open, setOpen] = useState(false);
  const jobType = store.get<string>(NS.pref, "jobType") ?? "Full-time";
  const sheetUrl = store.get<string>(NS.pref, "sheetUrl") ?? "";
  const q = useDeferredValue(query);
  const latest = data.meta.latest;
  const resumes = useMemo(() => store.entries<ResumeEntry>(NS.resume).map(([, r]) => r),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, rev]);
  const sheetByUrl = useMemo(() => new Map<string, SheetRow>(p.sheetRows.filter(r => r.url).map(r => [r.url!.trim(), r])), [p.sheetRows]);
  const applied = useMemo(() => recentlyApplied(p.status, byId, p.sheetRows), [p.status, byId, p.sheetRows]);

  const filters: Filters = { query: q, source, cat, jobType };
  const passing = useMemo(() => data.jobs.filter(j => passesFilters(j, filters, view)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.jobs, q, source, cat, jobType, view]);
  const list = useMemo(() => {
    const r = onePerCompany(passing.filter(j => matchesTab(j, view, p.status, latest)), view, applied);
    r.rows.sort(sort === "date" ? (a, b) => b.date.localeCompare(a.date) || b.score - a.score : (a, b) => b.score - a.score || b.date.localeCompare(a.date));
    return r;
  }, [passing, view, p.status, latest, applied, sort]);
  const counts = useMemo(() => Object.fromEntries(MAIN_VIEWS.map(([k]) => [k, data.jobs.reduce((c, j) => c + (matchesTab(j, k, p.status, latest) ? 1 : 0), 0)])),
    [data.jobs, p.status, latest]);
  const cats = useMemo(() => [...new Map(data.jobs.map(j => [j.cat, j.catLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [data.jobs]);
  const sources = useMemo(() => [...new Set(data.jobs.map(j => j.source))].sort(), [data.jobs]);

  // how many cards to render; starts over whenever the view or filters change
  const sig = [view, q, source, cat, jobType, sort].join("|");
  const [page, setPage] = useState({ sig, n: PAGE });
  const shown = page.sig === sig ? page.n : PAGE;
  const hasMore = list.rows.length > shown;
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el || !hasMore || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) setPage({ sig, n: shown + PAGE }); }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, sig, shown]);

  const active = [jobType !== "Full-time", !!cat, !!source, sort !== "score", !MAIN_VIEWS.some(([k]) => k === view)].filter(Boolean).length;
  const n = list.rows.length, appliedCount = counts.applied;
  const viewName = (MAIN_VIEWS.find(([k]) => k === view) ?? MORE_VIEWS.find(([k]) => k === view) ?? ["", ""])[1].toLowerCase();
  const sentence = view === "new"
    ? <><b>{n}</b> new {n === 1 ? "listing" : "listings"} from the {latest} scrape. You&apos;ve applied to {appliedCount} so far.</>
    : view === "applied" ? <>You&apos;ve applied to <b>{appliedCount}</b> {appliedCount === 1 ? "job" : "jobs"}.</>
    : view === "saved" ? <><b>{n}</b> saved for later.</>
    : <><b>{n.toLocaleString()}</b> {viewName === "all" ? "open" : viewName} {n === 1 ? "listing" : "listings"}.</>;

  return (
    <>
      <header className="jobs-head">
        <p className="eyebrow">Entry-level SWE and tech roles in the US</p>
        <h1 className="display">Find the role that <em>fits</em>.</h1>
        <p className="sentence">{sentence}{(list.cooled + list.capped) > 0 && <span className="dim"> {list.cooled + list.capped} more are tucked away: companies you applied to lately, and a cap of 2 per company.</span>}</p>
      </header>

      <div className="controls">
        <input type="search" placeholder="Search title, company, place or skill" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search jobs" />
        <div className="segmented" role="tablist" aria-label="Which jobs">
          {MAIN_VIEWS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>
              {l}<span className="n">{counts[k]}</span>
            </button>
          ))}
        </div>
        <button className={"pill" + (open || active ? " on" : "")} onClick={() => setOpen(o => !o)} aria-expanded={open}>
          Filters{active ? <span className="count">{active}</span> : null}
        </button>
      </div>
      {open && (
        <div className="filters">
          <label className="field"><span>Job type</span>
            <select value={jobType} onChange={e => store.set(NS.pref, "jobType", e.target.value)}>{JOB_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="field"><span>Role</span>
            <select value={cat} onChange={e => setCat(e.target.value)}><option value="">Any role</option>{cats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field"><span>Source</span>
            <select value={source} onChange={e => setSource(e.target.value)}><option value="">Any source</option>{sources.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
          <label className="field"><span>Order</span>
            <select value={sort} onChange={e => setSort(e.target.value as "score" | "date")}><option value="score">Best match first</option><option value="date">Newest first</option></select></label>
          <div className="field wide"><span>Show only</span>
            <div className="chips-row">{MORE_VIEWS.map(([k, l]) => <button key={k} className={"pill small" + (view === k ? " on" : "")} onClick={() => setView(view === k ? "all" : k)}>{l}</button>)}</div>
          </div>
          {active > 0 && <button className="link-btn" onClick={() => { store.set(NS.pref, "jobType", "Full-time"); setCat(""); setSource(""); setSort("score"); setView("new"); }}>Clear filters</button>}
        </div>
      )}

      <div className="list">
        {list.rows.slice(0, shown).map(j => (
          <JobCard key={j.id} job={j} prep={data.preps[j.prep]} company={j.ck ? data.companies[j.ck] : undefined}
            status={p.status[j.id]} solved={p.solved} sheetRow={sheetByUrl.get(j.url)} latest={latest}
            store={store} sheetUrl={sheetUrl} synced={!!store.get(NS.synced, j.id)} resumes={resumes}
            kit={store.get<KitJob>(NS.kitJob, j.id)} outreach={p.outreach[j.id]} />
        ))}
        {!n && <p className="empty-note">Nothing here. Try another view, or clear the search and filters.</p>}
      </div>
      {hasMore && <button ref={more} className="pill load-more" onClick={() => setPage({ sig, n: shown + PAGE })}>Show more</button>}
      <QuickPlay rows={list.rows} status={p.status} data={data} store={store} solved={p.solved} />
    </>
  );
}
