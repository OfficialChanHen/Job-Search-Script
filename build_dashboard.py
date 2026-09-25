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

from enrich import COMPANY_FILE, ENRICH_FILE, STACK, company_key, is_too_experienced
from interview_prep import prep_for, prep_text
from job_rules import (
    CATEGORY_LABEL, SWE_CATEGORIES, infer_job_type, is_target_title,
    is_us_location, role_category, url_key,
)

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DOCS_DIR = BASE_DIR / "docs"
OUT_HTML = DOCS_DIR / "index.html"
LIVE_FILE = DATA_DIR / "live_jobs.json"

# Old CSV source labels that share a live-posting snapshot with a newer source
LIVE_SOURCE_ALIAS = {"GitHub/NewGrad": "GitHub/Simplify"}
LIVE_MAX_AGE_DAYS = 3       # only trust a board snapshot this fresh
STALE_DAYS = 30             # untracked sources: older than this → "may be filled"
REPOST_MIN = 3              # same title+company on this many different days → flag

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


def _load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}


ENRICH = _load_json(ENRICH_FILE)        # per job: summary, years, topics (enrich.py)
COMPANIES = _load_json(COMPANY_FILE)    # per company: summary + source
USED_COMPANIES: dict[str, dict] = {}    # only the ones shipped in the page


def _prep_id(title: str, company: str, topics: list | None = None, seed: str = "") -> int:
    prep = prep_for(title, company, topics=topics, seed=seed)
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
    # the full posting (enrich.py) asks for 2+ years, or LinkedIn says Mid-Senior+
    if is_too_experienced(ENRICH.get(row.get("id", ""))):
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

    rec = ENRICH.get(row.get("id", "")) or {}
    years = rec.get("y")
    exp = ("0 yrs" if years == 0 else f"{years} yr" if years is not None else "") or row.get("experience", "")
    junior = bool(JUNIOR_RE.search(title)) or (years is not None and years <= 1) or row.get("experience", "") in (
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
    if years is not None and years <= 1:     # confirmed 0–1 years from the posting
        score += 2

    # company summary: the posting's own "About us", else the shared company cache
    ck = company_key(row.get("company", ""))
    co = COMPANIES.get(ck) or {}
    if rec.get("about"):
        USED_COMPANIES.setdefault(ck, {"s": rec["about"], "src": "posting"})
    elif co.get("s"):
        USED_COMPANIES.setdefault(ck, {k: co[k] for k in ("s", "src", "u") if co.get(k)})
    summary = {k: rec[k] for k in ("sum", "do", "need", "pay", "stack") if rec.get(k)}

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
        "exp": exp,
        "gradWindow": bool(GRAD_WINDOW_RE.search(title)),
        "prep": _prep_id(title, row.get("company", ""), rec.get("tp"), row.get("id", "")),
        "gone": rec.get("st") == "gone",
        **({"sm": summary} if summary else {}),
        **({"ck": ck} if ck in USED_COMPANIES else {}),
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
    flag_closed_and_reposts(jobs)
    # Best matches first, newest first within the same score
    jobs.sort(key=lambda j: (-j["score"], j["date"]), reverse=False)
    jobs.sort(key=lambda j: j["date"], reverse=True)
    jobs.sort(key=lambda j: -j["score"])
    return jobs


def _days(a: str, b: str) -> int:
    try:
        return (datetime.strptime(b, "%Y-%m-%d") - datetime.strptime(a, "%Y-%m-%d")).days
    except ValueError:
        return 0


def flag_closed_and_reposts(jobs: list[dict]) -> None:
    """
    closed  — the job's board was re-checked recently and the posting is gone
    reposts — same title + company found on N different days (evergreen /
              ghost-job signal: often never filled, or always "open")
    stale   — source can't be re-checked and the listing is 30+ days old
    """
    latest = max((j["date"] for j in jobs), default="")
    live: dict = {}
    if LIVE_FILE.exists():
        try:
            live = json.loads(LIVE_FILE.read_text(encoding="utf-8"))
        except ValueError:
            live = {}
    live_sets: dict[tuple[str, str], tuple[str, set]] = {}
    for src, companies in live.items():
        for comp, snap in companies.items():
            live_sets[(src, comp)] = (snap.get("d", ""), set(snap.get("h", [])))

    norm = lambda t: re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()
    # title + company + location: big employers legitimately post many
    # openings with the same title, but not the same one in the same city
    # over and over
    key = lambda j: norm(j["title"]) + "|" + norm(j["company"]) + "|" + norm(j["location"])
    days_seen: dict[str, set[str]] = {}
    for j in jobs:
        days_seen.setdefault(key(j), set()).add(j["date"])

    for j in jobs:
        src = LIVE_SOURCE_ALIAS.get(j["source"], j["source"])
        snap = live_sets.get((src, (j["company"] or "").strip().lower()))
        tracked = bool(snap) and _days(snap[0], latest) <= LIVE_MAX_AGE_DAYS
        j["closed"] = j.pop("gone", False) or bool(tracked and j["date"] < snap[0] and url_key(j["url"]) not in snap[1])
        j["reposts"] = len(days_seen[key(j)])
        j["stale"] = (not tracked) and _days(j["date"], latest) > STALE_DAYS
        if j["reposts"] >= REPOST_MIN:
            j["score"] -= 1
        if j["stale"]:
            j["score"] -= 1
    n_closed = sum(j["closed"] for j in jobs)
    print(f"Closed postings detected: {n_closed} · reposted ≥{REPOST_MIN}×: "
          f"{sum(j['reposts'] >= REPOST_MIN for j in jobs)} · stale: {sum(j['stale'] for j in jobs)}")


def build_html(jobs: list[dict]) -> str:
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    latest_day = max((j["date"] for j in jobs), default="")
    # </ must be escaped so job titles can never terminate the <script> block
    jobs_json = json.dumps(jobs, ensure_ascii=False).replace("</", "<\\/")
    preps_json = json.dumps(PREPS, ensure_ascii=False).replace("</", "<\\/")
    companies_json = json.dumps(USED_COMPANIES, ensure_ascii=False).replace("</", "<\\/")
    # same skill vocabulary enrich.py uses on postings, so resumes are read the same way
    vocab_json = json.dumps([[label, rx, "" if label == "R" else "i"] for label, rx in STACK]).replace("</", "<\\/")

    return HTML_TEMPLATE \
        .replace("__JOBS_JSON__", jobs_json) \
        .replace("__PREPS_JSON__", preps_json) \
        .replace("__COMPANIES_JSON__", companies_json) \
        .replace("__SKILL_VOCAB__", vocab_json) \
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
/* my links: one tap copies the address, the arrow opens it */
.my-links { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; margin-top: 14px; }
.my-link {
  display: flex; min-width: 0; border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface-1); box-shadow: var(--shadow-sm); overflow: hidden;
}
.my-link button {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 0 12px;
  background: transparent; border: 0; cursor: pointer; font-size: 13px; color: var(--ink-1); font-weight: 600; text-align: left;
}
.my-link button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-3); font-weight: 400; font-size: 12px; }
.my-link button:hover { background: var(--chip-bg); color: var(--series-1-ink); }
.my-link button.copied { color: var(--good); }
.my-link a {
  display: flex; align-items: center; padding: 0 12px; border-left: 1px solid var(--border);
  color: var(--ink-3); text-decoration: none; font-size: 13px;
}
.my-link a:hover { background: var(--chip-bg); color: var(--series-1-ink); }

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

