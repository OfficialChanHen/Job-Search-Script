#!/usr/bin/env python3
"""
╔════════════════════════════════════════════════════════╗
║          JOB HUNTER — Daily Job Scraper                ║
║          Built for: Chan Hen                           ║
║   Target: Junior SWE — Remote + In-Person US           ║
║                                                        ║
║   Sources:                                             ║
║     • RemoteOK          (remote tech jobs)             ║
║     • Remotive          (remote dev jobs)              ║
║     • Arbeitnow         (remote/US jobs)               ║
║     • Himalayas         (startup remote jobs)          ║
║     • WeWorkRemotely    (remote dev RSS feeds)         ║
║     • Jobicy            (remote jobs API)              ║
║     • GitHub/NewGrad    (SimplifyJobs new-grad table)  ║
║     • GitHub/Internship (SimplifyJobs internships)     ║
║     • Adzuna            (aggregator, needs API key)    ║
║     • Eventbrite        (tech networking events)       ║
╚════════════════════════════════════════════════════════╝
"""

import csv
import hashlib
import json
import logging
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ─────────────────────────────────────────────────────────────────────────────
#  PATHS & CONFIG
# ─────────────────────────────────────────────────────────────────────────────

BASE_DIR  = Path(__file__).parent
DATA_DIR  = BASE_DIR / "data"
LOGS_DIR  = BASE_DIR / "logs"
SEEN_FILE = DATA_DIR / "seen_jobs.json"

DATA_DIR.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)

TODAY     = datetime.now(timezone.utc).strftime("%Y-%m-%d")
OUT_CSV   = DATA_DIR / f"jobs_{TODAY}.csv"
LOG_FILE  = LOGS_DIR / f"job_hunter_{TODAY}.log"

# Optional API keys — set as GitHub Actions secrets (see README)
ADZUNA_APP_ID  = os.getenv("ADZUNA_APP_ID", "")
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY", "")
EVENTBRITE_KEY = os.getenv("EVENTBRITE_KEY", "")

# Chan Hen's resume-derived skill set (used for relevance scoring)
MY_SKILLS = {
    "react", "react native", "reactnative", "typescript", "javascript",
    "next.js", "nextjs", "next", "tailwind", "python", "node", "nodejs",
    "frontend", "front-end", "full stack", "fullstack", "full-stack",
    "web developer", "web engineer", "sql", "figma", "git", "expo", "mobile",
    "pwa", "progressive web app", "css", "html", "rest", "graphql",
    "junior", "entry level", "new grad", "associate developer",
}

# Job-title substrings that identify a software-engineering or adjacent role
SWE_TITLE_TERMS = {
    "software engineer", "software developer", "swe", "sde",
    "frontend", "front-end", "front end",
    "backend", "back-end", "back end",
    "full stack", "fullstack", "full-stack",
    "web developer", "web engineer",
    "react developer", "react engineer", "react native",
    "javascript developer", "typescript developer",
    "python developer", "python engineer",
    "node developer", "node engineer",
    "mobile developer", "mobile engineer",
    "ui developer", "ui engineer",
    "devops engineer", "platform engineer", "site reliability",
    "data engineer", "ml engineer", "ai engineer",
    "qa engineer", "sdet", "quality engineer", "test engineer",
    "solutions engineer", "implementation engineer", "integration engineer",
    "application developer", "application engineer",
    "developer advocate", "developer relations",
}

# Title signals that suggest junior / entry-level (override senior block)
JUNIOR_TITLE = {
    "junior", "jr.", "jr ", "entry level", "entry-level",
    "new grad", "associate", "early career",
}

# Title signals that mean senior — filter out unless a junior signal is also present
SENIOR_TITLE = {
    "senior", "sr.", "sr ", "staff", "principal",
    "lead", "manager", "director", "vp ", "head of",
    "architect", "distinguished", "fellow",
}

# Queries sent to sources that accept freetext search
SEARCH_TERMS = [
    "junior software engineer",
    "entry level software engineer",
    "associate software engineer",
    "junior frontend developer",
    "junior react developer",
    "react native developer",
    "next.js developer",
    "junior full stack developer",
    "junior typescript developer",
]

# US state abbreviation pattern — matches ", CA" / ", NY" / ", TX" etc.
_US_STATE_RE = re.compile(
    r',\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|'
    r'MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|'
    r'SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b'
)

HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

CSV_FIELDS = [
    "id", "date_found", "type", "source",
    "title", "company", "location", "url", "posted", "tags",
]

