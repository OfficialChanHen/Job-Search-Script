#!/usr/bin/env python3
"""
╔════════════════════════════════════════════════════════╗
║        JOB HUNTER — Dashboard Builder                  ║
║        Built for: Chan Hen                             ║
║                                                        ║
║  Reads every data/jobs_*.csv, scores each listing      ║
║  against Chan's resume/portfolio skill profile, and    ║
║  emits a single self-contained interactive dashboard   ║
║  at docs/index.html (served via GitHub Pages).         ║
║                                                        ║
║  Client-side features (no server needed):              ║
║    • search / filter / sort across all days            ║
║    • Applied / Saved / Hidden tracking (localStorage)  ║
║    • one-click "Apply" links, jobs-per-day chart       ║
╚════════════════════════════════════════════════════════╝
"""

import csv
import glob
import json
import re
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DOCS_DIR = BASE_DIR / "docs"
OUT_HTML = DOCS_DIR / "index.html"

# ─────────────────────────────────────────────────────────────────────────────
#  SKILL PROFILE  (resume + chanhen.space portfolio)
# ─────────────────────────────────────────────────────────────────────────────
# (keyword, display label, weight) — longest keywords first so "react native"
# claims its match before plain "react" does.
SKILL_WEIGHTS: list[tuple[str, str, int]] = [
    ("react native",   "React Native", 3),
    ("reactnative",    "React Native", 3),
    ("react",          "React",        3),
    ("typescript",     "TypeScript",   3),
    ("next.js",        "Next.js",      3),
    ("nextjs",         "Next.js",      3),
    ("tailwind",       "Tailwind",     2),
    ("javascript",     "JavaScript",   2),
    ("python",         "Python",       3),
    ("front-end",      "Frontend",     2),
    ("front end",      "Frontend",     2),
    ("frontend",       "Frontend",     2),
    ("full stack",     "Full Stack",   2),
    ("full-stack",     "Full Stack",   2),
    ("fullstack",      "Full Stack",   2),
    ("web develop",    "Web Dev",      2),
    ("mobile",         "Mobile",       2),
    ("expo",           "Expo",         2),
    ("pandas",         "Pandas",       2),
    ("data science",   "Data Science", 2),
    ("data analy",     "Data Analysis",2),
    ("sql",            "SQL",          2),
    ("graphql",        "GraphQL",      1),
    ("node",           "Node",         1),
    ("figma",          "Figma",        1),
    ("java",           "Java",         1),
    ("oauth",          "OAuth",        1),
    ("rest api",       "REST",         1),
    ("css",            "CSS",          1),
    ("ui ",            "UI",           1),
]

JUNIOR_RE = re.compile(
    r"junior|jr\.?\s|entry[ -]level|new grad|associate|early career|intern|"
    r"\bi\b$|\b1\b$|engineer i\b|engineer 1\b", re.IGNORECASE)

MN_RE = re.compile(
    r"\bMN\b|Minneapolis|St\.?\s?Paul|Saint Paul|Minnesota|Bloomington, MN|"
    r"Eden Prairie|Shakopee|Eagan|Edina|Brooklyn Park", re.IGNORECASE)

REMOTE_RE = re.compile(r"remote|anywhere|worldwide|global", re.IGNORECASE)


def classify_and_score(row: dict) -> dict:
    """Attach score, matched-skill chips, and category flags to a raw CSV row."""
    title = row.get("title", "")
    text = f"{title} {row.get('tags', '')}".lower()
    loc = row.get("location", "") or ""

    score, chips, claimed = 0, [], set()
    for kw, label, weight in SKILL_WEIGHTS:
        if kw in text and label not in claimed:
            # "java" must not fire on "javascript" (already claimed above)
            if label == "Java" and "JavaScript" in claimed:
                continue
            score += weight
            chips.append(label)
            claimed.add(label)

    junior = bool(JUNIOR_RE.search(title))
    local = bool(MN_RE.search(loc))
    intern = row.get("source") == "GitHub/Internship" or "intern" in title.lower()

    # Work mode: trust the scraper's column when present, else derive from text
    mode = row.get("work_mode", "") or ""
    if mode not in ("onsite", "hybrid", "remote"):
        if "hybrid" in loc.lower():
            mode = "hybrid"
        elif REMOTE_RE.search(loc) or not loc.strip():
            mode = "remote"
        else:
            mode = "onsite"
    remote = mode == "remote"

    # Priority: in-person > hybrid > remote; Minnesota beats everything
    if junior:
        score += 3
    if local:
        score += 3
    score += {"onsite": 3, "hybrid": 2, "remote": 1}[mode]

    return {
        "id": row.get("id", ""),
        "date": row.get("date_found", ""),
        "type": row.get("type", "job"),
        "source": row.get("source", ""),
        "title": title,
        "company": row.get("company", ""),
        "location": loc or "Remote",
        "url": row.get("url", ""),
        "posted": row.get("posted", ""),
        "score": score,
        "chips": chips[:6],
        "junior": junior,
        "local": local,
        "remote": remote,
        "mode": mode,
        "intern": intern,
    }