/* ── follow-ups / reviews / results panels ──────────────── */
.hud-actions { display: flex; gap: 6px; }
.hud-actions .badge-btn { flex: 1; white-space: nowrap; padding: 0 8px; }
.badge-btn .dot-n { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--crit); color: #fff; font-size: 11px; font-weight: 700; margin-left: 4px; }
.side-panel {
  background: var(--surface-1); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-sm);
  padding: 16px 18px; margin-top: 10px; font-size: 13px;
}
.side-panel h2 { font-size: 15px; font-weight: 650; display: flex; justify-content: space-between; gap: 8px; align-items: baseline; margin-bottom: 4px; }
.side-panel h2 button { font-size: 12px; font-weight: 500; }
.side-panel .lead { color: var(--ink-3); font-size: 12.5px; margin-bottom: 10px; }
.fu-list { display: grid; gap: 8px; }
.fu {
  display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; align-items: center;
  padding: 10px 12px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border);
}
.fu b { font-size: 13.5px; }
.fu .sub2 { color: var(--ink-3); font-size: 12px; }
.fu .btns { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.mini {
  font-size: 12px; height: 28px; padding: 0 10px; border-radius: 8px; cursor: pointer; white-space: nowrap;
  background: transparent; border: 1px solid var(--border); color: var(--ink-2); display: inline-flex; align-items: center; text-decoration: none;
}
.mini:hover { border-color: var(--series-1); color: var(--series-1); }
.mini.primary { background: var(--series-1); border-color: var(--series-1); color: #fff; }
.mini.ok { background: var(--good-mark); border-color: var(--good-mark); color: #fff; }
.chip.flag-closed { background: var(--crit); color: #fff; font-weight: 600; }
.chip.flag-sheet { background: var(--good-bg); color: var(--good); }
.job.is-closed { opacity: .72; }

.drop {
  display: grid; place-items: center; min-height: 86px; border: 2px dashed var(--border-strong); border-radius: 12px;
  color: var(--ink-2); cursor: pointer; background: var(--plane); transition: border-color .15s, background .15s;
}
.drop:hover, .drop.over { border-color: var(--series-1); background: var(--chip-bg); color: var(--series-1-ink); }
.chip.flag-res { background: var(--chip-bg); color: var(--chip-ink); font-weight: 600; box-shadow: inset 0 0 0 1px var(--series-1); }
.sumbox.three { grid-template-columns: 1.4fr 1fr 1fr; }
@media (max-width: 900px) { .sumbox.three { grid-template-columns: 1fr; } }
/* job + company summary panel */
.sumbox { grid-column: 2 / -1; margin-top: 12px; display: grid; grid-template-columns: 1.5fr 1fr; gap: 12px; }
.sumbox > div { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; font-size: 13px; color: var(--ink-2); }
.sumbox h4 { font-size: 11.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 6px; }
.sumbox h4 + p, .sumbox p { margin: 0 0 8px; color: var(--ink-1); line-height: 1.5; }
.sumbox ul { margin: 0 0 8px; padding-left: 18px; }
.sumbox li { margin: 2px 0; line-height: 1.45; }
.sumbox .kv { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
.sumbox .src { font-size: 11.5px; color: var(--ink-3); }
.sumbox .src a { color: var(--series-1-ink); }
.sumbox .none { color: var(--ink-3); font-style: italic; }
@media (max-width: 760px) { .sumbox { grid-template-columns: 1fr; grid-column: 1; } }
.qp-card .sumline { margin-top: 12px; font-size: 13.5px; color: var(--ink-1); line-height: 1.5; }
.qp-card .sumline ul { margin: 6px 0 0; padding-left: 18px; color: var(--ink-2); font-size: 13px; }
.qp-card .coline { margin-top: 10px; font-size: 12.5px; color: var(--ink-3); line-height: 1.45; }
.qp-confirm { grid-template-columns: 1.4fr 1fr 1fr !important; }
.qp-confirm .pass { color: var(--crit); }

/* referral panel */
.ref { grid-column: 2 / -1; margin-top: 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; font-size: 13px; }
.ref .links { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 10px; }
.ref textarea {
  width: 100%; min-height: 84px; resize: vertical; border-radius: 9px; border: 1px solid var(--border);
  background: var(--surface-1); color: var(--ink-1); padding: 8px 10px; font: inherit; font-size: 12.5px; line-height: 1.45;
}
.ref .row2 { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
.ref .cc { font-size: 11.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.ref .cc.over { color: var(--crit); font-weight: 600; }

/* results */
.res-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin: 8px 0 12px; }
.res-kpis div { background: var(--surface-2); border-radius: 10px; padding: 9px 11px; }
.res-kpis .l { font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); }
.res-kpis .v { font-size: 20px; font-weight: 650; font-variant-numeric: tabular-nums; }
.stack { display: flex; gap: 2px; height: 14px; border-radius: 999px; overflow: hidden; background: var(--surface-1); }
.stack span { display: block; height: 100%; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; margin: 8px 0 14px; font-size: 12px; color: var(--ink-2); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
.res-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
.res-grid h3 { font-size: 12px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 6px; }
.rrow { display: grid; grid-template-columns: minmax(90px, 1.1fr) 1.4fr auto; gap: 8px; align-items: center; font-size: 12.5px; padding: 3px 0; }
.rrow .track { height: 8px; border-radius: 999px; background: var(--chip-bg); overflow: hidden; }
.rrow .fill { height: 100%; border-radius: 999px; background: var(--series-1); }
.rrow .num { color: var(--ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.rrow .small { color: var(--ink-3); font-style: italic; }
.insight { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: var(--chip-bg); color: var(--ink-1); font-size: 13px; }

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
@media (max-width: 640px) {
  .my-links { grid-template-columns: 1fr 1fr; }
  .my-link button, .my-link a { min-height: 44px; }
  .my-link button span { display: none; }
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
    <div class="my-links" id="myLinks" aria-label="My links"></div>
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
        <div class="hud-actions">
          <button class="badge-btn" id="fuBtn" title="Applications 7+ days old with no reply">📬 Follow-ups<span id="fuN"></span></button>
          <button class="badge-btn" id="revBtn" title="LeetCode problems due for spaced review">🔁 Reviews<span id="revN"></span></button>
        </div>
        <button class="badge-btn" id="badgeBtn">🏆 <span id="hudBadges"></span></button>
      </div>
    </section>
    <div class="badges-panel" id="badgesPanel" hidden></div>
    <div class="side-panel" id="sidePanel" hidden></div>

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
      <button id="resBtn" title="Drop your resumes to see which fits each job (stays in this browser)">📄 My resumes</button>
      <button id="resultsBtn" title="Response rates from your Google Sheet">📈 Results</button>
      <button id="syncBtn" title="Connect your Google Sheet">⚙ Sheet sync</button>
      <button id="exportBtn" title="Download Applied + Saved in your sheet's column order">⬇ Export tracked</button>
    </div>
  </div>

  <div class="settings" id="resPanel" hidden>
    <h2>📄 My resumes</h2>
    <p>Drop your resume PDFs here (text files work too). They're read <b>inside this browser</b> and only the list of
       skills found is kept here — nothing is uploaded, and nothing goes to GitHub. Every job then shows which resume
       covers the most of the skills its posting asks for, and which skills none of them mention.</p>
    <label class="drop" id="resDrop">
      <input type="file" id="resFile" accept=".pdf,.txt,.md,.html,application/pdf" multiple hidden>
      <span>⬇ Drag &amp; drop PDFs here, or <u>choose files</u></span>
    </label>
    <div class="fu-list" id="resList" style="margin-top:10px"></div>
  </div>
  <div class="settings" id="settings" hidden>
    <h2>📗 Google Sheets auto-fill</h2>
    <p>When you mark a job <strong>✓ Applied</strong>, a row is added to your tracker sheet
       (Last Update · Company · Job · Location · Status · Application · Job Type · LeetCode Prep).
       Not connected? Use <strong>📋 Copy row</strong> on any job and paste into an empty row of the sheet.
       Once connected, <strong>📈 Results</strong> and <strong>📬 Follow-ups</strong> read your sheet's Status column too
       (needs the version-3 <code>Code.gs</code>).
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
    <button data-act="later">Not yet, save it <small>(↑)</small></button>
    <button class="pass" data-act="nope">✕ Didn't apply, pass <small>(←)</small></button>
  </div>
  <div class="qp-hint">← pass · ↑ save · → open &amp; apply (then Enter = applied · ↑ save · ← pass) · Esc to exit — plays your current tab &amp; filters</div>
  <div class="qp-tip" id="qpTip"></div>
</div>
<canvas id="confetti"></canvas>

<script>
const JOBS = __JOBS_JSON__;
const PREPS = __PREPS_JSON__;
const COMPANIES = __COMPANIES_JSON__;
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
  // closed postings only stay visible where you're tracking them
  if (j.closed && tab !== "saved" && tab !== "applied") return false;
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
    j.closed ? '<span class="chip flag-closed" title="No longer on the company\'s job board">⛔ Closed</span>' : "",
    j.reposts >= 3 ? `<span class="chip flag-warn" title="Same title, company and location posted on ${j.reposts} different days — high-volume hiring, or an evergreen/ghost listing. Worth a referral before applying.">🔁 Posted ${j.reposts}×</span>` : "",
    j.stale ? '<span class="chip flag-src" title="Found 30+ days ago and this source can\'t be re-checked — may be filled">📅 30+ days old</span>' : "",
    (() => { const r = sheetRowFor(j.url); return r && r.status ? '<span class="chip flag-sheet">📗 ' + esc(r.status) + "</span>" : ""; })(),
    fitChip(j),
    j.gradWindow ? '<span class="chip flag-warn" title="New-grad posting — check the required graduation window; many also accept grads within 12–24 months">⚠ check grad window</span>' : "",
    ...j.chips.map(c => '<span class="chip">' + esc(c) + "</span>"),
    '<span class="chip muted">' + esc(j.source) + " · " + esc(j.date) + "</span>",
  ].join("");
}

function card(j) {
  const s = st(j.id);
  const cls = (s === "applied" ? "job applied" : s === "saved" ? "job saved" : "job") + (j.closed ? " is-closed" : "");
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
        <button class="${openSum[j.id] ? "on" : ""}" onclick="toggleSum('${j.id}')">📄 Summary</button>
        <button class="${openPrep[j.id] ? "on" : ""}" onclick="togglePrep('${j.id}')">${PREPS[j.prep].coding ? "🧠 LeetCode prep" : "🧠 Interview prep"}</button>
        <button class="${openRef[j.id] ? "on" : ""}" onclick="toggleRef('${j.id}')">🤝 Referral${game.outreach[j.id] ? " ✓" : ""}</button>
        <button onclick="copyRow('${j.id}')" title="Copy as a row for your Google Sheet">📋 Copy row</button>
        <button onclick="setStatus('${j.id}','${s === "hidden" ? "" : "hidden"}')">${s === "hidden" ? "↩ Unhide" : "Hide"}</button>
      </div>
    </div>
    <a class="apply-btn" href="${esc(j.url)}" target="_blank" rel="noopener">Apply ↗</a>
    ${openSum[j.id] ? sumPanel(j) : ""}
    ${openPrep[j.id] ? prepPanel(PREPS[j.prep]) : ""}
    ${openRef[j.id] ? refPanel(j) : ""}
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

/* ── 📄 job + company summary (from the full posting — enrich.py) ─ */
const openSum = {};
function toggleSum(id) { openSum[id] = !openSum[id]; render(); }
function companyOf(j) { return j.ck ? COMPANIES[j.ck] : null; }
function sumPanel(j) {
  const m = j.sm || {}, co = companyOf(j);
  const list = xs => xs && xs.length ? "<ul>" + xs.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "";
  const job = (m.sum || m.do || m.need)
    ? `${m.sum ? "<p>" + esc(m.sum) + "</p>" : ""}
       ${m.do ? "<h4>What you'd do</h4>" + list(m.do) : ""}
       ${m.need ? "<h4>What they want</h4>" + list(m.need) : ""}
       <div class="kv">${j.exp ? '<span class="chip flag-src">🎓 ' + esc(j.exp) + "</span>" : ""}
         ${m.pay ? '<span class="chip type-ft">💵 ' + esc(m.pay) + "</span>" : ""}
         ${(m.stack || []).map(t => '<span class="chip">' + esc(t) + "</span>").join("")}</div>`
    : '<p class="none">The full posting hasn\'t been read yet (it\'s fetched during the daily run) — open it with Apply ↗.</p>';
  const company = co && co.s
    ? `<p>${esc(co.s)}</p><div class="src">Source: ${co.src === "Wikipedia" && co.u
        ? '<a href="' + esc(co.u) + '" target="_blank" rel="noopener">Wikipedia</a>' : "the job posting"}</div>`
    : `<p class="none">No company description found.</p><div class="src"><a href="https://www.google.com/search?q=${encodeURIComponent(j.company + " company")}" target="_blank" rel="noopener">Search ${esc(j.company)} ↗</a></div>`;
  return `<div class="sumbox three"><div><h4>📄 The job</h4>${job}</div><div><h4>🏢 ${esc(j.company) || "The company"}</h4>${company}</div>
    <div><h4>🎯 Resume fit</h4>${fitBox(j)}</div></div>`;
}

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
  const vals = sheetRow(j, s === "applied" ? "Applied" : s === "saved" ? "Saved" : "Applied").map(String);
  // Plain text: TSV with the multi-line LeetCode cell quoted. HTML: a one-row
  // table with <br>s — Google Sheets prefers it, and keeps bullets in one cell.
  const tsv = vals.map(v => /[\t\n"]/.test(v) ? '"' + v.replace(/\t/g, " ").replace(/"/g, '""') + '"' : v).join("\t");
  const html = "<table><tr>" + vals.map(v => "<td>" + esc(v).replace(/\n/g, "<br>") + "</td>").join("") + "</tr></table>";
  const done = () => toast("📋 Copied — click a blank row's first cell in your sheet and paste");
  if (navigator.clipboard && window.isSecureContext && window.ClipboardItem) {
    navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([tsv], { type: "text/plain" }),
    })]).then(done, () => fallbackCopy(tsv, done));
  } else fallbackCopy(tsv, done);
}
/* ── my links, for pasting into applications (same addresses as the resumes) ── */
const MY_LINKS = [
  ["LinkedIn", "https://linkedin.com/in/chan-hen-13727b233"],
  ["GitHub", "https://github.com/OfficialChanHen"],
  ["Portfolio", "https://chanhen.space"],
  ["Hourelle", "https://hourelle.com"],
];
function renderMyLinks() {
  const bare = (u) => u.replace(/^https?:\/\//, "");
  const box = document.getElementById("myLinks");
  box.innerHTML = MY_LINKS.map(([name, url], i) =>
    `<span class="my-link"><button type="button" data-i="${i}" title="Copy ${url}">${name} <span>${bare(url)}</span></button>` +
    `<a href="${url}" target="_blank" rel="noopener" title="Open ${name}" aria-label="Open ${name}">↗</a></span>`).join("");
  box.onclick = (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const [name, url] = MY_LINKS[+b.dataset.i];
    copyText(url, `📋 Copied your ${name} link`);
    b.classList.add("copied"); clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove("copied"), 1400);
  };
}
renderMyLinks();

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
  ["connect", "🤝", "Connector",       "Reach out to 5 people for referrals", s => s.outreach >= 5],
  ["persist", "📬", "Persistent",      "Follow up on 5 applications",         s => s.followed >= 5],
  ["spaced",  "🔁", "Spaced Out",      "Finish 10 LeetCode reviews",          s => s.reviews >= 10],
  ["boss",    "🎤", "Boss Battle",     "Land an interview (from your sheet)", s => s.interviews >= 1],
  ["offer",   "👑", "Offer!",          "Get an offer (from your sheet)",      s => s.offers >= 1],
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
  const active = new Set([...entries.filter(([, v]) => v.s === "applied").map(([, v]) => v.t), ...solvedDays,
    ...Object.keys(game.outDays || {}), ...Object.keys(game.fuDays || {}), ...Object.keys(game.revDays || {})]);
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
    outreach: Object.keys(game.outreach || {}).length,
    followed: Object.values(game.followed || {}).filter(f => f.how === "done").length,
    reviews: game.reviews || 0,
    streak, today,
  };
  const sh = (game.sheet && game.sheet.rows && game.sheet.rows.length) ? sheetStats() : { c: { interview: 0, offer: 0 } };
  s.interviews = sh.c.interview + sh.c.offer;
  s.offers = sh.c.offer;
  s.lcToday = s.solvedToday + ((game.revDays || {})[today] || 0);
  s.netToday = ((game.outDays || {})[today] || 0) + ((game.fuDays || {})[today] || 0);
  s.quests = [
    ["Apply to 3 jobs", s.appliedToday, 3],
    ["Solve or review 2 LeetCode problems", s.lcToday, 2],
    ["Reach out or follow up once", s.netToday, 1],
    ["Triage 10 jobs in Quick Play", s.triagedToday, 10],
  ];
  s.xp = s.applied * 50 + s.saved * 10 + s.solved * 20 + game.triaged * 2 +
         s.clears * 50 + Object.keys(game.unlocked).length * 25 +
         s.outreach * 30 + s.followed * 15 + s.reviews * 10 +
         s.interviews * 200 + s.offers * 1000;
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
    `${(hi - s.xp).toLocaleString()} XP to Lv ${lvl + 1} · 🎤 interview +200 · ✓ applied +50 · 🤝 outreach +30 · 🧠 solved +20 · 📬 follow-up +15`;
  const nFu = typeof followUps === "function" ? followUps().length : 0;
  const nRev = typeof dueReviews === "function" ? dueReviews().length : 0;
  document.getElementById("fuN").innerHTML = nFu ? `<span class="dot-n">${nFu}</span>` : "";
  document.getElementById("revN").innerHTML = nRev ? `<span class="dot-n">${nRev}</span>` : "";
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
  if (game.solved[n]) { delete game.solved[n]; delete game.rev[n]; floatXP(-20); }
  else {
    game.solved[n] = localDay();
    game.rev[n] = { s: 0, due: addDays(localDay(), REVIEW_GAPS[0]) };   // first spaced review
    floatXP(20); if (!REDUCED) confetti(24);
  }
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
    ${(j.sm && (j.sm.sum || j.sm.do)) ? `<div class="sumline">${esc((j.sm.sum || "").slice(0, 260))}${j.sm.do ? "<ul>" + j.sm.do.slice(0, 2).map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : ""}</div>` : ""}
    ${companyOf(j) && companyOf(j).s ? `<div class="coline">🏢 ${esc(companyOf(j).s.slice(0, 220))}</div>` : ""}
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
  else if (act === "nope") { setStatus(j.id, "hidden", { quiet: true }); qpNext("left", 0); }
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
  else if (confirming && e.key === "ArrowLeft") qpAct("nope");
  else if (!confirming && e.key === "ArrowLeft") qpAct("pass");
  else if (!confirming && e.key === "ArrowUp") qpAct("save");
  else if (!confirming && e.key === "ArrowRight") qpAct("apply");
  else return;
  e.preventDefault();
});

/* ═══ 🤝 REFERRALS · 📬 FOLLOW-UPS · 🔁 REVIEWS · 📈 RESULTS ══════════ */
const DAY = 86400000;
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return localDay(d); };
const daysSince = iso => Math.floor((new Date(localDay() + "T12:00:00") - new Date(iso + "T12:00:00")) / DAY);
const liSearch = kw => "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(kw);
["outreach", "followed", "rev", "revDays", "outDays", "fuDays"].forEach(k => { if (!game[k]) game[k] = {}; });
if (!game.reviews) game.reviews = 0;
if (!game.sheet) game.sheet = { rows: [], at: 0 };

/* ── 🤝 referral / outreach panel on each card ─────────────── */
const openRef = {};
function toggleRef(id) { openRef[id] = !openRef[id]; render(); }
function outreachMsg(j) {
  return `Hi [Name], I'm Chan, a UW–Madison CS + Data Science grad. I'm applying for the ${j.title} role at ${j.company} ` +
         `and would love to hear what the team is like. Would you be open to a quick chat, or referring me? Thanks so much!`;
}
function refPanel(j) {
  const msg = outreachMsg(j), sent = game.outreach[j.id];
  return `<div class="ref">
    <b>🤝 Get a referral</b> — a note to someone on the team gets far more replies than a cold application.
    <div class="links">
      <a class="mini" href="${esc(liSearch(j.company + " University of Wisconsin"))}" target="_blank" rel="noopener">🎓 UW–Madison alumni</a>
      <a class="mini" href="${esc(liSearch(j.company + " recruiter"))}" target="_blank" rel="noopener">🧑‍💼 Recruiters</a>
      <a class="mini" href="${esc(liSearch(j.company + " software engineer"))}" target="_blank" rel="noopener">👩‍💻 Engineers</a>
    </div>
    <textarea id="msg-${j.id}" oninput="msgCount('${j.id}')">${esc(msg)}</textarea>
    <div class="row2">
      <span class="cc ${msg.length > 300 ? "over" : ""}" id="cc-${j.id}">${msg.length}/300 · LinkedIn connection notes max out at 300</span>
      <span>
        <button class="mini" onclick="copyText(document.getElementById('msg-${j.id}').value, '📋 Message copied — paste it into LinkedIn')">📋 Copy message</button>
        <button class="mini ${sent ? "ok" : "primary"}" onclick="toggleOutreach('${j.id}')">${sent ? "✓ Reached out " + sent.slice(5) : "✉ I reached out (+30 XP)"}</button>
      </span>
    </div>
  </div>`;
}
function msgCount(id) {
  const n = document.getElementById("msg-" + id).value.length, el = document.getElementById("cc-" + id);
  el.textContent = `${n}/300 · LinkedIn connection notes max out at 300`; el.classList.toggle("over", n > 300);
}
function bump(map, key) { map[key] = (map[key] || 0) + 1; }
function toggleOutreach(id) {
  if (game.outreach[id]) { delete game.outreach[id]; floatXP(-30); }
  else { game.outreach[id] = localDay(); bump(game.outDays, localDay()); floatXP(30); confetti(30); }
  saveGame(); render();
}
function copyText(text, msg) {
  const done = () => toast(msg || "📋 Copied");
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  else fallbackCopy(text, done);
}

/* ── 🔁 spaced review of solved LeetCode (3 → 7 → 14 days) ──── */
const REVIEW_GAPS = [3, 7, 14];
const PROBLEM_INFO = {};
PREPS.forEach(p => p.problems.forEach(([n, name, url]) => { PROBLEM_INFO[n] = { name, url }; }));
Object.entries(game.solved).forEach(([n, d]) => { if (!game.rev[n]) game.rev[n] = { s: 0, due: addDays(d, REVIEW_GAPS[0]) }; });
function dueReviews() {
  const t = localDay();
  return Object.entries(game.rev).filter(([n, r]) => game.solved[n] && r.due && r.due <= t)
    .map(([n, r]) => ({ n: +n, stage: r.s, due: r.due, ...(PROBLEM_INFO[n] || { name: "Problem", url: "https://leetcode.com/problemset/" }) }));
}
function markReviewed(n) {
  const r = game.rev[n] || { s: 0 };
  r.s += 1;
  r.due = r.s < REVIEW_GAPS.length ? addDays(localDay(), REVIEW_GAPS[r.s]) : null;   // null = mastered
  game.rev[n] = r; game.reviews += 1; bump(game.revDays, localDay());
  floatXP(10); saveGame(); openSide("reviews");
}

/* ── 📬 follow-ups: applications 7+ days old, no reply yet ─── */
const FOLLOW_UP_DAYS = 7;
function followUps() {
  const out = [], urls = new Set();
  Object.entries(statusMap).forEach(([id, v]) => {
    if (v.s !== "applied" || game.followed[id] || daysSince(v.t) < FOLLOW_UP_DAYS) return;
    const j = JOB_BY_ID[id];
    if (!j) return;
    urls.add(j.url);
    const sr = sheetRowFor(j.url);
    if (sr && outcomeOf(sr, 0) !== "pending") return;     // sheet already says rejected / interviewing
    out.push({ key: id, company: j.company, title: j.title, url: j.url, date: v.t, days: daysSince(v.t) });
  });
  (game.sheet.rows || []).forEach(r => {
    const iso = parseSheetDate(r.date);
    if (!iso || !r.url || urls.has(r.url) || !/^https?:/i.test(r.url)) return;
    const key = "u:" + r.url;
    if (game.followed[key] || outcomeOf(r, 0) !== "pending") return;
    const d = daysSince(iso);
    if (d < FOLLOW_UP_DAYS || d > 45) return;
    out.push({ key, company: r.company, title: r.title, url: r.url, date: iso, days: d });
  });
  return out.sort((a, b) => b.days - a.days);
}
function followMsg(f) {
  return `Hi [Name], I applied for the ${f.title} role at ${f.company} on ${f.date} and wanted to reiterate my interest. ` +
         `My background in React/TypeScript, Python and SQL lines up well with the role, and I'd be glad to share more. ` +
         `Is there anything else I can provide? Thanks, Chan`;
}
function markFollowed(key, how) {
  game.followed[key] = { d: localDay(), how };
  if (how === "done") { bump(game.fuDays, localDay()); floatXP(15); }
  saveGame(); openSide("followups");
}

/* ── 📈 results from the Google Sheet (Status column) ──────── */
const POS_RE = /interview|behavio|phone|screen|onsite|on-site|technical|\boa\b|assessment|final|offer|hired|round|recruiter call/i;
function outcomeOf(r, staleDays) {
  const s = (r.status || "").toLowerCase();
  if (/offer|hired/.test(s)) return "offer";
  if (POS_RE.test(s)) return "interview";
  if (/reject|declin|not selected|no longer/.test(s)) return "rejected";
  if (/ghost/.test(s)) return "noreply";
  if (/applied|submitted|pending|in review|under review/.test(s) || !s) {
    const iso = parseSheetDate(r.date);
    if (staleDays && iso && daysSince(iso) > staleDays) return "noreply";
    return "pending";
  }
  return "other";     // e.g. "Side Gig" — not an application outcome
}
function parseSheetDate(v) {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  let y = +m[3]; if (y < 100) y += 2000;
  return `${y}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}
let SHEET_BY_URL = {};
function indexSheet() {
  SHEET_BY_URL = {};
  (game.sheet.rows || []).forEach(r => { if (r.url) SHEET_BY_URL[r.url.trim()] = r; });
}
const sheetRowFor = url => SHEET_BY_URL[(url || "").trim()];
indexSheet();
async function loadSheetRows(force) {
  if (!sheetUrl) return;
  if (!force && Date.now() - (game.sheet.at || 0) < 20 * 60000) return;
  try {
    const res = await fetch(sheetUrl + "?rows=1");
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.rows)) throw new Error(data.error || "no rows");
    game.sheet = { rows: data.rows, at: Date.now() };
    saveGame(); indexSheet(); render();
    if (force) toast(`📗 Loaded ${data.rows.length} rows from your sheet`);
    if (!document.getElementById("sidePanel").hidden) openSide(sideView);
  } catch (e) {
    if (force) toast("Couldn't read the sheet — redeploy the new Code.gs (see sheet-sync/README)", true);
  }
}
function channelOf(app) {
  const a = (app || "").toLowerCase();
  if (!a) return "Not recorded";
  if (a.includes("simplify")) return "Simplify";
  if (a.includes("handshake")) return "Handshake";
  if (a.includes("linkedin")) return "LinkedIn";
  if (a.includes("indeed")) return "Indeed";
  if (a.includes("ziprecruit")) return "ZipRecruiter";
  if (a.includes("dice")) return "Dice";
  if (/greenhouse|lever\.co|ashbyhq|myworkdayjobs|icims|smartrecruiters|oraclecloud|workable|jobvite/.test(a)) return "Company site (ATS)";
  if (a.includes("company")) return "Company website";
  if (/^https?:/.test(a)) return "Other link";
  return "Other";
}
function placeOf(loc) {
  const l = (loc || "").toLowerCase();
  if (!l) return "Not recorded";
  if (/\bmn\b|minnesota|minneapolis|st\.? ?paul|shakopee|burnsville|eden prairie|chanh|plym|mounds view|minnetonka|twin cities|hopkins|eagan|bloomington/.test(l)) return "Minnesota";
  if (/remote|anywhere|worldwide/.test(l)) return "Remote";
  return "Elsewhere in US";
}
function roleOf(t) {
  const s = (t || "").toLowerCase();
  if (/data|analyst|analytics|bi\b/.test(s)) return "Data / analyst";
  if (/front|web|ui\b|react|design/.test(s)) return "Frontend / web";
  if (/\bqa\b|quality|test/.test(s)) return "QA / test";
  if (/ai\b|machine learning|ml\b/.test(s)) return "AI / ML";
  if (/engineer|developer|programmer|software|swe|sde/.test(s)) return "SWE / general";
  return "Other";
}
function sheetStats() {
  const rows = (game.sheet.rows || []).map(r => ({ ...r, o: outcomeOf(r, 30) })).filter(r => r.o !== "other");
  const c = { interview: 0, offer: 0, rejected: 0, noreply: 0, pending: 0 };
  rows.forEach(r => c[r.o]++);
  return { rows, c, positive: c.interview + c.offer };
}
function breakdown(rows, fn) {
  const g = {};
  rows.forEach(r => { const k = fn(r); (g[k] = g[k] || { n: 0, pos: 0, decided: 0 }); g[k].n++;
    if (r.o === "interview" || r.o === "offer") g[k].pos++;
    if (r.o !== "pending") g[k].decided++; });
  return Object.entries(g).sort((a, b) => b[1].n - a[1].n);
}
function resultsHTML() {
  if (!sheetUrl) return `<div class="lead">Connect your sheet in <b>⚙ Sheet sync</b> first — results are computed from its Status column.</div>`;
  const { rows, c, positive } = sheetStats();
  if (!rows.length) return `<div class="lead">No rows loaded yet. Click <b>↻ Refresh</b>. If it keeps failing, redeploy the new <code>Code.gs</code> (it adds read access).</div>`;
  const decided = rows.length - c.pending;
  const rate = decided ? Math.round(positive / decided * 100) : 0;
  const segs = [["Interview / offer", positive, "var(--good-mark)"], ["Rejected", c.rejected, "var(--crit)"],
                ["No reply (incl. 30+ days)", c.noreply, "var(--baseline)"], ["Waiting (< 30 days)", c.pending, "var(--series-1)"]];
  const stack = segs.filter(s => s[1]).map(([l, n, col]) => `<span title="${l}: ${n}" style="flex:${n};background:${col}"></span>`).join("");
  const legend = segs.map(([l, n, col]) => `<span><i style="background:${col}"></i>${l} <b class="num">${n}</b></span>`).join("");
  const table = (title, list) => `<div><h3>${title}</h3>${list.map(([k, v]) => {
    const r = v.decided ? v.pos / v.decided : 0;
    return `<div class="rrow"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${Math.max(r ? 4 : 0, Math.round(r * 100))}%"></div></div>
      <span class="num">${v.decided ? `${v.pos}/${v.decided} got interviews` : `${v.n} waiting`}${v.n < 5 ? ' <span class="small">· small sample</span>' : ""}</span></div>`;
  }).join("")}</div>`;
  const byChannel = breakdown(rows, r => channelOf(r.url));
  const best = byChannel.filter(([, v]) => v.decided >= 5).sort((a, b) => b[1].pos / b[1].decided - a[1].pos / a[1].decided)[0];
  const insight = best && best[1].pos
    ? `Best channel so far: <b>${esc(best[0])}</b> — ${best[1].pos} of ${best[1].decided} decided applications got an interview. Lean into it.`
    : `No channel with 5+ decided applications has produced an interview yet — the fix is usually <b>who sees your application</b>, not how many you send. Use 🤝 referrals and 📬 follow-ups on your next applications.`;
  return `
    <div class="res-kpis">
      <div><div class="l">Applications</div><div class="v">${rows.length}</div></div>
      <div><div class="l">Interview rate</div><div class="v">${rate}%</div></div>
      <div><div class="l">Interviews</div><div class="v">${positive}</div></div>
      <div><div class="l">Rejected</div><div class="v">${c.rejected}</div></div>
      <div><div class="l">No reply</div><div class="v">${c.noreply}</div></div>
    </div>
    <div class="stack" role="img" aria-label="Outcomes">${stack}</div>
    <div class="legend">${legend}</div>
    <div class="res-grid">
      ${table("By channel", byChannel)}
      ${table("By location", breakdown(rows, r => placeOf(r.location)))}
      ${table("By role type", breakdown(rows, r => roleOf(r.title)))}
      ${table("By month applied", breakdown(rows, r => (parseSheetDate(r.date) || "Undated").slice(0, 7)).sort((a, b) => a[0].localeCompare(b[0])))}
    </div>
    <div class="insight">💡 ${insight}</div>`;
}

/* ── side panel router ─────────────────────────────────────── */
let sideView = "";
function openSide(view) {
  sideView = view;
  const p = document.getElementById("sidePanel");
  p.hidden = false;
  if (view === "followups") {
    const list = followUps();
    p.innerHTML = `<h2>📬 Follow-ups due <button class="mini" onclick="closeSide()">Close</button></h2>
      <div class="lead">Applications ${FOLLOW_UP_DAYS}+ days old with no reply. A short, polite nudge to the recruiter (or the person you messaged) revives a surprising number. ✓ Followed up: +15 XP.</div>
      <div class="fu-list">${list.length ? list.map(f => `
        <div class="fu"><div><b>${esc(f.company)}</b> · ${esc(f.title)}<div class="sub2">Applied ${f.date} · ${f.days} days ago</div></div>
          <div class="btns">
            <a class="mini" href="${esc(liSearch(f.company + " recruiter"))}" target="_blank" rel="noopener">🧑‍💼 Find recruiter</a>
            <button class="mini" onclick="copyText(${esc(JSON.stringify(followMsg(f)))}, '📋 Follow-up message copied')">📋 Message</button>
            <button class="mini ok" onclick="markFollowed(${esc(JSON.stringify(f.key))}, 'done')">✓ Followed up</button>
            <button class="mini" onclick="markFollowed(${esc(JSON.stringify(f.key))}, 'skip')">Dismiss</button>
          </div></div>`).join("") : '<div class="lead">🎉 Nothing due — you\'re on top of it.</div>'}</div>`;
  } else if (view === "reviews") {
    const list = dueReviews();
    p.innerHTML = `<h2>🔁 LeetCode reviews due <button class="mini" onclick="closeSide()">Close</button></h2>
      <div class="lead">Solved problems come back after 3, 7 and 14 days so they stick for interviews. Re-solve from scratch (no peeking), then mark it: +10 XP.</div>
      <div class="fu-list">${list.length ? list.map(r => `
        <div class="fu"><div><b>#${r.n} ${esc(r.name)}</b><div class="sub2">Review ${r.stage + 1} of ${REVIEW_GAPS.length} · due ${r.due}</div></div>
          <div class="btns"><a class="mini primary" href="${esc(r.url)}" target="_blank" rel="noopener">Open ↗</a>
          <button class="mini ok" onclick="markReviewed(${r.n})">✓ Reviewed</button></div></div>`).join("")
        : '<div class="lead">Nothing due. Solve problems from any job\'s 🧠 prep panel and they\'ll show up here on schedule.</div>'}</div>`;
  } else if (view === "results") {
    p.innerHTML = `<h2>📈 Your results <span><button class="mini" onclick="loadSheetRows(true)">↻ Refresh</button> <button class="mini" onclick="closeSide()">Close</button></span></h2>
      <div class="lead">From your tracker sheet's Status column. "Applied" rows older than 30 days count as no reply.</div>${resultsHTML()}`;
  }
  renderHUD();
}
function closeSide() { document.getElementById("sidePanel").hidden = true; sideView = ""; }
document.getElementById("fuBtn").onclick = () => sideView === "followups" ? closeSide() : openSide("followups");
document.getElementById("revBtn").onclick = () => sideView === "reviews" ? closeSide() : openSide("reviews");
document.getElementById("resultsBtn").onclick = () => { if (sideView === "results") return closeSide(); openSide("results"); loadSheetRows(false); };

