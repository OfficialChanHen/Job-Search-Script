"use client";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { NS, type KitJob, type ResumeEntry, type SheetRow } from "@/lib/game/progress";
import { JOB_TYPES, TABS, matchesTab, onePerCompany, passesFilters, recentlyApplied, type Filters } from "@/lib/jobs/filters";
import { useGame } from "./GameContext";
import JobCard from "./JobCard";
import { ToolPanels, Toolbar } from "./Panels";
import QuickPlay from "./QuickPlay";
import StickyTop, { PacePanel } from "./StickyTop";

const PAGE = 60;
const TILES: [string, string][] = [["all", "Open jobs"], ["new", "New today"], ["direct", "Direct link"], ["onsite", "In-person"],
  ["remote", "Remote"], ["parttime", "Local part-time"], ["saved", "Saved"], ["applied", "Applied"]];

export default function JobBoard() {
  const { data, byId, p, store, rev } = useGame();
  const resumes = useMemo(() => store.entries<ResumeEntry>(NS.resume).map(([, r]) => r),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, rev]);
  const [tab, setTab] = useState("new");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState<"score" | "date">("score");
  const jobType = store.get<string>(NS.pref, "jobType") ?? "Full-time";
  const sheetUrl = store.get<string>(NS.pref, "sheetUrl") ?? "";
  const q = useDeferredValue(query);
  const latest = data.meta.latest;

  const filters: Filters = { query: q, source, cat, jobType };
  const sheetByUrl = useMemo(() => {
    const m = new Map<string, SheetRow>();
    p.sheetRows.forEach(r => { if (r.url) m.set(r.url.trim(), r); });
    return m;
  }, [p.sheetRows]);
  const applied = useMemo(() => recentlyApplied(p.status, byId, p.sheetRows), [p.status, byId, p.sheetRows]);

  const passing = useMemo(() => data.jobs.filter(j => passesFilters(j, filters, tab)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.jobs, q, source, cat, jobType, tab]);
  const tabCounts = useMemo(() => Object.fromEntries(TABS.map(([k]) =>
    [k, onePerCompany(passing.filter(j => matchesTab(j, k, p.status, latest)), k, applied).rows.length])), [passing, p.status, latest, applied]);
  const tileCounts = useMemo(() => Object.fromEntries(TILES.map(([k]) =>
    [k, data.jobs.reduce((c, j) => c + (matchesTab(j, k, p.status, latest) ? 1 : 0), 0)])), [data.jobs, p.status, latest]);
  const view = useMemo(() => {
    const r = onePerCompany(passing.filter(j => matchesTab(j, tab, p.status, latest)), tab, applied);
    r.rows.sort(sort === "date" ? (a, b) => b.date.localeCompare(a.date) || b.score - a.score : (a, b) => b.score - a.score || b.date.localeCompare(a.date));
    return r;
  }, [passing, tab, p.status, latest, applied, sort]);

  const cats = useMemo(() => [...new Map(data.jobs.map(j => [j.cat, j.catLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [data.jobs]);
  const sources = useMemo(() => [...new Set(data.jobs.map(j => j.source))].sort(), [data.jobs]);

  // how many cards to render; starts over whenever the tab, search or filters change
  const sig = [tab, q, source, cat, jobType, sort].join("|");
  const [page, setPage] = useState({ sig, n: PAGE });
  const shown = page.sig === sig ? page.n : PAGE;
  const hasMore = view.rows.length > shown;
  const showMore = () => setPage({ sig, n: shown + PAGE });
  // load the next page when the end of the list scrolls into view
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el || !hasMore || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) setPage({ sig, n: shown + PAGE }); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, sig, shown]);

  const go = (k: string) => { setTab(k); };
  const note = `Showing ${view.rows.length}${jobType && jobType !== "?" ? " " + jobType.toLowerCase() : ""} listing${view.rows.length === 1 ? "" : "s"}` +
    (tab === "new" ? ` found today (${latest})` : "") +
    (view.cooled ? `. ${view.cooled} hidden because you applied to those companies in the last 6 months` : "") +
    (view.capped ? `. ${view.capped} more hidden from companies already shown twice` : "") + ".";

  return (
    <>
      <div className="tiles">
        {TILES.map(([k, l]) => (
          <button key={k} className={"tile" + (tab === k ? " active" : "")} onClick={() => go(k)}>
            <div className="l">{l}</div><div className="v">{tileCounts[k]}</div>
          </button>
        ))}
      </div>
      <div className="stickybar">
        <StickyTop />
        <div className="tabs" role="tablist">
          {TABS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={"tab" + (tab === k ? " active" : "")} onClick={() => go(k)}>
              {l}<span className="n">{tabCounts[k]}</span>
            </button>
          ))}
        </div>
        <div className="controls">
          <input type="search" placeholder="Search title, company, location, skill" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search jobs" />
          <select value={jobType} onChange={e => store.set(NS.pref, "jobType", e.target.value)} aria-label="Job type">
            {JOB_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={cat} onChange={e => setCat(e.target.value)} aria-label="Role">
            <option value="">All roles</option>
            {cats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select value={source} onChange={e => setSource(e.target.value)} aria-label="Source">
            <option value="">All sources</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as "score" | "date")} aria-label="Sort">
            <option value="score">Sort: Best match</option>
            <option value="date">Sort: Newest</option>
          </select>
        </div>
      </div>
      <PacePanel />
      <div className="bar-row"><div className="count-note">{note}</div><Toolbar /></div>
      <ToolPanels />
      <div id="list">
        {view.rows.slice(0, shown).map(j => (
          <JobCard key={j.id} job={j} prep={data.preps[j.prep]} company={j.ck ? data.companies[j.ck] : undefined}
            status={p.status[j.id]} solved={p.solved} sheetRow={sheetByUrl.get(j.url)} latest={latest}
            store={store} sheetUrl={sheetUrl} synced={!!store.get(NS.synced, j.id)} resumes={resumes}
            kit={store.get<KitJob>(NS.kitJob, j.id)} outreach={p.outreach[j.id]} />
        ))}
        {!view.rows.length && <div className="empty">Nothing here. Try another tab or job type, or clear the search.</div>}
      </div>
      {hasMore && <button ref={more} className="loadmore" onClick={showMore}>Show more</button>}
      <QuickPlay rows={view.rows} status={p.status} data={data} store={store} solved={p.solved} />
    </>
  );
}
