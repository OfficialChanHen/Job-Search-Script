#!/usr/bin/env python3
"""
Build the website's data (public/data/*.json) from every data/jobs_*.csv.

Scores each listing against Chan's resume skill profile, flags closed postings
and reposts, picks LeetCode prep per job, and attaches drive math for local
part-time jobs. The Next.js app at the repo root fetches the JSON files.

History is re-filtered with today's rules (job_rules.py), so older CSVs lose
internships / non-US / senior rows too.
"""

import csv
import glob
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from direct_links import DIRECT_SOURCES, clean_url, is_direct
from enrich import COMPANY_FILE, ENRICH_FILE, STACK, company_key, is_too_experienced
from interview_prep import LC, POOLS, TOPIC_LABEL, prep_for, prep_text
from local_parttime import WORTH_IT_HOURLY, commute
from job_rules import (
    CATEGORY_LABEL, SWE_CATEGORIES, infer_job_type, is_target_title,
    is_us_location, role_category, url_key,
)

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
WEB_DATA_DIR = BASE_DIR.parent / "public" / "data"   # the Next.js app (repo root) fetches these
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
                    "GitHub/zapplyjobs", "LinkedIn", "USAJobs", "Google Careers", "YC", "Built In"}

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


def _prep_id(title: str, company: str, topics: list | None = None, seed: str = "", category: str = "") -> int:
    prep = prep_for(title, company, topics=topics, seed=seed, category=category)
    key = json.dumps(prep, sort_keys=True)
    if key not in _PREP_INDEX:
        _PREP_INDEX[key] = len(PREPS)
        PREPS.append({**prep, "text": prep_text(prep)})
    return _PREP_INDEX[key]


def keep_row(row: dict) -> bool:
    """Apply today's rules to a historical CSV row."""
    if row.get("source") in DROPPED_SOURCES:
        return False
    if row.get("type") == "parttime":
        # local part-time has its own rules: really part-time, and worth the drive
        rec = ENRICH.get(row.get("id", "")) or {}
        if rec.get("emp") and "part" not in rec["emp"].lower():
            return False
        c = commute(row.get("location", ""), rec.get("pay") or row.get("tags", ""))
        return not (c.get("eff") is not None and c["eff"] < WORTH_IT_HOURLY * 0.85)
    if row.get("type", "job") != "job":
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
    local_pt = row.get("type") == "parttime"
    years = rec.get("y")
    exp = ("0 yrs" if years == 0 else f"{years} yr" if years is not None else "") or row.get("experience", "")
    junior = bool(JUNIOR_RE.search(title)) or (years is not None and years <= 1) or row.get("experience", "") in (
        "0 yrs", "1+ yrs", "Entry-level", "New grad", "Recent grad", "Entry grade")
    job_type = row.get("job_type") or infer_job_type(
        "", title, row.get("tags", ""),
        default="Full-time" if row.get("source") in FULLTIME_SOURCES else "")
    category = "parttime" if row.get("type") == "parttime" else (row.get("category") or role_category(title) or "swe")

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

    # Priority: in-person > hybrid > remote (no location preference beyond the US)
    if junior:
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

    # the employer's own posting: the link itself if it already is one, else what
    # direct_links.py found for board/aggregator jobs (LinkedIn, Dice, …)
    url = row.get("url", "")
    direct = clean_url(url) if (row.get("source") in DIRECT_SOURCES or is_direct(url)) else rec.get("du", "")
    if direct:
        score += 1
    drive = commute(loc, rec.get("pay") or row.get("tags", "")) if local_pt else {}
    if local_pt:
        # rank the local tab by pay after driving (known pay first), then by distance
        score = round(drive["eff"]) if drive.get("eff") else max(0, 12 - round(drive.get("mi", 25) / 5))

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
        "remote": remote,
        "mode": mode,
        "jobType": job_type,
        "cat": category,
        "catLabel": "Local part-time" if local_pt else CATEGORY_LABEL.get(category, "SWE"),
        "swe": category in SWE_CATEGORIES and not local_pt,
        "exp": exp,
        "gradWindow": bool(GRAD_WINDOW_RE.search(title)),
        "prep": _prep_id(title, row.get("company", ""), rec.get("tp"), row.get("id", ""),
                         "parttime" if local_pt else ""),
        **({"drive": drive} if drive else {}),
        "gone": rec.get("st") == "gone",
        **({"direct": direct} if direct else {}),
        **({"sm": summary} if summary else {}),
        # knockout checks from the full posting (absent = posting not checked yet)
        **({"fl": rec["fl"]} if "fl" in rec else {}),
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



def write_web_data(jobs: list[dict]) -> None:
    """Same data the HTML embeds, as JSON files the web app fetches (and the CDN compresses)."""
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    files = {
        "jobs.json": jobs,
        "preps.json": PREPS,
        "companies.json": USED_COMPANIES,
        "topics.json": {t: {"label": TOPIC_LABEL.get(t, t), "problems": [[n, name, LC + slug + "/"] for n, name, slug in pool]}
                        for t, pool in POOLS.items()},
        "vocab.json": [[label, rx, "" if label == "R" else "i"] for label, rx in STACK],
        "meta.json": {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                      "latest": max((j["date"] for j in jobs), default="")},
    }
    for name, obj in files.items():
        (WEB_DATA_DIR / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    jobs = load_jobs()
    write_web_data(jobs)
    latest = max((j["date"] for j in jobs), default="—")
    print(f"Site data written: {WEB_DATA_DIR}  ({len(jobs)} jobs, latest day {latest})")


if __name__ == "__main__":
    main()