/* ═══ 📄 MY RESUMES — read and kept in this browser only ════════════
   Drop PDFs (or text) into the panel; each job then shows which resume
   covers the most of the skills its posting asks for.               */
const SKILL_VOCAB = __SKILL_VOCAB__.map(([l, rx, fl]) => [l, new RegExp(rx, fl)]);
const CHIP_TO_SKILL = { "React": "React", "React Native": "React Native", "TypeScript": "TypeScript", "Next.js": "Next.js",
  "Tailwind": "Tailwind CSS", "JavaScript": "JavaScript", "Python": "Python", "SQL": "SQL", "GraphQL": "GraphQL",
  "Node": "Node.js", "Figma": "Figma", "Java": "Java", "REST": "REST APIs", "CSS": "HTML/CSS", "Pandas": "pandas", "Expo": "Expo" };
const LS_RES = "chan-resumes-v1";
let resumes = [];
try { resumes = JSON.parse(localStorage.getItem(LS_RES) || "[]"); } catch (e) {}
function saveResumes() {
  try { localStorage.setItem(LS_RES, JSON.stringify(resumes)); }
  catch (e) { toast("Couldn't save — this browser's storage is full or blocked", true); }
}
const skillsIn = text => SKILL_VOCAB.filter(([, rx]) => rx.test(text)).map(([l]) => l);
// resume name → [role categories it's built for, ones it also suits]
const ROLE_HINTS = [
  [/front[- ]?end/i, ["frontend", "mobile"], ["swe"]],
  [/full[- ]?stack/i, ["swe", "devops", "solutions", "qa", "platform_dev"], ["frontend", "mobile", "data_eng"]],
  [/\bdata\b/i, ["data_analyst", "data_eng", "analyst"], ["ml_ai"]],
  [/\bai\b|machine learning|\bml\b/i, ["ml_ai", "ai_training"], ["data_eng", "data_analyst", "swe"]],
];
function roleFit(r, cat) {
  let best = 0;
  ROLE_HINTS.forEach(([rx, primary, secondary]) => {
    if (rx.test(r.name)) best = Math.max(best, primary.includes(cat) ? 12 : secondary.includes(cat) ? 6 : 0);
  });
  return best;
}
const shortName = n => (n.replace(/\.(pdf|txt|md|html?)$/i, "").replace(/^.*?\bhen[-_ ]*/i, "")
  .replace(/[-_ ]*resume[-_ ]*/i, " ").replace(/[-_]+/g, " ").trim() || n);