# ─────────────────────────────────────────────────────────────────────────────
#  LOGGING
# ─────────────────────────────────────────────────────────────────────────────

def _setup_logging() -> logging.Logger:
    logger = logging.getLogger("job_hunter")
    logger.setLevel(logging.DEBUG)
    fmt = logging.Formatter(
        "%(asctime)s  [%(levelname)-8s]  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)

    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)

    logger.addHandler(fh)
    logger.addHandler(ch)
    return logger


log = _setup_logging()

# ─────────────────────────────────────────────────────────────────────────────
#  DEDUPLICATION
# ─────────────────────────────────────────────────────────────────────────────

def load_seen() -> set[str]:
    """Load all job IDs seen in previous runs."""
    if SEEN_FILE.exists():
        with open(SEEN_FILE, encoding="utf-8") as f:
            data = json.load(f)
        log.debug(f"Loaded {len(data)} previously seen IDs from {SEEN_FILE.name}")
        return set(data)
    return set()


def save_seen(seen: set[str]) -> None:
    """Persist seen IDs so tomorrow's run skips them."""
    with open(SEEN_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted(seen), f, indent=2)
    log.debug(f"Saved {len(seen)} total seen IDs to {SEEN_FILE.name}")


def make_id(title: str, company: str, url: str = "") -> str:
    """Stable 12-char hash used as a job's unique ID."""
    raw = f"{title.lower().strip()}|{company.lower().strip()}|{url.strip()}"
    return hashlib.md5(raw.encode()).hexdigest()[:12]

# ─────────────────────────────────────────────────────────────────────────────
#  RELEVANCE SCORING
# ─────────────────────────────────────────────────────────────────────────────

def relevance(title: str, extra: str = "") -> int:
    """Count how many of Chan's skills appear in the title + description."""
    text = (title + " " + extra).lower()
    return sum(1 for skill in MY_SKILLS if skill in text)


def is_valid_location(location: str) -> bool:
    """True if the listing is remote, worldwide, or physically in the US."""
    if not location.strip():
        return True
    loc = location.lower()
    ok_tokens = {
        "remote", "worldwide", "usa", "united states",
        "america", "anywhere", "global", "multiple",
    }
    if any(t in loc for t in ok_tokens):
        return True
    return bool(_US_STATE_RE.search(location))


def is_swe_title(title: str) -> bool:
    """True if the job title indicates a software-engineering or adjacent role."""
    t = title.lower()
    return any(term in t for term in SWE_TITLE_TERMS)


def is_too_senior(title: str) -> bool:
    """True if title targets senior+ experience with no junior override."""
    t = title.lower()
    return any(s in t for s in SENIOR_TITLE) and not any(j in t for j in JUNIOR_TITLE)

# ─────────────────────────────────────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def get(url: str, **kwargs) -> requests.Response | None:
    """GET with shared headers + timeout. Returns None on any error."""
    headers = {**HTTP_HEADERS, **kwargs.pop("headers", {})}
    try:
        resp = requests.get(url, headers=headers, timeout=18, **kwargs)
        resp.raise_for_status()
        return resp
    except requests.RequestException as e:
        log.warning(f"    GET failed [{url[:70]}...]: {e}")
        return None


def entry(
    *,
    source: str,
    kind: str = "job",
    title: str,
    company: str = "",
    location: str = "Remote",
    url: str = "",
    posted: str = "",
    tags: str = "",
) -> dict:
    return {
        "source": source,
        "type": kind,
        "title": title,
        "company": company,
        "location": location,
        "url": url,
        "posted": posted,
        "tags": tags,
    }

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: RemoteOK
# ─────────────────────────────────────────────────────────────────────────────