def load_jobs() -> list[dict]:
    jobs, seen_ids = [], set()
    for path in sorted(glob.glob(str(DATA_DIR / "jobs_*.csv"))):
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                jid = row.get("id", "")
                if not jid or jid in seen_ids:
                    continue
                seen_ids.add(jid)
                jobs.append(classify_and_score(row))
    # Best matches first, newest first within the same score
    jobs.sort(key=lambda j: (-j["score"], j["date"]), reverse=False)
    jobs.sort(key=lambda j: j["date"], reverse=True)
    jobs.sort(key=lambda j: -j["score"])
    return jobs


def build_html(jobs: list[dict]) -> str:
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    latest_day = max((j["date"] for j in jobs), default="")
    # </ must be escaped so job titles can never terminate the <script> block
    jobs_json = json.dumps(jobs, ensure_ascii=False).replace("</", "<\\/")

    return HTML_TEMPLATE \
        .replace("__JOBS_JSON__", jobs_json) \
        .replace("__GENERATED__", generated) \
        .replace("__LATEST_DAY__", latest_day)


# ─────────────────────────────────────────────────────────────────────────────
#  HTML TEMPLATE  (self-contained: no CDN, no external requests)
# ─────────────────────────────────────────────────────────────────────────────

HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chan's Job Hunt</title>
<style>
:root {
  --surface-1: #fcfcfb; --plane: #f9f9f7;
  --ink-1: #0b0b0b; --ink-2: #52514e; --ink-3: #898781;
  --grid: #e1e0d9; --baseline: #c3c2b7;
  --border: rgba(11,11,11,0.10);
  --series-1: #2a78d6; --series-1-soft: #cde2fb;
  --good: #006300; --good-bg: rgba(12,163,12,0.10);
  --warn: #eda100; --save-bg: rgba(237,161,0,0.12);
  --crit: #d03b3b;
  --chip-bg: rgba(42,120,214,0.10); --chip-ink: #1c5cab;
}
@media (prefers-color-scheme: dark) {
  :root {
    --surface-1: #1a1a19; --plane: #0d0d0d;
    --ink-1: #ffffff; --ink-2: #c3c2b7; --ink-3: #898781;
    --grid: #2c2c2a; --baseline: #383835;
    --border: rgba(255,255,255,0.10);
    --series-1: #3987e5; --series-1-soft: #184f95;
    --good: #0ca30c; --good-bg: rgba(12,163,12,0.14);
    --warn: #c98500; --save-bg: rgba(250,178,25,0.14);
    --crit: #e66767;
    --chip-bg: rgba(57,135,229,0.16); --chip-ink: #86b6ef;
  }
}
* { box-sizing: border-box; margin: 0; }
body {
  background: var(--plane); color: var(--ink-1);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  padding: 24px 16px 80px;
}
.wrap { max-width: 1080px; margin: 0 auto; }
header h1 { font-size: 26px; letter-spacing: -0.02em; }
header .sub { color: var(--ink-3); font-size: 13px; margin-top: 4px; }

/* ── stat tiles ─────────────────────────────────────────── */
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px,1fr)); gap: 10px; margin: 20px 0; }
.tile {
  background: var(--surface-1); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px 14px; cursor: pointer;
}
.tile:hover { border-color: var(--series-1); }
.tile.active { outline: 2px solid var(--series-1); }
.tile .v { font-size: 24px; font-weight: 650; }
.tile .l { font-size: 12px; color: var(--ink-3); margin-top: 2px; }