function jobSkills(j) {
  const s = new Set((j.sm && j.sm.stack) || []);
  j.chips.forEach(c => { if (CHIP_TO_SKILL[c]) s.add(CHIP_TO_SKILL[c]); });
  return [...s];
}
function fitFor(j) {
  if (!resumes.length) return null;
  const need = jobSkills(j);
  const all = resumes.map(r => {
    const have = need.filter(k => r.skills.includes(k));
    const role = roleFit(r, j.cat);
    const pct = need.length ? have.length / need.length : 0;
    return { r, have, missing: need.filter(k => !have.includes(k)), pct, role, score: pct * 100 + role };
  }).sort((a, b) => b.score - a.score);
  return { best: all[0], all, need };
}
function fitChip(j) {
  const f = fitFor(j);
  if (!f) return "";
  const b = f.best, label = shortName(b.r.name);
  const tip = f.need.length ? `Covers ${b.have.length} of the ${f.need.length} skills this posting names` +
    (b.missing.length ? ` · not on it: ${b.missing.join(", ")}` : "") : "Best match for this role type";
  return `<span class="chip flag-res" title="${esc(tip)}">📄 ${esc(label)}${f.need.length ? ` · ${b.have.length}/${f.need.length}` : ""}</span>`;
}
function fitBox(j) {
  const f = fitFor(j);
  if (!f) return `<p class="none">Drop your resume PDFs into <b>📄 My resumes</b> (toolbar) to see which one fits this job best.</p>`;
  const rows = f.all.map(x => `<div class="rrow"><span>${esc(shortName(x.r.name))}${x === f.best ? " ⭐" : ""}</span>
      <div class="track"><div class="fill" style="width:${Math.round(x.pct * 100)}%"></div></div>
      <span class="num">${f.need.length ? `${x.have.length}/${f.need.length} skills` : (x.role >= 12 ? "built for this role" : x.role ? "suits this role" : "—")}</span></div>`).join("");
  const miss = f.best.missing.length
    ? `<p class="src">Posting mentions, not on your <b>${esc(shortName(f.best.r.name))}</b> resume: ${f.best.missing.map(esc).join(", ")}.
       Add one only if you've actually used it — interviewers ask about everything listed.</p>` : "";
  return rows + miss;
}