def fetch_remoteok() -> list[dict]:
    """
    RemoteOK public API — completely free, no key needed.
    Returns tech remote jobs from the past 24 hours (roughly).
    Docs: https://remoteok.com/api
    """
    log.info("🔍 RemoteOK ...")
    jobs: list[dict] = []
    resp = get("https://remoteok.com/api", headers={**HTTP_HEADERS, "Accept": "application/json"})
    if resp is None:
        return jobs

    try:
        data = resp.json()
    except ValueError as e:
        log.warning(f"    RemoteOK JSON parse error: {e}")
        return jobs

    for item in data[1:]:           # index 0 is a metadata/legal block
        if not isinstance(item, dict):
            continue
        title   = item.get("position", "")
        company = item.get("company", "")
        tags    = " ".join(item.get("tags", []))
        if not is_swe_title(title) or is_too_senior(title):
            continue
        jobs.append(entry(
            source  = "RemoteOK",
            title   = title,
            company = company,
            location= "Remote",
            url     = item.get("url", f"https://remoteok.com/remote-jobs/{item.get('id','')}"),
            posted  = (item.get("date") or "")[:10],
            tags    = tags,
        ))

    log.info(f"  ✓ RemoteOK → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: Remotive
# ─────────────────────────────────────────────────────────────────────────────

def fetch_remotive() -> list[dict]:
    """
    Remotive public API — free, no key needed.
    Docs: https://remotive.com/api/remote-jobs
    """
    log.info("🔍 Remotive ...")
    jobs: list[dict] = []
    seen_urls: set[str] = set()
    category_terms = ["react", "typescript", "frontend", "python", "mobile"]

    for term in category_terms:
        resp = get(
            f"https://remotive.com/api/remote-jobs",
            params={"category": "software-dev", "search": term, "limit": 20},
        )
        if resp is None:
            continue
        try:
            items = resp.json().get("jobs", [])
        except ValueError:
            continue

        for item in items:
            url = item.get("url", "")
            if url in seen_urls:
                continue
            seen_urls.add(url)

            title   = item.get("title", "")
            company = item.get("company_name", "")
            desc    = BeautifulSoup(item.get("description", ""), "html.parser").get_text()[:400]
            loc_req = item.get("candidate_required_location", "")

            if is_too_senior(title):
                continue
            if not is_swe_title(title) and relevance(title, desc) < 2:
                continue
            if loc_req and not is_valid_location(loc_req):
                continue

            jobs.append(entry(
                source  = "Remotive",
                title   = title,
                company = company,
                location= loc_req or "Remote",
                url     = url,
                posted  = (item.get("publication_date") or "")[:10],
                tags    = ", ".join(item.get("tags", [])),
            ))
        time.sleep(0.4)

    log.info(f"  ✓ Remotive → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: Arbeitnow
# ─────────────────────────────────────────────────────────────────────────────

def fetch_arbeitnow() -> list[dict]:
    """
    Arbeitnow free job board API — no key needed.
    Docs: https://www.arbeitnow.com/api/job-board-api
    """
    log.info("🔍 Arbeitnow ...")
    jobs: list[dict] = []
    seen_urls: set[str] = set()

    for page in [1, 2]:
        resp = get("https://www.arbeitnow.com/api/job-board-api", params={"page": page})
        if resp is None:
            continue
        try:
            items = resp.json().get("data", [])
        except ValueError:
            continue

        for item in items:
            title    = item.get("title", "")
            url      = item.get("url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)

            remote   = item.get("remote", False)
            location = item.get("location", "")

            if not remote and not is_valid_location(location):
                continue
            if not is_swe_title(title) or is_too_senior(title):
                continue

            tags = " ".join(item.get("tags", []))
            created_at = item.get("created_at")
            if isinstance(created_at, int):
                posted = datetime.fromtimestamp(created_at, tz=timezone.utc).strftime("%Y-%m-%d")
            else:
                posted = (created_at or "")[:10]

            jobs.append(entry(
                source  = "Arbeitnow",
                title   = title,
                company = item.get("company_name", ""),
                location= "Remote" if remote else location,
                url     = url,
                posted  = posted,
                tags    = tags,
            ))
        time.sleep(0.5)

    log.info(f"  ✓ Arbeitnow → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: Himalayas
# ─────────────────────────────────────────────────────────────────────────────

def fetch_himalayas() -> list[dict]:
    """
    Himalayas.app public API — free remote startup/tech jobs, no key needed.
    Docs: https://himalayas.app/jobs/api
    """
    log.info("🔍 Himalayas ...")
    jobs: list[dict] = []
    resp = get("https://himalayas.app/jobs/api", params={"quantity": 100})
    if resp is None:
        return jobs

    try:
        items = resp.json().get("jobs", [])
    except ValueError:
        return jobs

    for item in items:
        title   = item.get("title", "")
        tech    = " ".join(item.get("tech", []))

        if not is_swe_title(title) or is_too_senior(title):
            continue

        jobs.append(entry(
            source  = "Himalayas",
            title   = title,
            company = item.get("companyName", ""),
            location= "Remote",
            url     = item.get("applicationLink") or f"https://himalayas.app/jobs/{item.get('slug','')}",
            posted  = (item.get("createdAt") or "")[:10],
            tags    = tech,
        ))

    log.info(f"  ✓ Himalayas → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: We Work Remotely
# ─────────────────────────────────────────────────────────────────────────────

def fetch_weworkremotely() -> list[dict]:
    """
    We Work Remotely RSS feeds — free, no key needed.
    Covers programming, full-stack, and front-end categories.
    https://weworkremotely.com
    """
    log.info("🔍 We Work Remotely ...")
    jobs: list[dict] = []
    seen_urls: set[str] = set()
    feeds = [
        "https://weworkremotely.com/categories/remote-programming-jobs.rss",
        "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
        "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
    ]

    for feed_url in feeds:
        resp = get(feed_url)
        if resp is None:
            continue
        try:
            root = ET.fromstring(resp.content)
        except ET.ParseError as e:
            log.debug(f"    WWR RSS parse error: {e}")
            continue

        for item in root.findall(".//item"):
            title_el = item.find("title")
            link_el  = item.find("link")
            guid_el  = item.find("guid")
            pub_el   = item.find("pubDate")

            if title_el is None:
                continue

            # WWR titles are "Company: Job Title"
            raw   = (title_el.text or "").strip()
            parts = raw.split(": ", 1)
            company, title = (parts[0].strip(), parts[1].strip()) if len(parts) == 2 else ("", raw)

            url = (link_el.text if link_el is not None else "") or \
                  (guid_el.text if guid_el is not None else "")
            url = url.strip()
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)

            if not is_swe_title(title) or is_too_senior(title):
                continue

            pub_raw = pub_el.text if pub_el is not None else ""
            try:
                posted = parsedate_to_datetime(pub_raw).strftime("%Y-%m-%d") if pub_raw else ""
            except Exception:
                posted = pub_raw[:10] if pub_raw else ""

            jobs.append(entry(
                source  = "WeWorkRemotely",
                title   = title,
                company = company,
                location= "Remote",
                url     = url,
                posted  = posted,
            ))
        time.sleep(0.5)

    log.info(f"  ✓ We Work Remotely → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: Jobicy
# ─────────────────────────────────────────────────────────────────────────────

def fetch_jobicy() -> list[dict]:
    """
    Jobicy remote jobs API — free, no key needed.
    Docs: https://jobicy.com/jobs-rss-feed
    """
    log.info("🔍 Jobicy ...")
    jobs: list[dict] = []
    seen_urls: set[str] = set()
    tags = ["javascript", "react", "typescript", "python", "node"]

    for tag in tags:
        resp = get(
            "https://jobicy.com/api/v2/remote-jobs",
            params={"count": 50, "tag": tag},
        )
        if resp is None:
            continue
        try:
            items = resp.json().get("jobs", [])
        except ValueError:
            continue

        for item in items:
            title = item.get("jobTitle", "")
            url   = item.get("url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)

            if not is_swe_title(title) or is_too_senior(title):
                continue

            geo = item.get("jobGeo", "")
            if geo and not is_valid_location(geo):
                continue

            industry = item.get("jobIndustry", "")
            tags_str = industry if isinstance(industry, str) else ", ".join(industry or [])

            jobs.append(entry(
                source  = "Jobicy",
                title   = title,
                company = item.get("companyName", ""),
                location= geo or "Remote",
                url     = url,
                posted  = (item.get("pubDate") or "")[:10],
                tags    = tags_str,
            ))
        time.sleep(0.4)

    log.info(f"  ✓ Jobicy → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: GitHub job repos (SimplifyJobs-style markdown tables)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_github_jobs() -> list[dict]:
    """
    GitHub repos that maintain job/internship listings as HTML tables.
    Sources:
      - SimplifyJobs/New-Grad-Positions  (entry-level full-time SWE)
      - SimplifyJobs/Summer2026-Internships  (SWE internships)
    Table columns: Company | Role | Location | Application | Age
    """
    log.info("🔍 GitHub job repos ...")
    jobs: list[dict] = []
    seen_urls: set[str] = set()

    repos = [
        (
            "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md",
            "GitHub/NewGrad",
        ),
        (
            "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md",
            "GitHub/Internship",
        ),
    ]

    # Strip emoji / zero-width chars — intentionally excludes regular space
    _emoji_re = re.compile(r"[\U0001F000-\U0001FFFF​‌‍️]+")

    for raw_url, label in repos:
        resp = get(raw_url)
        if resp is None:
            continue

        soup = BeautifulSoup(resp.text, "html.parser")
        last_company = ""

        for row in soup.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) < 4:
                continue

            # ── Company ──────────────────────────────────────────────────────
            company_text = cells[0].get_text(strip=True)
            if company_text.strip() == "↳":
                company = last_company
            else:
                a = cells[0].find("a")
                raw = a.get_text(strip=True) if a else company_text
                company = _emoji_re.sub("", raw).strip()
                last_company = company

            # ── Role ─────────────────────────────────────────────────────────
            role = _emoji_re.sub("", cells[1].get_text(strip=True)).strip()

            # ── Location ─────────────────────────────────────────────────────
            location = cells[2].get_text(separator=", ", strip=True)

            # ── Application link ─────────────────────────────────────────────
            link_a = cells[3].find("a", href=True)
            if not link_a:
                continue          # no link → closed position
            url = link_a["href"]
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)

            # ── Age (e.g. "1d", "3d") ────────────────────────────────────────
            age = cells[4].get_text(strip=True) if len(cells) > 4 else ""

            if not is_valid_location(location):
                continue
            if not is_swe_title(role) or is_too_senior(role):
                continue

            jobs.append(entry(
                source   = label,
                title    = role,
                company  = company,
                location = location,
                url      = url,
                posted   = age,
            ))

    log.info(f"  ✓ GitHub job repos → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: Adzuna (requires free API key)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_adzuna() -> list[dict]:
    """
    Adzuna job aggregator — FREE API key needed.
    Sign up at: https://developer.adzuna.com/ (takes 2 mins)
    Then add ADZUNA_APP_ID and ADZUNA_APP_KEY to your GitHub Actions secrets.
    """
    if not ADZUNA_APP_ID or not ADZUNA_APP_KEY:
        log.info("⏭  Adzuna skipped (no API keys — see README to add them)")
        return []

    log.info("🔍 Adzuna ...")
    jobs: list[dict] = []
    queries = ["junior software engineer", "react developer", "frontend engineer typescript"]

    for q in queries:
        resp = get(
            f"https://api.adzuna.com/v1/api/jobs/us/search/1",
            params={
                "app_id": ADZUNA_APP_ID,
                "app_key": ADZUNA_APP_KEY,
                "what": q,
                "where": "remote",
                "sort_by": "date",
                "results_per_page": 20,
                "max_days_old": 1,
            },
        )
        if resp is None:
            continue

        try:
            items = resp.json().get("results", [])
        except ValueError:
            continue

        for item in items:
            title   = item.get("title", "")
            company = item.get("company", {}).get("display_name", "")
            location= item.get("location", {}).get("display_name", "")
            desc    = BeautifulSoup(item.get("description", ""), "html.parser").get_text()[:300]

            if relevance(title, desc) < 1:
                continue
            if not is_valid_location(location):
                continue

            jobs.append(entry(
                source  = "Adzuna",
                title   = title,
                company = company,
                location= location,
                url     = item.get("redirect_url", ""),
                posted  = (item.get("created") or "")[:10],
                tags    = item.get("category", {}).get("label", ""),
            ))
        time.sleep(0.5)

    log.info(f"  ✓ Adzuna → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: Eventbrite — Tech Networking Events
# ─────────────────────────────────────────────────────────────────────────────

def fetch_eventbrite_networking() -> list[dict]:
    """
    Eventbrite API v3 — FREE key needed.
    Sign up at: https://www.eventbrite.com/platform/api
    Set EVENTBRITE_KEY in GitHub Actions secrets.

    Searches for tech meetups, networking events, and startup events
    in Minnesota + Online — great for building connections.
    """
    if not EVENTBRITE_KEY:
        log.info("⏭  Eventbrite skipped (no API key — see README to add it)")
        return []

    log.info("🔍 Eventbrite networking events ...")
    events: list[dict] = []
    searches = [
        {"q": "software engineer networking",    "location": "Minneapolis, MN"},
        {"q": "tech meetup developer",           "location": "Minneapolis, MN"},
        {"q": "startup networking tech",         "location": "Minneapolis, MN"},
        {"q": "react javascript developer",      "online_events_only": "true"},
        {"q": "software engineer career fair",   "online_events_only": "true"},
    ]

    for s in searches:
        params = {
            "token": EVENTBRITE_KEY,
            "q": s["q"],
            "sort_by": "date",
            "start_date.keyword": "today",
        }
        if "location" in s:
            params["location.address"] = s["location"]
            params["location.within"] = "50mi"
        if s.get("online_events_only"):
            params["online_events_only"] = "true"

        resp = get("https://www.eventbriteapi.com/v3/events/search/", params=params)
        if resp is None:
            continue

        try:
            items = resp.json().get("events", [])
        except ValueError:
            continue

        for item in items:
            name     = item.get("name", {}).get("text", "")
            url      = item.get("url", "")
            start    = item.get("start", {}).get("local", "")[:10]
            venue_id = item.get("venue_id")
            online   = item.get("online_event", False)
            location = "Online" if online else "Minneapolis, MN"

            events.append(entry(
                source  = "Eventbrite",
                kind    = "networking",
                title   = name,
                location= location,
                url     = url,
                posted  = start,
                tags    = "networking, tech event, career",
            ))
        time.sleep(0.4)

    log.info(f"  ✓ Eventbrite → {len(events)} networking events")
    return events

# ─────────────────────────────────────────────────────────────────────────────
#  OUTPUT
# ─────────────────────────────────────────────────────────────────────────────

def write_csv(rows: list[dict]) -> None:
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    log.info(f"📄 Wrote {len(rows)} rows → {OUT_CSV.name}")


def print_summary(rows: list[dict]) -> None:
    jobs      = [r for r in rows if r["type"] == "job"]
    net_events= [r for r in rows if r["type"] == "networking"]
    by_source: dict[str, int] = {}
    for r in rows:
        by_source[r["source"]] = by_source.get(r["source"], 0) + 1

    w = 54
    bar = "═" * w
    log.info(f"\n╔{bar}╗")
    log.info(f"║{'JOB HUNT DAILY REPORT':^{w}}║")
    log.info(f"║{TODAY:^{w}}║")
    log.info(f"╠{bar}╣")
    log.info(f"║  {'Jobs found:':<28}{len(jobs):<{w-30}}║")
    log.info(f"║  {'Networking events:':<28}{len(net_events):<{w-30}}║")
    log.info(f"╠{bar}╣")
    log.info(f"║  {'Source':<22} {'Count':<{w-24}}║")
    log.info(f"║  {'─'*22} {'─'*8}{'':>{w-32}}║")
    for src, cnt in sorted(by_source.items(), key=lambda x: -x[1]):
        log.info(f"║  {src:<22} {cnt:<{w-24}}║")
    log.info(f"╠{bar}╣")
    log.info(f"║  CSV: {str(OUT_CSV.name):<{w-7}}║")
    log.info(f"╚{bar}╝\n")

# ─────────────────────────────────────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    log.info(f"{'='*60}")
    log.info(f"  JOB HUNTER  —  {TODAY}  —  Chan Hen")
    log.info(f"{'='*60}")

    seen = load_seen()

    # ── Run all fetchers ───────────────────────────────────────────────────
    all_raw: list[dict] = []
    fetchers = [
        fetch_remoteok,
        fetch_remotive,
        fetch_arbeitnow,
        fetch_himalayas,
        fetch_weworkremotely,
        fetch_jobicy,
        fetch_github_jobs,
        fetch_adzuna,
        fetch_eventbrite_networking,
    ]

    for fn in fetchers:
        try:
            results = fn()
            all_raw.extend(results)
            log.debug(f"  {fn.__name__} added {len(results)} raw entries")
        except Exception as exc:
            log.error(f"  {fn.__name__} raised unexpected error: {exc}", exc_info=True)
        time.sleep(0.8)

    log.info(f"Total raw entries across all sources: {len(all_raw)}")

    # ── Deduplicate against seen + within today's batch ────────────────────
    new_rows:   list[dict] = []
    today_seen: set[str]   = set()

    for item in all_raw:
        jid = make_id(item["title"], item.get("company", ""), item.get("url", ""))
        if jid in seen or jid in today_seen:
            log.debug(f"  DUPE skipped: {item['title'][:60]}")
            continue
        item["id"]         = jid
        item["date_found"] = TODAY
        new_rows.append(item)
        today_seen.add(jid)

    dupes = len(all_raw) - len(new_rows)
    log.info(f"Deduplication: {len(new_rows)} new  |  {dupes} duplicates removed")

    # ── Persist & output ───────────────────────────────────────────────────
    if new_rows:
        write_csv(new_rows)
    else:
        log.info("No new listings today — CSV not written.")

    seen.update(today_seen)
    save_seen(seen)
    print_summary(new_rows)
    log.info("Done ✓")


if __name__ == "__main__":
    main()
