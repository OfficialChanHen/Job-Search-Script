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
║    • job type (full-time first) + role category filter ║
║    • LeetCode / interview prep per job                 ║
║    • Applied / Saved / Hidden tracking (localStorage)  ║
║    • Google Sheet auto-fill + "Copy row" for pasting   ║
╚════════════════════════════════════════════════════════╝

History is re-filtered with today's rules (job_rules.py), so older CSVs
lose internships / non-US / senior rows too.
"""

import csv
import glob
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from interview_prep import prep_for, prep_text
from job_rules import (
    CATEGORY_LABEL, SWE_CATEGORIES, infer_job_type, is_target_title,
    is_us_location, role_category,
)

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
    r"junior|jr\.?\s|entry[ -]level|new grad|associate|early career|"
    r"\bi\b$|\b1\b$|engineer i\b|engineer 1\b", re.IGNORECASE)

# Postings aimed at a graduating class — may require a recent grad date
GRAD_WINDOW_RE = re.compile(
    r"new grad|new graduate|university grad|campus|class of|\b20(26|27)\b", re.IGNORECASE)

# Sources that were retired or can't be trusted to be US-only in old CSVs
DROPPED_SOURCES = {"GitHub/Internship", "Arbeitnow", "Eventbrite"}
GLOBAL_REMOTE_SOURCES = {"RemoteOK", "WeWorkRemotely", "Himalayas", "Remotive", "Jobicy"}
# Sources whose listings are full-time unless they say otherwise
FULLTIME_SOURCES = {"Greenhouse", "Lever", "Ashby", "Workday", "SmartRecruiters",
                    "GitHub/NewGrad", "GitHub/Simplify", "GitHub/speedyapply",
                    "GitHub/zapplyjobs", "LinkedIn", "USAJobs"}

TYPE_SCORE = {"Full-time": 3, "": 1, "Contract": 1, "Part-time": 0, "Temporary": 0}

# Interview-prep blocks are shared by many jobs — store each once
PREPS: list[dict] = []
_PREP_INDEX: dict[str, int] = {}


def _prep_id(title: str, company: str) -> int:
    prep = prep_for(title, company)
    key = json.dumps(prep, sort_keys=True)
    if key not in _PREP_INDEX:
        _PREP_INDEX[key] = len(PREPS)
        PREPS.append({**prep, "text": prep_text(prep)})
    return _PREP_INDEX[key]


def keep_row(row: dict) -> bool:
    """Apply today's rules to a historical CSV row."""
    if row.get("type", "job") != "job" or row.get("source") in DROPPED_SOURCES:
        return False
    title = row.get("title", "")
    if not is_target_title(title) or row.get("job_type") == "Internship":
        return False
    loc = row.get("location", "") or ""
    strict = row.get("source") in GLOBAL_REMOTE_SOURCES and not row.get("job_type")
    return is_us_location(loc, bare_remote_ok=not strict)

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

    junior = bool(JUNIOR_RE.search(title)) or row.get("experience", "") in (
        "0 yrs", "1+ yrs", "Entry-level", "New grad", "Recent grad", "Entry grade")
    local = bool(MN_RE.search(loc))
    job_type = row.get("job_type") or infer_job_type(
        "", title, row.get("tags", ""),
        default="Full-time" if row.get("source") in FULLTIME_SOURCES else "")
    category = row.get("category") or role_category(title) or "swe"

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
    # Full-time is the main focus
    score += TYPE_SCORE.get(job_type, 0)
    if category in SWE_CATEGORIES:
        score += 1

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
        "jobType": job_type,
        "cat": category,
        "catLabel": CATEGORY_LABEL.get(category, "SWE"),
        "swe": category in SWE_CATEGORIES,
        "exp": row.get("experience", ""),
        "gradWindow": bool(GRAD_WINDOW_RE.search(title)),
        "prep": _prep_id(title, row.get("company", "")),
    }


def load_jobs() -> list[dict]:
    jobs, seen_ids = [], set()
    for path in sorted(glob.glob(str(DATA_DIR / "jobs_*.csv"))):
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                jid = row.get("id", "")
                if not jid or jid in seen_ids or not keep_row(row):
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
    preps_json = json.dumps(PREPS, ensure_ascii=False).replace("</", "<\\/")

    return HTML_TEMPLATE \
        .replace("__JOBS_JSON__", jobs_json) \
        .replace("__PREPS_JSON__", preps_json) \
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
  --surface-1: #fcfcfb; --plane: #f4f4f1; --surface-2: #f9f9f7;
  --ink-1: #0b0b0b; --ink-2: #52514e; --ink-3: #898781;
  --grid: #e1e0d9; --baseline: #c3c2b7;
  --border: rgba(11,11,11,0.09); --border-strong: rgba(11,11,11,0.18);
  --series-1: #2a78d6; --series-1-soft: #cde2fb; --series-1-ink: #1c5cab;
  --good: #006300; --good-bg: rgba(12,163,12,0.10); --good-mark: #0ca30c;
  --warn: #eda100; --save-bg: rgba(237,161,0,0.12);
  --crit: #d03b3b;
  --chip-bg: rgba(42,120,214,0.09); --chip-ink: #1c5cab;
  --shadow-sm: 0 1px 2px rgba(11,11,11,0.04), 0 1px 1px rgba(11,11,11,0.03);
  --shadow-md: 0 6px 18px -6px rgba(11,11,11,0.12), 0 2px 4px rgba(11,11,11,0.04);
  --hero-tint: rgba(42,120,214,0.08);
}
@media (prefers-color-scheme: dark) {
  :root {
    --surface-1: #1a1a19; --plane: #0d0d0d; --surface-2: #141413;
    --ink-1: #ffffff; --ink-2: #c3c2b7; --ink-3: #898781;
    --grid: #2c2c2a; --baseline: #383835;
    --border: rgba(255,255,255,0.09); --border-strong: rgba(255,255,255,0.20);
    --series-1: #3987e5; --series-1-soft: #184f95; --series-1-ink: #86b6ef;
    --good: #0ca30c; --good-bg: rgba(12,163,12,0.14); --good-mark: #0ca30c;
    --warn: #c98500; --save-bg: rgba(250,178,25,0.12);
    --crit: #e66767;
    --chip-bg: rgba(57,135,229,0.15); --chip-ink: #86b6ef;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.4);
    --shadow-md: 0 8px 24px -8px rgba(0,0,0,0.6);
    --hero-tint: rgba(57,135,229,0.14);
  }
}
* { box-sizing: border-box; margin: 0; }
[hidden] { display: none !important; }
body {
  background: var(--plane); color: var(--ink-1);
  font: 15px/1.5 Inter, "SF Pro Text", system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased; padding: 28px 16px 96px;
}
.wrap { max-width: 1100px; margin: 0 auto; }
button, input, select { font: inherit; }
:focus-visible { outline: 2px solid var(--series-1); outline-offset: 2px; }
.num { font-variant-numeric: tabular-nums; }

/* ── hero ───────────────────────────────────────────────── */
.hero {
  background: linear-gradient(135deg, var(--hero-tint), transparent 60%), var(--surface-1);
  border: 1px solid var(--border); border-radius: 20px; box-shadow: var(--shadow-sm);
  padding: 26px 28px 24px;
}
.eyebrow { font-size: 11.5px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--series-1-ink); }
.hero h1 { font-size: 30px; line-height: 1.15; letter-spacing: -0.025em; font-weight: 700; margin-top: 6px; }
.hero .summary { color: var(--ink-2); font-size: 15px; margin-top: 8px; }
.hero .summary strong { color: var(--ink-1); font-weight: 600; }
.hero .sub { color: var(--ink-3); font-size: 12.5px; margin-top: 10px; }