/* ── panel: drag & drop / choose files ───────────────────── */
let pdfjsP = null;
function loadPdfJs() {
  return pdfjsP = pdfjsP || import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs").then(m => {
    m.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
    return m;
  });
}
const readAs = (file, how) => new Promise((ok, bad) => {
  const fr = new FileReader();
  fr.onload = () => ok(fr.result); fr.onerror = () => bad(fr.error);
  how === "buffer" ? fr.readAsArrayBuffer(file) : fr.readAsText(file);
});
async function fileText(file) {
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await readAs(file, "buffer")) }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      pages.push(c.items.map(it => it.str).join(" "));
    }
    return pages.join("\n");
  }
  const raw = await readAs(file, "text");
  if (!/\.html?$/i.test(file.name)) return raw;
  // keep words in separate elements apart ("Tools</h3><p>Git" → "Tools Git")
  const spaced = raw.replace(/<(\/?(p|div|h\d|li|ul|span|td|tr|br|section|header)\b[^>]*)>/gi, " <$1> ");
  return new DOMParser().parseFromString(spaced, "text/html").body.textContent;
}
async function addResumeFiles(files) {
  for (const file of files) {
    try {
      const text = (await fileText(file)).replace(/\s+/g, " ").trim();
      if (text.length < 200) { toast(`${file.name}: couldn't read any text (scanned image?)`, true); continue; }
      const entry = { name: file.name, skills: skillsIn(text), chars: text.length, added: localDay() };
      resumes = resumes.filter(r => r.name !== file.name).concat(entry);
      toast(`📄 ${shortName(file.name)}: ${entry.skills.length} skills found`);
    } catch (e) {
      toast(`${file.name}: couldn't read it (${e.message || e})`, true);
    }
  }
  saveResumes(); renderResPanel(); render();
}
function removeResume(name) { resumes = resumes.filter(r => r.name !== name); saveResumes(); renderResPanel(); render(); }
function renderResPanel() {
  document.getElementById("resBtn").innerHTML = `📄 My resumes${resumes.length ? ` (${resumes.length})` : ""}`;
  document.getElementById("resList").innerHTML = resumes.length ? resumes.map(r => `
    <div class="fu"><div><b>${esc(shortName(r.name))}</b> <span class="sub2">${esc(r.name)}</span>
      <div class="sub2">${r.skills.length} skills: ${r.skills.map(esc).join(", ")}</div></div>
      <div class="btns"><button class="mini" onclick="removeResume(${esc(JSON.stringify(r.name))})">Remove</button></div></div>`).join("")
    : '<div class="lead">No resumes yet.</div>';
}
(() => {
  const drop = document.getElementById("resDrop"), input = document.getElementById("resFile");
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => addResumeFiles([...e.dataTransfer.files]));
  input.addEventListener("change", () => { addResumeFiles([...input.files]); input.value = ""; });
  document.getElementById("resBtn").onclick = () => {
    const p = document.getElementById("resPanel"); p.hidden = !p.hidden; renderResPanel();
  };
  renderResPanel();
})();

refreshSyncUI();
renderChart();
render();
loadSheetRows(false);
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