/* ── jobs-per-day chart ─────────────────────────────────── */
.chart-card {
  background: var(--surface-1); border: 1px solid var(--border);
  border-radius: 10px; padding: 14px 16px 10px; margin-bottom: 20px;
}
.chart-card h2 { font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 10px; }
.bars { display: flex; align-items: flex-end; gap: 2px; height: 72px; border-bottom: 1px solid var(--baseline); }
.bar { flex: 1; min-width: 3px; background: var(--series-1); border-radius: 4px 4px 0 0; position: relative; cursor: pointer; }
.bar:hover { background: var(--chip-ink); }
.bar .tip {
  display: none; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
  background: var(--ink-1); color: var(--plane); font-size: 11px; padding: 3px 8px;
  border-radius: 6px; white-space: nowrap; z-index: 5;
}
.bar:hover .tip { display: block; }
.bar-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-3); margin-top: 4px; }

/* ── controls ───────────────────────────────────────────── */
.controls { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; align-items: center; }
.controls input[type=search], .controls select {
  background: var(--surface-1); color: var(--ink-1);
  border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 14px;
}
.controls input[type=search] { flex: 1 1 220px; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.tab {
  background: var(--surface-1); border: 1px solid var(--border); color: var(--ink-2);
  border-radius: 999px; padding: 6px 14px; font-size: 13px; cursor: pointer;
}
.tab.active { background: var(--series-1); border-color: var(--series-1); color: #fff; }
.count-note { color: var(--ink-3); font-size: 13px; margin: 0 0 10px 2px; }

/* ── job cards ──────────────────────────────────────────── */
.job {
  background: var(--surface-1); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px 14px; margin-bottom: 8px;
  display: grid; grid-template-columns: 44px 1fr auto; gap: 12px; align-items: start;
}
.job.applied { background: var(--good-bg); }
.job.saved { background: var(--save-bg); }
.score {
  width: 44px; height: 44px; border-radius: 10px; display: grid; place-items: center;
  font-weight: 700; font-size: 15px; background: var(--chip-bg); color: var(--chip-ink);
}
.score.hot { background: var(--series-1); color: #fff; }
.job h3 { font-size: 15px; font-weight: 600; }
.job h3 a { color: var(--ink-1); text-decoration: none; }
.job h3 a:hover { color: var(--series-1); text-decoration: underline; }
.meta { color: var(--ink-2); font-size: 13px; margin-top: 2px; }
.meta .co { font-weight: 600; }
.badges { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
.chip {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  background: var(--chip-bg); color: var(--chip-ink);
}
.chip.flag-local { background: var(--good-bg); color: var(--good); font-weight: 600; }
.chip.flag-src { background: transparent; border: 1px solid var(--border); color: var(--ink-3); }
.chip.flag-new { background: var(--crit); color: #fff; font-weight: 600; }
.actions { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
.actions button {
  font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 7px; cursor: pointer;
  background: transparent; border: 1px solid var(--border); color: var(--ink-2); white-space: nowrap;
}
.actions button:hover { border-color: var(--series-1); color: var(--series-1); }
.actions button.on-applied { background: var(--good); border-color: var(--good); color: #fff; }
.actions button.on-saved { background: var(--warn); border-color: var(--warn); color: #fff; }
.apply-btn { background: var(--series-1) !important; border-color: var(--series-1) !important; color: #fff !important; text-align: center; text-decoration: none; font-size: 12px; padding: 5px 10px; border-radius: 7px; }
.loadmore { display: block; margin: 18px auto; font: inherit; padding: 10px 26px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-1); color: var(--ink-1); cursor: pointer; }
.loadmore:hover { border-color: var(--series-1); }
.toolbar { display: flex; gap: 8px; justify-content: flex-end; margin: -6px 0 12px; }
.toolbar button { font: inherit; font-size: 12px; background: transparent; border: 1px solid var(--border); color: var(--ink-2); border-radius: 7px; padding: 5px 10px; cursor: pointer; }
.toolbar button:hover { color: var(--series-1); border-color: var(--series-1); }
@media (max-width: 640px) {
  .job { grid-template-columns: 1fr; }
  .score { display: none; }
  .actions { flex-direction: row; }
}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>🎯 Chan's Job Hunt</h1>
    <div class="sub">Updated __GENERATED__ · latest scrape: __LATEST_DAY__ · scored against your resume skills</div>
  </header>

  <div class="tiles" id="tiles"></div>

  <div class="chart-card">
    <h2>New listings per day (last 30 days)</h2>
    <div class="bars" id="bars"></div>
    <div class="bar-axis" id="barAxis"></div>
  </div>

  <div class="tabs" id="tabs"></div>

  <div class="controls">
    <input type="search" id="q" placeholder="Search title, company, location, skill…">
    <select id="source"><option value="">All sources</option></select>
    <select id="sort">
      <option value="score">Sort: Best match</option>
      <option value="date">Sort: Newest</option>
    </select>
  </div>

  <div class="toolbar">
    <button id="exportBtn" title="Download your Applied + Saved list as CSV">⬇ Export tracked (CSV)</button>
  </div>

  <div class="count-note" id="countNote"></div>
  <div id="list"></div>
  <button class="loadmore" id="loadMore" hidden>Show more</button>
</div>

<script>
const JOBS = __JOBS_JSON__;
const LATEST = "__LATEST_DAY__";
const PAGE = 100;

/* ── status persistence (per-browser) ─────────────────────── */
const LS_KEY = "chan-job-status-v1";
let statusMap = {};
try { statusMap = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch (e) {}
function setStatus(id, s) {
  if (s) statusMap[id] = { s, t: new Date().toISOString().slice(0, 10) };
  else delete statusMap[id];
  localStorage.setItem(LS_KEY, JSON.stringify(statusMap));
  render();
}
const st = id => (statusMap[id] || {}).s || "";

/* ── state ────────────────────────────────────────────────── */
let tab = "new", query = "", source = "", sortBy = "score", shown = PAGE;

const TABS = [
  ["new", "🆕 New today"],
  ["all", "All jobs"],
  ["local", "📍 Minnesota"],
  ["onsite", "🏢 In-person"],
  ["hybrid", "🔀 Hybrid"],
  ["remote", "🌐 Remote"],
  ["junior", "🎓 Junior/New-grad"],
  ["intern", "📚 Internships"],
  ["saved", "★ Saved"],
  ["applied", "✓ Applied"],
  ["hidden", "🚫 Hidden"],
];

function matchesTab(j) {
  const s = st(j.id);
  if (tab === "hidden") return s === "hidden";
  if (s === "hidden") return false;
  switch (tab) {
    case "new":     return j.date === LATEST;
    case "local":   return j.local;
    case "onsite":  return j.mode === "onsite";
    case "hybrid":  return j.mode === "hybrid";
    case "remote":  return j.mode === "remote";
    case "junior":  return j.junior && !j.intern;
    case "intern":  return j.intern;
    case "saved":   return s === "saved";
    case "applied": return s === "applied";
    default:        return true;
  }
}

function filtered() {
  const q = query.toLowerCase();
  let rows = JOBS.filter(j =>
    matchesTab(j) &&
    (!source || j.source === source) &&
    (!q || (j.title + " " + j.company + " " + j.location + " " + j.chips.join(" ")).toLowerCase().includes(q))
  );
  if (sortBy === "date") rows.sort((a, b) => b.date.localeCompare(a.date) || b.score - a.score);
  else rows.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  return rows;
}

/* ── render ───────────────────────────────────────────────── */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function render() {
  renderTiles();
  renderTabs();
  const rows = filtered();
  document.getElementById("countNote").textContent =
    rows.length + " listing" + (rows.length === 1 ? "" : "s") +
    (tab === "new" ? " found today (" + LATEST + ")" : "");
  const list = document.getElementById("list");
  list.innerHTML = rows.slice(0, shown).map(card).join("") ||
    '<div class="count-note" style="padding:30px 0">Nothing here — try another tab or clear the search.</div>';
  document.getElementById("loadMore").hidden = rows.length <= shown;
}

function card(j) {
  const s = st(j.id);
  const cls = s === "applied" ? "job applied" : s === "saved" ? "job saved" : "job";
  const modeBadge = { onsite: "🏢 In-person", hybrid: "🔀 Hybrid", remote: "🌐 Remote" }[j.mode] || "";
  const badges = [
    j.date === LATEST ? '<span class="chip flag-new">NEW</span>' : "",
    j.local ? '<span class="chip flag-local">📍 Minnesota</span>' : "",
    modeBadge ? '<span class="chip flag-src">' + modeBadge + "</span>" : "",
    ...j.chips.map(c => '<span class="chip">' + esc(c) + "</span>"),
    '<span class="chip flag-src">' + esc(j.source) + " · " + esc(j.date) + "</span>",
  ].join("");
  return `<div class="${cls}">
    <div class="score ${j.score >= 7 ? "hot" : ""}" title="Match score vs your skills">${j.score}</div>
    <div>
      <h3><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a></h3>
      <div class="meta"><span class="co">${esc(j.company) || "—"}</span> · ${esc(j.location)}</div>
      <div class="badges">${badges}</div>
    </div>
    <div class="actions">
      <a class="apply-btn" href="${esc(j.url)}" target="_blank" rel="noopener">Apply ↗</a>
      <button class="${s === "saved" ? "on-saved" : ""}" onclick="setStatus('${j.id}','${s === "saved" ? "" : "saved"}')">★ Save${s === "saved" ? "d" : ""}</button>
      <button class="${s === "applied" ? "on-applied" : ""}" onclick="setStatus('${j.id}','${s === "applied" ? "" : "applied"}')">✓ Applied${s === "applied" && statusMap[j.id] ? " " + statusMap[j.id].t.slice(5) : ""}</button>
      <button onclick="setStatus('${j.id}','${s === "hidden" ? "" : "hidden"}')">${s === "hidden" ? "↩ Unhide" : "🚫 Hide"}</button>
    </div>
  </div>`;
}

function renderTiles() {
  const visible = JOBS.filter(j => st(j.id) !== "hidden");
  const t = [
    ["all", visible.length, "Total jobs"],
    ["new", visible.filter(j => j.date === LATEST).length, "New today"],
    ["local", visible.filter(j => j.local).length, "Minnesota"],
    ["onsite", visible.filter(j => j.mode === "onsite").length, "In-person"],
    ["remote", visible.filter(j => j.mode === "remote").length, "Remote"],
    ["saved", JOBS.filter(j => st(j.id) === "saved").length, "Saved"],
    ["applied", JOBS.filter(j => st(j.id) === "applied").length, "Applied"],
  ];
  document.getElementById("tiles").innerHTML = t.map(([k, v, l]) =>
    `<div class="tile ${tab === k ? "active" : ""}" onclick="goTab('${k}')"><div class="v">${v}</div><div class="l">${l}</div></div>`
  ).join("");
}

function renderTabs() {
  document.getElementById("tabs").innerHTML = TABS.map(([k, l]) =>
    `<button class="tab ${tab === k ? "active" : ""}" onclick="goTab('${k}')">${l}</button>`
  ).join("");
}

function goTab(k) { tab = k; shown = PAGE; render(); }

/* ── jobs-per-day chart (single series → no legend needed) ── */
function renderChart() {
  const byDay = {};
  JOBS.forEach(j => { byDay[j.date] = (byDay[j.date] || 0) + 1; });
  const days = Object.keys(byDay).sort().slice(-30);
  const max = Math.max(...days.map(d => byDay[d]), 1);
  document.getElementById("bars").innerHTML = days.map(d =>
    `<div class="bar" style="height:${Math.max(4, Math.round(byDay[d] / max * 68))}px">
       <span class="tip">${d}: ${byDay[d]} jobs</span></div>`
  ).join("");
  document.getElementById("barAxis").innerHTML =
    `<span>${days[0] || ""}</span><span>${days[days.length - 1] || ""}</span>`;
}

/* ── export tracked jobs ──────────────────────────────────── */
document.getElementById("exportBtn").onclick = () => {
  const rows = JOBS.filter(j => ["applied", "saved"].includes(st(j.id)))
    .map(j => [st(j.id), (statusMap[j.id] || {}).t || "", j.title, j.company, j.location, j.url]);
  const csv = [["status", "status_date", "title", "company", "location", "url"], ...rows]
    .map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "tracked_jobs.csv";
  a.click();
};

/* ── wire controls ────────────────────────────────────────── */
document.getElementById("q").oninput = e => { query = e.target.value; shown = PAGE; render(); };
document.getElementById("source").onchange = e => { source = e.target.value; shown = PAGE; render(); };
document.getElementById("sort").onchange = e => { sortBy = e.target.value; render(); };
document.getElementById("loadMore").onclick = () => { shown += PAGE; render(); };

const srcSel = document.getElementById("source");
[...new Set(JOBS.map(j => j.source))].sort().forEach(s => {
  const o = document.createElement("option"); o.value = o.textContent = s; srcSel.append(o);
});

renderChart();
render();
</script>
</body>
</html>
"""


def main() -> None:
    DOCS_DIR.mkdir(exist_ok=True)
    jobs = load_jobs()
    OUT_HTML.write_text(build_html(jobs), encoding="utf-8")
    latest = max((j["date"] for j in jobs), default="—")
    print(f"Dashboard built: {OUT_HTML}  ({len(jobs)} jobs, latest day {latest})")


if __name__ == "__main__":
    main()