/* ── stat tiles ─────────────────────────────────────────── */
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px,1fr)); gap: 10px; margin: 16px 0; }
.tile {
  background: var(--surface-1); border: 1px solid var(--border); box-shadow: var(--shadow-sm);
  border-radius: 14px; padding: 13px 15px; cursor: pointer; text-align: left; color: inherit;
  transition: transform .15s, box-shadow .15s, border-color .15s;
}
.tile:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); border-color: var(--border-strong); }
.tile.active { border-color: var(--series-1); box-shadow: 0 0 0 1px var(--series-1), var(--shadow-sm); }
.tile .l { font-size: 11.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); }
.tile .v { font-size: 26px; font-weight: 650; letter-spacing: -0.02em; margin-top: 2px; font-variant-numeric: tabular-nums; }

/* ── jobs-per-day chart ─────────────────────────────────── */
.chart-card {
  background: var(--surface-1); border: 1px solid var(--border); box-shadow: var(--shadow-sm);
  border-radius: 14px; padding: 16px 18px 12px; margin-bottom: 22px;
}
.chart-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
.chart-card h2 { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.chart-card .max { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.bars { display: flex; align-items: flex-end; gap: 2px; height: 80px; border-bottom: 1px solid var(--baseline); }
.bar { flex: 1; min-width: 3px; background: var(--series-1); border-radius: 4px 4px 0 0; position: relative; cursor: pointer; }
.bar::after { content: ""; position: absolute; inset: -80px -1px 0; }  /* hit target taller than the mark */
.bar:hover { background: var(--series-1-ink); }
.bar .tip {
  display: none; position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
  background: var(--ink-1); color: var(--plane); font-size: 11.5px; padding: 4px 9px;
  border-radius: 7px; white-space: nowrap; z-index: 5; font-variant-numeric: tabular-nums;
}
.bar:hover .tip { display: block; }
.bar-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-3); margin-top: 5px; }

/* ── tabs + controls ────────────────────────────────────── */
.tabs {
  display: flex; gap: 2px; padding: 4px; margin-bottom: 12px; overflow-x: auto; scrollbar-width: none;
  background: var(--surface-1); border: 1px solid var(--border); border-radius: 999px; box-shadow: var(--shadow-sm);
}
.tabs::-webkit-scrollbar { display: none; }
.tab {
  background: transparent; border: 0; color: var(--ink-2); white-space: nowrap;
  border-radius: 999px; padding: 7px 14px; font-size: 13px; font-weight: 500; cursor: pointer;
}
.tab:hover { color: var(--ink-1); background: var(--chip-bg); }
.tab.active { background: var(--series-1); color: #fff; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; align-items: center; }
.controls input[type=search], .controls select {
  height: 40px; background: var(--surface-1); color: var(--ink-1);
  border: 1px solid var(--border); border-radius: 10px; padding: 0 12px; font-size: 14px;
  box-shadow: var(--shadow-sm);
}
.controls input[type=search] { flex: 1 1 240px; }
.controls select:hover, .controls input:hover { border-color: var(--border-strong); }
.bar-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 4px 0 12px; flex-wrap: wrap; }
.count-note { color: var(--ink-3); font-size: 13px; font-variant-numeric: tabular-nums; }
.toolbar { display: flex; gap: 8px; }
.toolbar button {
  font-size: 12.5px; background: var(--surface-1); border: 1px solid var(--border); color: var(--ink-2);
  border-radius: 9px; padding: 6px 11px; cursor: pointer;
}
.toolbar button:hover { color: var(--series-1); border-color: var(--series-1); }
.toolbar button.sync-on { border-color: var(--good-mark); color: var(--good); }

/* ── job cards ──────────────────────────────────────────── */
.job {
  background: var(--surface-1); border: 1px solid var(--border); box-shadow: var(--shadow-sm);
  border-radius: 14px; padding: 16px 18px; margin-bottom: 10px; position: relative;
  display: grid; grid-template-columns: 48px 1fr auto; gap: 4px 16px; align-items: start;
  transition: box-shadow .15s, border-color .15s;
}
.job:hover { box-shadow: var(--shadow-md); border-color: var(--border-strong); }
.job.applied { background: linear-gradient(90deg, var(--good-bg), transparent 40%), var(--surface-1); }
.job.saved { background: linear-gradient(90deg, var(--save-bg), transparent 40%), var(--surface-1); }
.job.applied::before, .job.saved::before {
  content: ""; position: absolute; left: -1px; top: 14px; bottom: 14px; width: 3px; border-radius: 0 3px 3px 0;
  background: var(--good-mark);
}
.job.saved::before { background: var(--warn); }
.score {
  width: 48px; height: 48px; border-radius: 12px; display: grid; place-items: center; align-content: center;
  font-weight: 700; font-size: 16px; line-height: 1; background: var(--chip-bg); color: var(--chip-ink);
  font-variant-numeric: tabular-nums;
}
.score small { font-size: 9px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; opacity: .8; margin-top: 3px; }
.score.hot { background: var(--series-1); color: #fff; }
.job h3 { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.35; }
.job h3 a { color: var(--ink-1); text-decoration: none; }
.job h3 a:hover { color: var(--series-1); }
.meta { color: var(--ink-2); font-size: 13.5px; margin-top: 3px; }
.meta .co { font-weight: 600; color: var(--ink-1); }
.meta .dot { color: var(--ink-3); margin: 0 6px; }
.badges { margin-top: 9px; display: flex; flex-wrap: wrap; gap: 5px; }
.chip {
  font-size: 11.5px; line-height: 1; padding: 5px 9px; border-radius: 999px;
  background: var(--chip-bg); color: var(--chip-ink); font-weight: 500;
}
.chip.flag-local { background: var(--good-bg); color: var(--good); font-weight: 600; }
.chip.flag-src { background: transparent; box-shadow: inset 0 0 0 1px var(--border); color: var(--ink-2); }
.chip.flag-new { background: var(--crit); color: #fff; font-weight: 700; letter-spacing: .04em; }
.chip.type-ft { background: var(--good-bg); color: var(--good); font-weight: 600; }
.chip.type-other { background: var(--save-bg); color: var(--ink-1); font-weight: 600; }
.chip.flag-warn { background: transparent; box-shadow: inset 0 0 0 1px var(--warn); color: var(--ink-2); }
.chip.muted { background: transparent; color: var(--ink-3); padding-left: 2px; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.actions button {
  font-size: 12.5px; height: 30px; padding: 0 11px; border-radius: 8px; cursor: pointer;
  background: transparent; border: 1px solid var(--border); color: var(--ink-2); white-space: nowrap;
}
.actions button:hover { border-color: var(--series-1); color: var(--series-1); }
.actions button.on-applied { background: var(--good-mark); border-color: var(--good-mark); color: #fff; }
.actions button.on-saved { background: var(--warn); border-color: var(--warn); color: #1a1a19; }
.actions button.on { border-color: var(--series-1); color: var(--series-1); background: var(--chip-bg); }
.apply-btn {
  display: inline-flex; align-items: center; height: 38px; padding: 0 18px; border-radius: 10px;
  background: var(--series-1); color: #fff; text-decoration: none; font-weight: 600; font-size: 13.5px;
  box-shadow: 0 1px 2px rgba(11,11,11,0.12), inset 0 1px 0 rgba(255,255,255,0.15); white-space: nowrap;
}
.apply-btn:hover { background: var(--series-1-ink); }
@media (prefers-color-scheme: dark) { .apply-btn:hover { background: #256abf; } }

/* ── interview prep panel ───────────────────────────────── */
.prep {
  grid-column: 2 / -1; margin-top: 12px; background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 12px; padding: 12px 14px; font-size: 13px; color: var(--ink-2);
}
.prep .focus { margin-bottom: 8px; line-height: 1.5; }
.prep .focus strong { color: var(--ink-1); }
.prep ol { margin: 0; padding-left: 22px; columns: 2 260px; column-gap: 24px; }
.prep li { margin: 3px 0; break-inside: avoid; font-variant-numeric: tabular-nums; }
.prep a { color: var(--series-1-ink); text-decoration: none; }
.prep a:hover { text-decoration: underline; }
.prep .none { color: var(--ink-3); }

.loadmore {
  display: block; margin: 22px auto; padding: 10px 28px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface-1); color: var(--ink-1); cursor: pointer;
  box-shadow: var(--shadow-sm);
}
.loadmore:hover { border-color: var(--series-1); }
.empty { text-align: center; color: var(--ink-3); padding: 48px 0; }

/* ── Google Sheets sync settings panel ──────────────────── */
.settings {
  background: var(--surface-1); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-sm);
  padding: 16px 18px; margin-bottom: 16px; font-size: 13px;
}
.settings h2 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.settings p { color: var(--ink-2); font-size: 12.5px; margin-bottom: 12px; line-height: 1.55; }
.settings .field { display: flex; gap: 8px; flex-wrap: wrap; }
.settings input {
  flex: 1 1 320px; height: 38px; background: var(--plane); color: var(--ink-1);
  border: 1px solid var(--border); border-radius: 9px; padding: 0 12px; font-size: 13px;
}
.settings .save { background: var(--series-1); border: 0; color: #fff; border-radius: 9px; padding: 0 16px; height: 38px; font-weight: 600; cursor: pointer; }
.settings .status { margin-top: 10px; font-size: 12.5px; }
.settings .status.ok { color: var(--good); }
.settings .status.off { color: var(--ink-3); }

/* ── toast ──────────────────────────────────────────────── */
#toast {
  position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%) translateY(20px);
  background: var(--ink-1); color: var(--plane); padding: 11px 18px; border-radius: 999px; box-shadow: var(--shadow-md);
  font-size: 13px; opacity: 0; pointer-events: none; transition: opacity .25s, transform .25s; z-index: 50;
  max-width: calc(100vw - 32px); text-align: center;
}
#toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
#toast.err { background: var(--crit); color: #fff; }
/* ── 🎮 game HUD ────────────────────────────────────────── */
.hud {
  display: grid; grid-template-columns: 1.2fr 1.4fr auto; gap: 18px; align-items: center;
  background: var(--surface-1); border: 1px solid var(--border); border-radius: 16px;
  box-shadow: var(--shadow-sm); padding: 16px 18px; margin-top: 16px;
}
.hud-player { display: flex; gap: 14px; align-items: center; min-width: 0; }
.lvl {
  flex: none; width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; align-content: center;
  background: var(--series-1); color: #fff; font-weight: 750; font-size: 22px; line-height: 1;
  box-shadow: inset 0 -3px 0 rgba(0,0,0,0.18); font-variant-numeric: tabular-nums;
}
.lvl small { font-size: 9px; letter-spacing: .08em; text-transform: uppercase; opacity: .85; margin-bottom: 3px; }
.lvl.pop { animation: pop .6s ease; }
@keyframes pop { 40% { transform: scale(1.18) rotate(-4deg); } }
.hud-main { flex: 1; min-width: 0; }
.hud-title { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; font-weight: 650; font-size: 15px; }
.hud-title .xp { font-size: 12.5px; font-weight: 500; color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.xpbar { height: 10px; border-radius: 999px; background: var(--chip-bg); margin: 8px 0 6px; overflow: hidden; }
.xpbar div { height: 100%; border-radius: 999px; background: var(--series-1); transition: width .6s cubic-bezier(.2,.8,.2,1); }
.hud-next { font-size: 12px; color: var(--ink-3); }
.hud-h { font-size: 11.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); display: flex; justify-content: space-between; margin-bottom: 6px; }
.hud-h .streak { text-transform: none; letter-spacing: 0; font-size: 12.5px; color: var(--ink-2); font-weight: 600; }
.quests { list-style: none; padding: 0; display: grid; gap: 5px; }
.quests li { display: grid; grid-template-columns: 18px 1fr auto; gap: 8px; align-items: center; font-size: 13px; color: var(--ink-2); }
.quests .ck {
  width: 18px; height: 18px; border-radius: 6px; box-shadow: inset 0 0 0 1.5px var(--border-strong);
  display: grid; place-items: center; font-size: 11px; color: #fff;
}
.quests li.done .ck { background: var(--good-mark); box-shadow: none; }
.quests li.done .q { text-decoration: line-through; color: var(--ink-3); }
.quests .n { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.hud-side { display: flex; flex-direction: column; gap: 8px; }
.play-btn {
  height: 44px; padding: 0 20px; border-radius: 12px; border: 0; cursor: pointer; font-weight: 700; font-size: 14.5px;
  color: #fff; background: linear-gradient(135deg, var(--series-1), #4a3aa7);
  box-shadow: 0 6px 16px -6px rgba(42,120,214,0.6), inset 0 1px 0 rgba(255,255,255,0.2);
  transition: transform .15s;
}
.play-btn:hover { transform: translateY(-1px) scale(1.02); }
.badge-btn {
  height: 34px; border-radius: 10px; border: 1px solid var(--border); background: transparent;
  color: var(--ink-2); cursor: pointer; font-size: 13px;
}
.badge-btn:hover { border-color: var(--series-1); color: var(--series-1); }
.badges-panel {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px;
  background: var(--surface-1); border: 1px solid var(--border); border-radius: 14px; padding: 14px; margin-top: 10px;
}
.badge { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 10px; background: var(--surface-2); }
.badge .ico { font-size: 22px; filter: grayscale(1); opacity: .35; }
.badge.got .ico { filter: none; opacity: 1; }
.badge b { display: block; font-size: 13px; }
.badge span { font-size: 11.5px; color: var(--ink-3); }
.badge.got { box-shadow: inset 0 0 0 1px var(--good-mark); }

/* ── LeetCode solved checkboxes ─────────────────────────── */
.prep li label { display: inline-flex; gap: 7px; align-items: center; cursor: pointer; }
.prep li input { accent-color: var(--good-mark); width: 15px; height: 15px; cursor: pointer; }
.prep li.solved a { text-decoration: line-through; color: var(--ink-3); }
.prep .solved-note { margin-top: 8px; font-size: 12px; color: var(--ink-3); }

/* ── XP float + confetti ────────────────────────────────── */
.xp-float {
  position: fixed; z-index: 70; pointer-events: none; font-weight: 800; font-size: 15px; color: var(--good-mark);
  text-shadow: 0 1px 0 rgba(0,0,0,0.15); animation: floatup 1.1s ease-out forwards; font-variant-numeric: tabular-nums;
}
@keyframes floatup { from { opacity: 1; transform: translate(-50%, 0); } to { opacity: 0; transform: translate(-50%, -48px); } }
#confetti { position: fixed; inset: 0; pointer-events: none; z-index: 60; }

/* ── 🎮 Quick Play overlay ──────────────────────────────── */
.qp {
  position: fixed; inset: 0; z-index: 40; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 20px 16px; background: rgba(8,8,8,0.62); backdrop-filter: blur(6px);
}
.qp[hidden] { display: none; }
.qp-top { width: min(560px, 100%); display: flex; justify-content: space-between; align-items: center; color: #fff; font-size: 13px; margin-bottom: 10px; }
.qp-top button { background: rgba(255,255,255,0.12); color: #fff; border: 0; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
.qp-combo { font-weight: 800; color: #fab219; min-width: 80px; text-align: center; }
.qp-card {
  width: min(560px, 100%); background: var(--surface-1); color: var(--ink-1); border-radius: 20px; padding: 22px 22px 18px;
  box-shadow: 0 30px 60px -20px rgba(0,0,0,0.5); transition: transform .22s ease, opacity .22s ease; min-height: 280px;
}
.qp-card.fly-left { transform: translateX(-120%) rotate(-10deg); opacity: 0; }
.qp-card.fly-right { transform: translateX(120%) rotate(10deg); opacity: 0; }
.qp-card.fly-up { transform: translateY(-110%) scale(.9); opacity: 0; }
.qp-card .top { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.qp-card h3 { font-size: 20px; letter-spacing: -0.02em; line-height: 1.25; }
.qp-card .meta { font-size: 14px; margin-top: 4px; }
.qp-card .badges { margin-top: 12px; }
.qp-card .focus { margin-top: 14px; font-size: 13px; color: var(--ink-2); background: var(--surface-2); border-radius: 12px; padding: 10px 12px; }
.qp-card .focus ol { margin: 6px 0 0; padding-left: 20px; }
.qp-card .empty-deck { text-align: center; padding: 50px 0; font-size: 16px; }
.qp-controls, .qp-confirm { width: min(560px, 100%); display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 10px; margin-top: 14px; }
.qp-confirm { grid-template-columns: 1.4fr 1fr; background: var(--surface-1); border-radius: 16px; padding: 12px; color: var(--ink-1); }
.qp-confirm p { grid-column: 1 / -1; font-weight: 600; text-align: center; }
.qp-controls button, .qp-confirm button {
  height: 50px; border-radius: 14px; border: 0; cursor: pointer; font-weight: 700; font-size: 15px;
  background: var(--surface-1); color: var(--ink-1); box-shadow: var(--shadow-md); transition: transform .12s;
}
.qp-controls button:hover, .qp-confirm button:hover { transform: translateY(-2px); }
.qp-controls .pass { color: var(--crit); }
.qp-controls .save { color: #b07800; }
.qp-controls .go, .qp-confirm .yes { background: var(--series-1); color: #fff; }
.qp-hint { color: rgba(255,255,255,0.7); font-size: 12px; margin-top: 12px; text-align: center; }
.qp-tip { color: rgba(255,255,255,0.85); font-size: 12.5px; margin-top: 6px; text-align: center; max-width: 560px; }
@media (max-width: 760px) {
  .hud { grid-template-columns: 1fr; }
  .hud-side { flex-direction: row; }
  .play-btn { flex: 1; }
}
@media (prefers-reduced-motion: reduce) { .qp-card, .xpbar div { transition: none; } .lvl.pop, .xp-float { animation: none; } }
@media (max-width: 640px) {
  body { padding-top: 16px; }
  .hero { padding: 20px; border-radius: 16px; }
  .hero h1 { font-size: 24px; }
  .job { grid-template-columns: 1fr; padding: 14px; }
  .score { display: none; }
  .apply-btn { justify-content: center; order: 3; }
  .prep { grid-column: 1; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div class="eyebrow">Job Hunt · Chan Hen</div>
    <h1>Entry-level SWE &amp; tech roles</h1>
    <div class="summary" id="summary"></div>
    <div class="sub">Updated __GENERATED__ · latest scrape __LATEST_DAY__ · US only · ranked by skill match, full-time, in-person</div>
  </header>
    <section class="hud" id="hud" aria-label="Job hunt progress">
      <div class="hud-player">
        <div class="lvl" id="hudLvl"><small>Lv</small>1</div>
        <div class="hud-main">
          <div class="hud-title"><span id="hudTitle">Resume Rookie</span><span class="xp" id="hudXp"></span></div>
          <div class="xpbar" role="progressbar" aria-label="XP to next level" id="hudBarWrap"><div id="hudBar" style="width:0"></div></div>
          <div class="hud-next" id="hudNext"></div>
        </div>
      </div>
      <div>
        <div class="hud-h">Daily quests <span class="streak" id="hudStreak"></span></div>
        <ul class="quests" id="hudQuests"></ul>
      </div>
      <div class="hud-side">
        <button class="play-btn" id="playBtn" title="Triage jobs one at a time — keyboard friendly">🎮 Quick Play</button>
        <button class="badge-btn" id="badgeBtn">🏆 <span id="hudBadges"></span></button>
      </div>
    </section>
    <div class="badges-panel" id="badgesPanel" hidden></div>

  <div class="tiles" id="tiles"></div>

  <div class="chart-card">
    <div class="chart-head"><h2>New listings per day · last 30 days</h2><span class="max" id="barMax"></span></div>
    <div class="bars" id="bars"></div>
    <div class="bar-axis" id="barAxis"></div>
  </div>

  <div class="tabs" id="tabs"></div>

  <div class="controls">
    <input type="search" id="q" placeholder="Search title, company, location, skill…">
    <select id="jobType" title="Job type">
      <option value="Full-time">Full-time</option>
      <option value="">All job types</option>
      <option value="Contract">Contract</option>
      <option value="Part-time">Part-time</option>
      <option value="Temporary">Temporary</option>
      <option value="?">Unspecified</option>
    </select>
    <select id="cat"><option value="">All roles</option></select>
    <select id="source"><option value="">All sources</option></select>
    <select id="sort">
      <option value="score">Sort: Best match</option>
      <option value="date">Sort: Newest</option>
    </select>
  </div>

  <div class="bar-row">
    <div class="count-note" id="countNote"></div>
    <div class="toolbar">
      <button id="syncBtn" title="Connect your Google Sheet">⚙ Sheet sync</button>
      <button id="exportBtn" title="Download Applied + Saved in your sheet's column order">⬇ Export tracked</button>
    </div>
  </div>

  <div class="settings" id="settings" hidden>
    <h2>📗 Google Sheets auto-fill</h2>
    <p>When you mark a job <strong>✓ Applied</strong>, a row is added to your tracker sheet
       (Last Update · Company · Job · Location · Status · Application · Job Type · LeetCode Prep).
       Not connected? Use <strong>📋 Copy row</strong> on any job and paste into an empty row of the sheet.
       Paste your Apps Script <strong>Web App URL</strong> below — see the one-time setup in the repo's
       <code>sheet-sync/README.md</code>.</p>
    <div class="field">
      <input type="url" id="sheetUrl" placeholder="https://script.google.com/macros/s/…/exec">
      <button class="save" id="sheetSave">Save &amp; test</button>
    </div>
    <div class="status off" id="sheetStatus">Not connected — Applied marks stay in this browser only.</div>
  </div>

  <div id="list"></div>
  <button class="loadmore" id="loadMore" hidden>Show more</button>
</div>
<div id="toast"></div>
<div class="qp" id="qp" hidden role="dialog" aria-modal="true" aria-label="Quick Play">
  <div class="qp-top"><span id="qpLeft"></span><span class="qp-combo" id="qpCombo"></span><button id="qpClose">✕ Esc</button></div>
  <div class="qp-card" id="qpCard"></div>
  <div class="qp-controls" id="qpControls">
    <button class="pass" data-act="pass">← Pass</button>
    <button class="save" data-act="save">↑ Save</button>
    <button class="go" data-act="apply">Open &amp; apply →</button>
  </div>
  <div class="qp-confirm" id="qpConfirm" hidden>
    <p>Did you submit the application?</p>
    <button class="yes" data-act="yes">✓ Yes, applied <small>(Enter)</small></button>
    <button data-act="later">Not yet, save it</button>
  </div>
  <div class="qp-hint">← pass · ↑ save · → open &amp; apply · Esc to exit — works on your current tab &amp; filters</div>
  <div class="qp-tip" id="qpTip"></div>
</div>
<canvas id="confetti"></canvas>

<script>
const JOBS = __JOBS_JSON__;
const PREPS = __PREPS_JSON__;
const LATEST = "__LATEST_DAY__";
const PAGE = 100;

/* ── status persistence (per-browser) ─────────────────────── */
const LS_KEY = "chan-job-status-v1";
const LS_URL = "chan-sheet-url-v1";
const LS_SYNCED = "chan-sheet-synced-v1";   // ids already pushed to the sheet
let statusMap = {}, syncedSet = {};
try { statusMap = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch (e) {}
try { syncedSet = JSON.parse(localStorage.getItem(LS_SYNCED) || "{}"); } catch (e) {}
let sheetUrl = localStorage.getItem(LS_URL) || "";

function setStatus(id, s, opts) {
  const prev = (statusMap[id] || {}).s || "";
  if (s) statusMap[id] = { s, t: localDay() };
  else delete statusMap[id];
  try { localStorage.setItem(LS_KEY, JSON.stringify(statusMap)); } catch (e) {}
  // Auto-fill the Google Sheet the first time a job becomes "Applied"
  if (s === "applied" && prev !== "applied") {
    game.times = [...game.times, new Date().getHours()].slice(-50);
    const job = JOBS.find(j => j.id === id);
    if (job) syncToSheet(job);
  }
  if (!(opts && opts.quiet)) floatXP(statusXP(prev, s));
  render();
}
const st = id => (statusMap[id] || {}).s || "";

/* ── Google Sheets sync ───────────────────────────────────── */
function toast(msg, isErr) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show" + (isErr ? " err" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ""; }, 2600);
}

function syncToSheet(job, opts) {
  opts = opts || {};
  if (!sheetUrl) {
    if (!opts.silent) toast("Set your Google Sheet URL in ⚙ Sheet sync", true);
    return;
  }
  if (syncedSet[job.id] && !opts.force) return;   // already logged
  const payload = {
    date: today(),
    company: job.company, title: job.title, location: job.location,
    status: "Applied", url: job.url, id: job.id,
    jobType: job.jobType || "",
    prep: job.prep !== undefined ? PREPS[job.prep].text : "",
  };
  // Apps Script needs a "simple" request (text/plain) to skip the CORS preflight
  fetch(sheetUrl, {
    method: "POST", mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  }).then(() => {
    syncedSet[job.id] = 1;
    localStorage.setItem(LS_SYNCED, JSON.stringify(syncedSet));
    if (!opts.silent) toast("✓ Added to Google Sheet — " + job.company);
  }).catch(() => {
    if (!opts.silent) toast("Sheet sync failed — check the URL", true);
  });
}

function refreshSyncUI() {
  const on = !!sheetUrl;
  document.getElementById("syncBtn").classList.toggle("sync-on", on);
  const s = document.getElementById("sheetStatus");
  s.className = "status " + (on ? "ok" : "off");
  s.textContent = on
    ? "✓ Connected — new Applied marks are added to your sheet automatically."
    : "Not connected — Applied marks stay in this browser only.";
  document.getElementById("sheetUrl").value = sheetUrl;
}

/* ── state ────────────────────────────────────────────────── */
const LS_TYPE = "chan-job-type-v1";
let tab = "new", query = "", source = "", sortBy = "score", shown = PAGE, cat = "";
let jobType = "Full-time";
try { const t = localStorage.getItem(LS_TYPE); if (t !== null) jobType = t; } catch (e) {}
const openPrep = {};

const TABS = [
  ["new", "🆕 New today"],
  ["all", "All jobs"],
  ["local", "📍 Minnesota"],
  ["onsite", "🏢 In-person"],
  ["hybrid", "🔀 Hybrid"],
  ["remote", "🌐 Remote"],
  ["junior", "🎓 Entry-level"],
  ["swe", "💻 SWE"],
  ["adjacent", "🧭 Tech-adjacent"],
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
    case "junior":  return j.junior;
    case "swe":     return j.swe;
    case "adjacent": return !j.swe;
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
    (!cat || j.cat === cat) &&
    (!jobType || (jobType === "?" ? !j.jobType : j.jobType === jobType)) &&
    (!q || (j.title + " " + j.company + " " + j.location + " " + j.catLabel + " " + j.chips.join(" ")).toLowerCase().includes(q))
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
  checkProgress();
  const rows = filtered();
  document.getElementById("countNote").textContent = "Showing " +
    rows.length + (jobType && jobType !== "?" ? " " + jobType.toLowerCase() : "") +
    " listing" + (rows.length === 1 ? "" : "s") +
    (tab === "new" ? " found today (" + LATEST + ")" : "");
  const list = document.getElementById("list");
  list.innerHTML = rows.slice(0, shown).map(card).join("") ||
    '<div class="empty">Nothing here — try another tab, job type, or clear the search.</div>';
  document.getElementById("loadMore").hidden = rows.length <= shown;
}

function cardBadges(j) {
  const modeBadge = { onsite: "🏢 In-person", hybrid: "🔀 Hybrid", remote: "🌐 Remote" }[j.mode] || "";
  return [
    j.date === LATEST ? '<span class="chip flag-new">NEW</span>' : "",
    j.local ? '<span class="chip flag-local">📍 Minnesota</span>' : "",
    '<span class="chip ' + (j.jobType === "Full-time" ? "type-ft" : "type-other") + '">' + esc(j.jobType || "Type ?") + "</span>",
    modeBadge ? '<span class="chip flag-src">' + modeBadge + "</span>" : "",
    '<span class="chip flag-src">' + esc(j.catLabel) + "</span>",
    j.exp ? '<span class="chip flag-src">🎓 ' + esc(j.exp) + "</span>" : "",
    j.gradWindow ? '<span class="chip flag-warn" title="New-grad posting — check the required graduation window; many also accept grads within 12–24 months">⚠ check grad window</span>' : "",
    ...j.chips.map(c => '<span class="chip">' + esc(c) + "</span>"),
    '<span class="chip muted">' + esc(j.source) + " · " + esc(j.date) + "</span>",
  ].join("");
}

function card(j) {
  const s = st(j.id);
  const cls = s === "applied" ? "job applied" : s === "saved" ? "job saved" : "job";
  const badges = cardBadges(j);
  return `<div class="${cls}">
    <div class="score ${j.score >= 10 ? "hot" : ""}" title="Match score: skills, entry-level, full-time, in-person, Minnesota">${j.score}<small>match</small></div>
    <div>
      <h3><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a></h3>
      <div class="meta"><span class="co">${esc(j.company) || "—"}</span><span class="dot">·</span>${esc(j.location)}</div>
      <div class="badges">${badges}</div>
      <div class="actions">
        <button class="${s === "applied" ? "on-applied" : ""}" onclick="setStatus('${j.id}','${s === "applied" ? "" : "applied"}')">✓ Applied${s === "applied" && statusMap[j.id] ? " " + statusMap[j.id].t.slice(5) : ""}</button>
        <button class="${s === "saved" ? "on-saved" : ""}" onclick="setStatus('${j.id}','${s === "saved" ? "" : "saved"}')">★ Save${s === "saved" ? "d" : ""}</button>
        <button class="${openPrep[j.id] ? "on" : ""}" onclick="togglePrep('${j.id}')">${PREPS[j.prep].coding ? "🧠 LeetCode prep" : "🧠 Interview prep"}</button>
        <button onclick="copyRow('${j.id}')" title="Copy as a row for your Google Sheet">📋 Copy row</button>
        <button onclick="setStatus('${j.id}','${s === "hidden" ? "" : "hidden"}')">${s === "hidden" ? "↩ Unhide" : "Hide"}</button>
      </div>
    </div>
    <a class="apply-btn" href="${esc(j.url)}" target="_blank" rel="noopener">Apply ↗</a>
    ${openPrep[j.id] ? prepPanel(PREPS[j.prep]) : ""}
  </div>`;
}

function prepPanel(p) {
  const list = p.problems.length
    ? "<ol>" + p.problems.map(([n, name, url]) =>
        `<li class="${game.solved[n] ? "solved" : ""}"><label><input type="checkbox" ${game.solved[n] ? "checked" : ""} onchange="toggleSolved(${n}, this)" aria-label="Mark #${n} solved"><a href="${esc(url)}" target="_blank" rel="noopener">#${n} ${esc(name)}</a></label></li>`).join("") + "</ol>" +
      '<div class="solved-note">Tick a problem when you solve it: +20 XP. Solved problems stay ticked on every job.</div>'
    : '<div class="none">No LeetCode needed for this role type.</div>';
  return `<div class="prep"><div class="focus"><strong>${p.coding ? "Coding interview likely." : "Usually no coding interview."}</strong> ${esc(p.focus)}</div>${list}</div>`;
}

function togglePrep(id) { openPrep[id] = !openPrep[id]; render(); }

/* ── rows in the tracker sheet's column order ──────────────── */
const SHEET_COLS = ["Last Update", "Company", "Job", "Location", "Status", "Application", "Job Type", "LeetCode Prep"];
function today() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}
function sheetRow(j, status, date) {
  return [date || today(), j.company, j.title, j.location, status, j.url, j.jobType || "", PREPS[j.prep].text];
}
function copyRow(id) {
  const j = JOBS.find(x => x.id === id);
  const s = st(id);
  const tsv = sheetRow(j, s === "applied" ? "Applied" : s === "saved" ? "Saved" : "Applied")
    .map(v => String(v).replace(/[\t\n]+/g, " ")).join("\t");
  const done = () => toast("📋 Copied — click a blank row's first cell in your sheet and paste");
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(tsv).then(done, () => fallbackCopy(tsv, done));
  } else fallbackCopy(tsv, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; document.body.append(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { toast("Copy failed", true); }
  ta.remove();
}

function renderTiles() {
  const visible = JOBS.filter(j => st(j.id) !== "hidden");
  const ft = visible.filter(j => j.jobType === "Full-time");
  document.getElementById("summary").innerHTML =
    `<strong class="num">${visible.filter(j => j.date === LATEST).length}</strong> new today · ` +
    `<strong class="num">${ft.length}</strong> full-time · ` +
    `<strong class="num">${visible.filter(j => j.local).length}</strong> in Minnesota · ` +
    `<strong class="num">${JOBS.filter(j => st(j.id) === "applied").length}</strong> applied`;
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
    `<button class="tile ${tab === k ? "active" : ""}" onclick="goTab('${k}')"><div class="l">${l}</div><div class="v">${v}</div></button>`
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
       <span class="tip">${d} · ${byDay[d]} jobs</span></div>`
  ).join("");
  document.getElementById("barMax").textContent = "peak " + max + "/day";
  document.getElementById("barAxis").innerHTML =
    `<span>${days[0] || ""}</span><span>${days[days.length - 1] || ""}</span>`;
}

/* ── export tracked jobs ──────────────────────────────────── */
document.getElementById("exportBtn").onclick = () => {
  const rows = JOBS.filter(j => ["applied", "saved"].includes(st(j.id)))
    .map(j => {
      const t = (statusMap[j.id] || {}).t || "";
      const date = t ? `${t.slice(5, 7)}/${t.slice(8, 10)}/${t.slice(0, 4)}` : "";
      return sheetRow(j, st(j.id) === "applied" ? "Applied" : "Saved", date);
    });
  const csv = [SHEET_COLS, ...rows]
    .map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "tracked_jobs.csv";
  a.click();
};

/* ── wire controls ────────────────────────────────────────── */
document.getElementById("q").oninput = e => { query = e.target.value; shown = PAGE; render(); };
document.getElementById("source").onchange = e => { source = e.target.value; shown = PAGE; render(); };
document.getElementById("cat").onchange = e => { cat = e.target.value; shown = PAGE; render(); };
const typeSel = document.getElementById("jobType");
typeSel.value = jobType;
typeSel.onchange = e => {
  jobType = e.target.value; shown = PAGE;
  try { localStorage.setItem(LS_TYPE, jobType); } catch (err) {}
  render();
};
document.getElementById("sort").onchange = e => { sortBy = e.target.value; render(); };
document.getElementById("loadMore").onclick = () => { shown += PAGE; render(); };

/* ── Google Sheets settings panel ─────────────────────────── */
document.getElementById("syncBtn").onclick = () => {
  const p = document.getElementById("settings");
  p.hidden = !p.hidden;
};
document.getElementById("sheetSave").onclick = () => {
  const v = document.getElementById("sheetUrl").value.trim();
  if (v && !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(v)) {
    toast("That doesn't look like an Apps Script /exec URL", true); return;
  }
  sheetUrl = v;
  localStorage.setItem(LS_URL, sheetUrl);
  refreshSyncUI();
  if (sheetUrl) {
    // Send a one-row connection test the user can see land in the sheet
    syncToSheet({ id: "__test__", company: "(sync test)", title: "Connection OK — delete this row",
                  location: "", url: "" }, { force: true });
  } else {
    toast("Sheet sync turned off");
  }
};

const catSel = document.getElementById("cat");
[...new Map(JOBS.map(j => [j.cat, j.catLabel])).entries()]
  .sort((a, b) => a[1].localeCompare(b[1]))
  .forEach(([k, l]) => { const o = document.createElement("option"); o.value = k; o.textContent = l; catSel.append(o); });

const srcSel = document.getElementById("source");
[...new Set(JOBS.map(j => j.source))].sort().forEach(s => {
  const o = document.createElement("option"); o.value = o.textContent = s; srcSel.append(o);
});

/* ═══ 🎮 GAME LAYER ═══════════════════════════════════════════
   XP is derived from real progress (applications, saves, solved
   LeetCode problems, Quick Play triage, daily clears, badges), so
   un-marking something takes its XP back — no farming.          */
const LS_GAME = "chan-job-game-v1";
let game = { solved: {}, triaged: 0, triDay: "", triToday: 0, unlocked: {}, clears: {}, lastLevel: 1, times: [], init: false };
try { Object.assign(game, JSON.parse(localStorage.getItem(LS_GAME) || "{}")); } catch (e) {}
function saveGame() { try { localStorage.setItem(LS_GAME, JSON.stringify(game)); } catch (e) {} }
const JOB_BY_ID = Object.fromEntries(JOBS.map(j => [j.id, j]));
const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

const TITLES = ["Resume Rookie", "Cover Letter Cadet", "Networking Novice", "Recruiter Whisperer",
  "OA Survivor", "Phone-Screen Pro", "Onsite Warrior", "Offer Magnet", "Negotiation Ninja",
  "Final Boss of Job Hunting"];
const levelStart = n => 50 * n * (n - 1);          // L2 = 100 XP, L3 = 300, L4 = 600, L5 = 1000 …
function levelFor(xp) { let n = 1; while (xp >= levelStart(n + 1)) n++; return n; }
const titleFor = n => TITLES[Math.min(n, TITLES.length) - 1] + (n > TITLES.length ? " " + "★".repeat(Math.min(n - TITLES.length, 5)) : "");

const TIPS = [
  "Tailor the top 3 resume bullets to the job title — it's the part recruiters actually read.",
  "Apply within 48 hours of a posting going live; early applicants get screened first.",
  "Found someone on the team? A 2-line LinkedIn note beats a cover letter.",
  "Local roles (📍) have far fewer applicants than remote ones.",
  "One LeetCode medium a day beats a 6-hour weekend cram.",
  "“Engineer I” and “Associate” roles don't care when you graduated — only that you're early career.",
  "Say your approach out loud while you code — interviewers grade communication too.",
  "Keep a STAR story ready for: a bug you fixed, a conflict, and something you shipped.",
];

const BADGES = [
  ["first",   "🩸", "First Blood",     "Submit your first application",       s => s.applied >= 1],
  ["ten",     "🔟", "Double Digits",   "10 applications",                     s => s.applied >= 10],
  ["fifty",   "🚀", "Half-Century",    "50 applications",                     s => s.applied >= 50],
  ["hundred", "💯", "Centurion",       "100 applications",                    s => s.applied >= 100],
  ["local",   "📍", "Local Legend",    "Apply to 3 Minnesota jobs",           s => s.local >= 3],
  ["grass",   "🏢", "Touch Grass",     "Apply to 5 in-person jobs",           s => s.onsite >= 5],
  ["explore", "🧭", "Explorer",        "Apply across 4 role categories",      s => s.cats >= 4],
  ["streak3", "🔥", "On Fire",         "3-day activity streak",               s => s.streak >= 3],
  ["streak7", "🌋", "Unstoppable",     "7-day activity streak",               s => s.streak >= 7],
  ["lc10",    "🧠", "Grinder",         "Solve 10 LeetCode problems",          s => s.solved >= 10],
  ["lc50",    "🐉", "LeetCode Dragon", "Solve 50 LeetCode problems",          s => s.solved >= 50],
  ["speed",   "⚡", "Speed Runner",    "Triage 25 jobs in Quick Play",        s => game.triaged >= 25],
  ["clear",   "🎯", "Quest Clear",     "Finish all daily quests once",        s => s.clears >= 1],
  ["early",   "🌅", "Early Bird",      "Apply before 9 AM",                   s => game.times.some(h => h < 9)],
  ["owl",     "🦉", "Night Owl",       "Apply after 11 PM",                   s => game.times.some(h => h >= 23)],
];

function localDay(d) {
  d = d || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function gameStats() {
  const today = localDay();
  const entries = Object.entries(statusMap);
  const appliedIds = entries.filter(([, v]) => v.s === "applied").map(([k]) => k);
  const appliedJobs = appliedIds.map(id => JOB_BY_ID[id]).filter(Boolean);
  const solvedDays = Object.values(game.solved);
  // activity streak: consecutive days (ending today or yesterday) with an application or a solve
  const active = new Set([...entries.filter(([, v]) => v.s === "applied").map(([, v]) => v.t), ...solvedDays]);
  let streak = 0; const d = new Date();
  if (!active.has(localDay(d))) d.setDate(d.getDate() - 1);
  while (active.has(localDay(d))) { streak++; d.setDate(d.getDate() - 1); }
  const s = {
    applied: appliedIds.length,
    saved: entries.filter(([, v]) => v.s === "saved").length,
    solved: solvedDays.length,
    appliedToday: entries.filter(([, v]) => v.s === "applied" && v.t === today).length,
    solvedToday: solvedDays.filter(x => x === today).length,
    triagedToday: game.triDay === today ? game.triToday : 0,
    local: appliedJobs.filter(j => j.local).length,
    onsite: appliedJobs.filter(j => j.mode === "onsite").length,
    cats: new Set(appliedJobs.map(j => j.cat)).size,
    clears: Object.keys(game.clears).length,
    streak, today,
  };
  s.quests = [
    ["Apply to 3 jobs", s.appliedToday, 3],
    ["Solve 2 LeetCode problems", s.solvedToday, 2],
    ["Triage 10 jobs in Quick Play", s.triagedToday, 10],
  ];
  s.xp = s.applied * 50 + s.saved * 10 + s.solved * 20 + game.triaged * 2 +
         s.clears * 50 + Object.keys(game.unlocked).length * 25;
  return s;
}

/* Detect unlocks / level-ups and celebrate them (silently on first ever load). */
function checkProgress() {
  let s = gameStats();
  const quiet = !game.init;
  if (s.quests.every(([, n, goal]) => n >= goal) && !game.clears[s.today]) {
    game.clears[s.today] = 1;
    if (!quiet) { toast("🎯 All daily quests cleared! +50 XP"); confetti(160); }
  }
  s = gameStats();
  const fresh = BADGES.filter(([id, , , , test]) => !game.unlocked[id] && test(s));
  fresh.forEach(([id, ico, name]) => {
    game.unlocked[id] = s.today;
    if (!quiet) setTimeout(() => { toast(`${ico} Badge unlocked: ${name}! +25 XP`); confetti(120); }, 300);
  });
  s = gameStats();
  const lvl = levelFor(s.xp);
  if (lvl > game.lastLevel && !quiet) {
    setTimeout(() => {
      toast(`⬆ Level ${lvl}! You're now a ${titleFor(lvl)}`);
      confetti(260);
      const el = document.getElementById("hudLvl");
      el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
    }, fresh.length ? 1400 : 200);
  }
  game.lastLevel = lvl;
  game.init = true;
  saveGame();
  renderHUD(s);
}

function renderHUD(s) {
  s = s || gameStats();
  const lvl = levelFor(s.xp), lo = levelStart(lvl), hi = levelStart(lvl + 1);
  const pct = Math.round((s.xp - lo) / (hi - lo) * 100);
  document.getElementById("hudLvl").innerHTML = `<small>Lv</small>${lvl}`;
  document.getElementById("hudTitle").textContent = titleFor(lvl);
  document.getElementById("hudXp").textContent = `${s.xp.toLocaleString()} XP`;
  document.getElementById("hudBar").style.width = pct + "%";
  const wrap = document.getElementById("hudBarWrap");
  wrap.setAttribute("aria-valuenow", pct); wrap.setAttribute("aria-valuemin", 0); wrap.setAttribute("aria-valuemax", 100);
  document.getElementById("hudNext").textContent =
    `${(hi - s.xp).toLocaleString()} XP to Lv ${lvl + 1} · ✓ applied +50 · 🧠 solved +20 · ★ saved +10 · 🎮 triaged +2`;
  document.getElementById("hudStreak").textContent = s.streak ? `🔥 ${s.streak}-day streak` : "Start a streak today";
  document.getElementById("hudQuests").innerHTML = s.quests.map(([q, n, goal]) =>
    `<li class="${n >= goal ? "done" : ""}"><span class="ck">${n >= goal ? "✓" : ""}</span><span class="q">${q}</span><span class="n">${Math.min(n, goal)}/${goal}</span></li>`).join("");
  const got = Object.keys(game.unlocked).length;
  document.getElementById("hudBadges").textContent = `${got}/${BADGES.length} badges`;
  const panel = document.getElementById("badgesPanel");
  if (!panel.hidden) panel.innerHTML = BADGES.map(([id, ico, name, desc]) =>
    `<div class="badge ${game.unlocked[id] ? "got" : ""}"><span class="ico">${ico}</span><div><b>${name}</b><span>${game.unlocked[id] ? "Unlocked " + game.unlocked[id] : desc}</span></div></div>`).join("");
}

/* ── juice: floating XP + confetti ─────────────────────────── */
let lastPt = { x: innerWidth / 2, y: innerHeight / 2 };
document.addEventListener("pointerdown", e => { lastPt = { x: e.clientX, y: e.clientY }; }, true);
function floatXP(n, pt) {
  if (!n) return;
  pt = pt || lastPt;
  const el = document.createElement("div");
  el.className = "xp-float";
  el.textContent = (n > 0 ? "+" : "") + n + " XP";
  if (n < 0) el.style.color = "var(--ink-3)";
  el.style.left = pt.x + "px"; el.style.top = (pt.y - 12) + "px";
  document.body.append(el);
  setTimeout(() => el.remove(), 1200);
}
const CONFETTI_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"];
let confettiParts = [], confettiRAF = 0;
function confetti(n) {
  if (REDUCED) return;
  const cv = document.getElementById("confetti"), ctx = cv.getContext("2d");
  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  for (let i = 0; i < n; i++) confettiParts.push({
    x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .35,
    vx: (Math.random() - .5) * 14, vy: -Math.random() * 13 - 4, r: Math.random() * Math.PI,
    vr: (Math.random() - .5) * .3, w: 6 + Math.random() * 6, h: 3 + Math.random() * 4,
    c: CONFETTI_COLORS[i % CONFETTI_COLORS.length], life: 0,
  });
  if (confettiRAF) return;
  const tick = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    confettiParts.forEach(p => {
      p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.globalAlpha = Math.max(0, 1 - p.life / 140); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    });
    confettiParts = confettiParts.filter(p => p.life < 140 && p.y < innerHeight + 40);
    confettiRAF = confettiParts.length ? requestAnimationFrame(tick) : (ctx.clearRect(0, 0, innerWidth, innerHeight), 0);
  };
  confettiRAF = requestAnimationFrame(tick);
}

/* XP delta for a status change, shown as a float */
function statusXP(prev, s) { const v = { applied: 50, saved: 10 }; return (v[s] || 0) - (v[prev] || 0); }

/* ── LeetCode solved toggles (global per problem) ──────────── */
function toggleSolved(n, el) {
  if (game.solved[n]) { delete game.solved[n]; floatXP(-20); }
  else { game.solved[n] = localDay(); floatXP(20); if (!REDUCED) confetti(24); }
  saveGame();
  render();
}

/* ── 🎮 Quick Play ─────────────────────────────────────────── */
let qpDeck = [], qpIdx = 0, qpCombo = 0, qpLastAt = 0, qpBusy = false;
function qpOpen() {
  qpDeck = filtered().filter(j => !st(j.id));
  qpIdx = 0; qpCombo = 0;
  document.getElementById("qp").hidden = false;
  document.body.style.overflow = "hidden";
  document.getElementById("qpTip").textContent = "💡 " + TIPS[Math.floor(Math.random() * TIPS.length)];
  qpShow();
}
function qpClose() {
  document.getElementById("qp").hidden = true;
  document.body.style.overflow = "";
  render();
}
function qpCur() { return qpDeck[qpIdx]; }
function qpShow() {
  const card = document.getElementById("qpCard");
  card.className = "qp-card";
  document.getElementById("qpConfirm").hidden = true;
  document.getElementById("qpControls").hidden = false;
  const j = qpCur();
  document.getElementById("qpLeft").textContent = j ? `${qpDeck.length - qpIdx} left in this view` : "";
  document.getElementById("qpCombo").textContent = qpCombo >= 3 ? `🔥 combo ×${qpCombo}` : "";
  if (!j) {
    card.innerHTML = `<div class="empty-deck">🎉 <b>Inbox zero!</b><br><span class="count-note">You've triaged every job in this view. Try another tab or job type.</span></div>`;
    document.getElementById("qpControls").hidden = true;
    if (qpDeck.length) confetti(200);
    return;
  }
  const p = PREPS[j.prep];
  const probs = p.problems.slice(0, 3).map(([n, name]) => `<li>${game.solved[n] ? "✅" : ""} #${n} ${esc(name)}</li>`).join("");
  card.innerHTML = `
    <div class="top">
      <div>
        <h3>${esc(j.title)}</h3>
        <div class="meta"><span class="co">${esc(j.company) || "—"}</span><span class="dot">·</span>${esc(j.location)}</div>
      </div>
      <div class="score ${j.score >= 10 ? "hot" : ""}">${j.score}<small>match</small></div>
    </div>
    <div class="badges">${cardBadges(j)}</div>
    <div class="focus"><b>${p.coding ? "🧠 Coding interview likely" : "🗣 Usually no coding round"}</b> — ${esc(p.focus)}${probs ? `<ol>${probs}</ol>` : ""}</div>`;
}
function qpNext(dir, xp) {
  const now = Date.now();
  qpCombo = now - qpLastAt < 12000 ? qpCombo + 1 : 1;
  qpLastAt = now;
  const t = localDay();
  if (game.triDay !== t) { game.triDay = t; game.triToday = 0; }
  game.triaged++; game.triToday++;
  saveGame();
  const r = document.getElementById("qpCard").getBoundingClientRect();
  floatXP(xp + 2, { x: r.left + r.width / 2, y: r.top + 30 });
  if (qpCombo > 0 && qpCombo % 10 === 0) confetti(90);
  qpBusy = true;
  document.getElementById("qpCard").classList.add("fly-" + dir);
  setTimeout(() => { qpIdx++; qpBusy = false; qpShow(); checkProgress(); }, REDUCED ? 0 : 230);
}
function qpAct(act) {
  const j = qpCur();
  if (!j || qpBusy) return;
  if (act === "pass") { setStatus(j.id, "hidden", { quiet: true }); qpNext("left", 0); }
  else if (act === "save") { setStatus(j.id, "saved", { quiet: true }); qpNext("up", 10); }
  else if (act === "apply") {
    window.open(j.url, "_blank", "noopener");
    document.getElementById("qpControls").hidden = true;
    document.getElementById("qpConfirm").hidden = false;
  } else if (act === "yes") { setStatus(j.id, "applied", { quiet: true }); qpNext("right", 50); }
  else if (act === "later") { setStatus(j.id, "saved", { quiet: true }); qpNext("up", 10); }
}
document.getElementById("qp").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (b) qpAct(b.dataset.act);
});
document.getElementById("qpClose").onclick = qpClose;
document.getElementById("playBtn").onclick = qpOpen;
document.getElementById("badgeBtn").onclick = () => {
  const p = document.getElementById("badgesPanel"); p.hidden = !p.hidden; renderHUD();
};
document.addEventListener("keydown", e => {
  if (document.getElementById("qp").hidden) return;
  const confirming = !document.getElementById("qpConfirm").hidden;
  if (e.key === "Escape") qpClose();
  else if (confirming && e.key === "Enter") qpAct("yes");
  else if (confirming && (e.key === "ArrowUp" || e.key === "Backspace")) qpAct("later");
  else if (!confirming && e.key === "ArrowLeft") qpAct("pass");
  else if (!confirming && e.key === "ArrowUp") qpAct("save");
  else if (!confirming && e.key === "ArrowRight") qpAct("apply");
  else return;
  e.preventDefault();
});

refreshSyncUI();
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
