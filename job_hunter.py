#!/usr/bin/env python3
"""
╔════════════════════════════════════════════════════════════╗
║          JOB HUNTER — Daily Job Scraper                    ║
║          Built for: Chan Hen                               ║
║   Target: US-only, full-time-first, SWE + tech-adjacent    ║
║           roles needing little to no experience.           ║
║           No internships.                                  ║
║                                                            ║
║   Job boards / aggregators                                 ║
║     • LinkedIn          (public guest search, entry level) ║
║     • Dice              (tech recruiting board)            ║
║     • Himalayas         (US + entry-level search API)      ║
║     • Hacker News       ("Who is hiring?" monthly thread)  ║
║     • RemoteOK / Remotive / WeWorkRemotely / Jobicy        ║
║       (remote boards — US-restricted listings only)        ║
║   New-grad lists                                           ║
║     • SimplifyJobs      (New-Grad-Positions JSON feed)     ║
║     • speedyapply       (2027 SWE College Jobs, USA)       ║
║     • zapplyjobs        (New-Grad-Jobs-2027, adjacent too) ║
║   Company career boards (direct from the employer)         ║
║     • Greenhouse / Lever / Ashby / SmartRecruiters         ║
║     • Workday           (Twin Cities + enterprise)         ║
║   Optional — need a free key (see README)                  ║
║     • USAJobs           (federal, Pathways Recent Grads)   ║
║     • JSearch           (Google for Jobs: Indeed, Glassdoor║
║                          ZipRecruiter…)                    ║
║     • Adzuna            (aggregator)                       ║
╚════════════════════════════════════════════════════════════╝

Priority: full-time first; then in-person > hybrid > remote.
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
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from job_rules import (
    MAX_YEARS, STRICT_MAX_YEARS, classify_work_mode, experience_label, html_to_text,
    infer_job_type, is_junior_title, is_target_title, is_us_location,
    max_years_required, min_years_required, role_category, url_key,
)

# ─────────────────────────────────────────────────────────────────────────────
#  PATHS & CONFIG
# ─────────────────────────────────────────────────────────────────────────────

BASE_DIR  = Path(__file__).parent
DATA_DIR  = BASE_DIR / "data"
LOGS_DIR  = BASE_DIR / "logs"
SEEN_FILE = DATA_DIR / "seen_jobs.json"
LIVE_FILE = DATA_DIR / "live_jobs.json"   # which postings are still up, per board

DATA_DIR.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)

NOW       = datetime.now(timezone.utc)
TODAY     = NOW.strftime("%Y-%m-%d")
OUT_CSV   = DATA_DIR / f"jobs_{TODAY}.csv"
LOG_FILE  = LOGS_DIR / f"job_hunter_{TODAY}.log"

# Optional API keys — set as GitHub Actions secrets (see README)
ADZUNA_APP_ID  = os.getenv("ADZUNA_APP_ID", "")
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY", "")
USAJOBS_KEY    = os.getenv("USAJOBS_KEY", "")
USAJOBS_EMAIL  = os.getenv("USAJOBS_EMAIL", "")
JSEARCH_KEY    = os.getenv("JSEARCH_KEY", "")     # RapidAPI key

# Keyword searches for boards with free-text search. SWE first, then the
# tech-adjacent roles that are growing for new grads (see README).
SEARCH_TERMS = [
    "software engineer",
    "software developer",
    "frontend developer",
    "full stack developer",
    "data analyst",
    "data engineer",
    "solutions engineer",
    "forward deployed engineer",
    "technical support engineer",
    "implementation consultant",
    "qa engineer",
    "cloud engineer",
    "ai engineer",
]

# Twin Cities searches (any work mode) — local roles get a dashboard boost
TWIN_CITIES_TERMS = ["software", "developer", "data analyst", "IT analyst"]

# ── Company career boards (public JSON APIs — no keys needed) ───────────────
# All slugs verified live 2026-09-23.
# Greenhouse: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
GREENHOUSE_BOARDS = [
    # big tech / well-known
    "stripe", "airbnb", "databricks", "robinhood", "coinbase", "doordashusa",
    "dropbox", "datadog", "cloudflare", "mongodb", "okta", "twilio", "reddit",
    "spacex", "anthropic", "figma", "discord", "duolingo", "instacart",
    "pinterest", "lyft", "block", "roblox", "scaleai", "waymo", "nuro",
    # mid-size
    "samsara", "brex", "gusto", "asana", "affirm", "chime", "sofi",
    "andurilindustries", "axon", "verkada", "flexport", "toast", "hubspotjobs",
    "squarespace", "peloton", "epicgames", "riotgames", "wizinc", "gleanwork",
    "fivetran", "cockroachlabs", "yext", "faire", "mercury",
    # smaller
    "vercel", "attentive", "webflow", "hextechnologies", "airtable",
    # Twin Cities
    "jamf",
    # trading (strong new-grad programs)
    "janestreet", "wehrtyou", "imc", "optiverus",
]
# Lever: https://api.lever.co/v0/postings/{slug}?mode=json
LEVER_BOARDS = ["palantir", "zoox"]
# Ashby: https://api.ashbyhq.com/posting-api/job-board/{slug}
ASHBY_BOARDS = [
    "ramp", "linear", "openai", "cursor", "notion", "replit", "supabase",
    "benchling", "plaid", "snowflake", "sierra", "harvey", "modal",
    "perplexity", "elevenlabs", "claylabs", "decagon", "cognition", "vanta",
    "cohere", "temporal", "render", "nerdwallet", "thumbtack", "airbyte",
    "watershed",
]
# SmartRecruiters: https://api.smartrecruiters.com/v1/companies/{id}/postings
SMARTRECRUITERS_BOARDS = ["ServiceNow", "AbbVie"]
# Workday: (company, host, tenant, site) —
#   POST https://{host}/wday/cxs/{tenant}/{site}/jobs
WORKDAY_BOARDS = [
    # Twin Cities
    ("Target",          "target.wd5.myworkdayjobs.com",        "target",         "targetcareers"),
    ("U.S. Bank",       "usbank.wd1.myworkdayjobs.com",        "usbank",         "US_Bank_Careers"),
    ("Ameriprise",      "ameriprise.wd5.myworkdayjobs.com",    "ameriprise",     "Ameriprise"),
    ("Securian",        "hq.wd12.myworkdayjobs.com",           "hq",             "Securian_External"),
    ("Piper Sandler",   "pipersandler.wd501.myworkdayjobs.com","pipersandler",   "Piper_Sandler_Careers"),
    ("Arctic Wolf",     "arcticwolf.wd1.myworkdayjobs.com",    "arcticwolf",     "External"),
    ("C.H. Robinson",   "chrobinson.wd5.myworkdayjobs.com",    "chrobinson",     "CHRobinson"),
    ("Thomson Reuters", "thomsonreuters.wd5.myworkdayjobs.com","thomsonreuters", "External_Career_Site"),
    ("Land O'Lakes",    "landolakes.wd1.myworkdayjobs.com",    "landolakes",     "LandOLakes"),
    ("General Mills",   "genmills.wd1.myworkdayjobs.com",      "genmills",       "GMI_External_Careers"),
    ("Medtronic",       "medtronic.wd1.myworkdayjobs.com",     "medtronic",      "MedtronicCareers"),
    ("3M",              "3m.wd1.myworkdayjobs.com",            "3m",             "Search"),
    ("Xcel Energy",     "xcelenergy.wd1.myworkdayjobs.com",    "xcelenergy",     "External"),
    ("Ecolab",          "ecolab.wd1.myworkdayjobs.com",        "ecolab",         "Ecolab_External"),
    ("Polaris",         "polaris.wd5.myworkdayjobs.com",       "polaris",        "PolarisJobs"),
    ("Deluxe",          "deluxe.wd5.myworkdayjobs.com",        "deluxe",         "USA_CAN"),
    ("SPS Commerce",    "spscommerce.wd108.myworkdayjobs.com", "spscommerce",    "SPS"),
    ("Blue Cross MN",   "bcbsmn.wd5.myworkdayjobs.com",        "bcbsmn",         "bluecrossmn"),
    ("Wells Fargo",     "wf.wd1.myworkdayjobs.com",            "wf",             "WellsFargoJobs"),
    # national
    ("Capital One",     "capitalone.wd12.myworkdayjobs.com",   "capitalone",     "Capital_One"),
    ("Nvidia",          "nvidia.wd5.myworkdayjobs.com",        "nvidia",         "NVIDIAExternalCareerSite"),
    ("Salesforce",      "salesforce.wd12.myworkdayjobs.com",   "salesforce",     "External_Career_Site"),
    ("PayPal",          "paypal.wd1.myworkdayjobs.com",        "paypal",         "jobs"),
    ("Workday",         "workday.wd5.myworkdayjobs.com",       "workday",        "Workday"),
    ("Visa",            "visa.wd5.myworkdayjobs.com",          "visa",           "Visa"),
    ("Mastercard",      "mastercard.wd1.myworkdayjobs.com",    "mastercard",     "CorporateCareers"),
    ("Chewy",           "chewy.wd5.myworkdayjobs.com",         "chewy",          "External"),
    ("DraftKings",      "draftkings.wd1.myworkdayjobs.com",    "draftkings",     "DraftKings"),
    ("Etsy",            "etsy.wd5.myworkdayjobs.com",          "etsy",           "Etsy_Careers"),
]
WORKDAY_QUERIES = ["software engineer", "developer", "data analyst",
                   "entry level", "associate engineer"]
WORKDAY_DETAIL_CAP = 25     # detail fetches per board (each is one request)

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
    "title", "company", "location", "url", "posted", "tags", "work_mode",
    "job_type", "experience", "category",
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

# Logs are committed to a public repo — never let a key reach them
_SECRET_RE = re.compile(r"((?:app_id|app_key|token|key|api_key)=)[^&\s'\"]+", re.IGNORECASE)


def _redact(text: str) -> str:
    return _SECRET_RE.sub(r"\1***", text)

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
#  LIVE POSTINGS  (every posting currently on a fully-listed board, unfiltered)
#  The dashboard marks older jobs "closed" once they drop off their board.
# ─────────────────────────────────────────────────────────────────────────────

LIVE: dict[str, dict[str, set[str]]] = {}


def mark_live(source: str, company: str, url: str) -> None:
    if url and company:
        LIVE.setdefault(source, {}).setdefault(company.strip().lower(), set()).add(url_key(url))


def save_live() -> None:
    """Merge today's boards into live_jobs.json, per company. A board that
    failed today keeps its older snapshot (and date), so it's never mistaken
    for "every job closed"."""
    data: dict = {}
    if LIVE_FILE.exists():
        try:
            data = json.loads(LIVE_FILE.read_text(encoding="utf-8"))
        except ValueError:
            data = {}
    for source, companies in LIVE.items():
        src = data.setdefault(source, {})
        for company, keys in companies.items():
            src[company] = {"d": TODAY, "h": sorted(keys)}
    LIVE_FILE.write_text(json.dumps(data, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    n = sum(len(c) for c in LIVE.values())
    log.info(f"🟢 Live-posting snapshot: {n} boards → {LIVE_FILE.name}")

# ─────────────────────────────────────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────────────────────────────────────

SESSION = requests.Session()
SESSION.headers.update(HTTP_HEADERS)


def get(url: str, timeout: int = 20, **kwargs) -> requests.Response | None:
    """GET with shared headers + timeout. Returns None on any error."""
    try:
        resp = SESSION.get(url, timeout=timeout, **kwargs)
        resp.raise_for_status()
        return resp
    except requests.RequestException as e:
        log.warning(f"    GET failed [{url[:70]}...]: {_redact(str(e))}")
        return None


def post_json(url: str, body: dict, timeout: int = 20) -> dict | None:
    try:
        resp = SESSION.post(url, json=body, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except (requests.RequestException, ValueError) as e:
        log.warning(f"    POST failed [{url[:70]}...]: {_redact(str(e))}")
        return None


def experience_ok(text: str) -> tuple[bool, str]:
    """(passes the ≤2-years rule, experience label) for a description."""
    years = min_years_required(text)
    return (years is None or years <= MAX_YEARS), experience_label(years)


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
    work_mode: str = "",
    job_type: str = "",
    experience: str = "",
) -> dict:
    return {
        "source": source,
        "type": kind,
        "title": title.strip(),
        "company": company.strip(),
        "location": location.strip(),
        "url": url.strip(),
        "posted": posted,
        "tags": tags,
        "work_mode": work_mode or classify_work_mode(location, _title_mode(title)),
        "job_type": job_type,
        "experience": experience,
        "category": role_category(title),
    }


def _title_mode(title: str) -> str:
    """Work mode stated in a title, e.g. "Software Engineer (Hybrid)"."""
    t = title.lower()
    return "hybrid" if "hybrid" in t else "remote" if "remote" in t else ""


def _age_days(age: str) -> float | None:
    """'12m' / '5h' / '3d' / '2w' / '1mo' → days (None if unparseable)."""
    m = re.match(r"\s*(\d+)\s*(mo|m|h|d|w|y)", age or "")
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2)
    return n * {"m": 1 / 1440, "h": 1 / 24, "d": 1, "w": 7, "mo": 30, "y": 365}[unit]


def _epoch_date(ts) -> str:
    try:
        ts = float(ts)
        if ts > 1e12:
            ts /= 1000
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return ""

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: LinkedIn (public guest search — no login)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_linkedin() -> list[dict]:
    """
    LinkedIn's logged-out job search endpoint (the one its public job pages use).
    Filters: Entry level (f_E=2), Full-time (f_JT=F), past 24h, United States.
    The guest endpoint ignores the work-mode filter, so mode comes from the
    location/title (a bare "United States" location is how LinkedIn shows
    US-remote roles). LinkedIn rate-limits datacenter IPs — on a 429 we stop
    and keep what we have.
    """
    log.info("🔍 LinkedIn ...")
    jobs: list[dict] = []
    seen_urls: set[str] = set()
    base = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
    searches = [(kw, "United States", start) for kw in SEARCH_TERMS for start in (0, 10)]
    searches += [(kw, "Minneapolis, Minnesota, United States", 0) for kw in TWIN_CITIES_TERMS]

    for kw, loc, start in searches:
        params = {"keywords": kw, "location": loc, "f_E": "2", "f_JT": "F",
                  "f_TPR": "r86400", "start": start}
        try:
            resp = SESSION.get(base, params=params, timeout=20)
        except requests.RequestException as e:
            log.warning(f"    LinkedIn request failed: {e}")
            continue
        if resp.status_code == 429:
            log.warning("    LinkedIn rate-limited (429) — stopping LinkedIn for today")
            break
        if resp.status_code != 200:
            continue

        soup = BeautifulSoup(resp.text, "html.parser")
        for card in soup.select("div.base-search-card"):
            t = card.select_one(".base-search-card__title")
            c = card.select_one(".base-search-card__subtitle")
            l = card.select_one(".job-search-card__location")
            a = card.select_one("a.base-card__full-link")
            tm = card.select_one("time")
            if not (t and a):
                continue
            title = t.get_text(strip=True)
            url = str(a.get("href", "")).split("?")[0]
            location = l.get_text(strip=True) if l else ""
            if url in seen_urls or not is_target_title(title):
                continue
            if not is_us_location(location, bare_remote_ok=True):
                continue
            seen_urls.add(url)
            jobs.append(entry(
                source    = "LinkedIn",
                title     = title,
                company   = c.get_text(strip=True) if c else "",
                location  = location,
                url       = url,
                posted    = str(tm.get("datetime", "")) if tm else "",
                work_mode = ("remote" if location.lower() in ("united states", "usa")
                             else classify_work_mode(location, _title_mode(title))),
                job_type   = "Full-time",
                experience = "Entry-level",
            ))
        time.sleep(1.5)

    log.info(f"  ✓ LinkedIn → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: Dice (tech recruiting board)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_dice() -> list[dict]:
    """
    Dice.com search results page (server-rendered cards). Posted today,
    US, full-time. Dice is recruiter-heavy, so titles must look junior.
    """
    log.info("🔍 Dice ...")
    jobs: list[dict] = []
    seen_urls: set[str] = set()
    queries = [
        "junior software engineer", "entry level software developer",
        "associate software engineer", "junior developer", "new grad software",
        "junior data analyst", "entry level data engineer", "junior qa",
        "entry level IT support", "junior web developer",
    ]
    vd = re.compile(r"View Details for (.+?) \([0-9a-f]+\)$")

    for q in queries:
        resp = get("https://www.dice.com/jobs", params={
            "q": q, "countryCode": "US", "filters.postedDate": "ONE",
            "filters.employmentType": "FULLTIME",
        })
        if resp is None:
            continue
        soup = BeautifulSoup(resp.text, "html.parser")
        for card in soup.select('[data-testid="job-card"]'):
            link = card.find("a", href=re.compile(r"^/job-detail/"))
            if not link:
                continue
            m = vd.match(str(link.get("aria-label") or ""))
            title = m.group(1) if m else link.get_text(" ", strip=True)
            url = "https://www.dice.com" + str(link["href"])
            if url in seen_urls:
                continue
            seen_urls.add(url)
            if not is_target_title(title) or not is_junior_title(title):
                continue

            # first company link is the logo; the second carries the name
            company = next((a.get_text(strip=True) for a in
                            card.find_all("a", href=re.compile(r"^/company-profile/"))
                            if a.get_text(strip=True)), "")
            if not company:
                name_p = card.select_one("p.line-clamp-1")
                company = name_p.get_text(strip=True) if name_p else ""
            location = ""
            for p in card.find_all("p"):
                txt = p.get_text(strip=True)
                if "•" in txt:
                    location = txt.split("•")[0].strip()
                    break
            if not is_us_location(location or "Remote"):
                continue
            etype = card.find(id="employmentType-label")
            jobs.append(entry(
                source   = "Dice",
                title    = title,
                company  = company,
                location = location or "Remote",
                url      = url,
                posted   = TODAY,
                job_type = infer_job_type(etype.get_text(strip=True) if etype else "",
                                          title, default="Full-time"),
            ))
        time.sleep(1.0)

    log.info(f"  ✓ Dice → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: Himalayas (US + entry-level search API)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_himalayas() -> list[dict]:
    """
    Himalayas.app search API — free, no key. Filtered server-side to
    US-eligible, entry-level listings. Docs: https://himalayas.app/api
    """
    log.info("🔍 Himalayas ...")
    jobs: list[dict] = []
    seen_urls: set[str] = set()

    for q in ["software", "developer", "engineer", "data", "support", "analyst"]:
        resp = get("https://himalayas.app/jobs/api/search", params={
            "q": q, "country": "US", "seniority": "Entry-level", "sort": "recent"})
        if resp is None:
            continue
        try:
            items = resp.json().get("jobs", [])
        except ValueError:
            continue

        for item in items:
            title = item.get("title", "")
            url   = item.get("applicationLink") or item.get("guid") or ""
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            restr = item.get("locationRestrictions") or []
            if restr and not any(is_us_location(r, bare_remote_ok=False) for r in restr):
                continue
            if not is_target_title(title):
                continue
            jt = infer_job_type(item.get("employmentType", ""), title)
            if jt == "Internship":
                continue
            ok, exp = experience_ok(html_to_text(item.get("description", "")))
            if not ok:
                continue
            jobs.append(entry(
                source     = "Himalayas",
                title      = title,
                company    = item.get("companyName", ""),
                location   = "Remote (US)",
                url        = url,
                posted     = _epoch_date(item.get("pubDate")),
                tags       = ", ".join(item.get("categories", [])[:4]),
                job_type   = jt,
                experience = exp or "Entry-level",
            ))
        time.sleep(0.5)

    log.info(f"  ✓ Himalayas → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: Hacker News "Ask HN: Who is hiring?"
# ─────────────────────────────────────────────────────────────────────────────

_HN_JUNIOR = re.compile(
    r"junior|new grad|new-grad|entry[- ]level|early[- ]career|recent grad|"
    r"0\s*-\s*2 years|1\+ years?", re.IGNORECASE)


def fetch_hn_hiring() -> list[dict]:
    """
    Latest monthly "Who is hiring?" thread via the Algolia HN API (free).
    Only top-level posts that mention junior/new-grad hiring and a US location.
    """
    log.info("🔍 Hacker News Who's Hiring ...")
    jobs: list[dict] = []
    resp = get("https://hn.algolia.com/api/v1/search_by_date",
               params={"tags": "story,author_whoishiring", "query": "who is hiring",
                       "hitsPerPage": 5})
    if resp is None:
        return jobs
    try:
        thread = next(h for h in resp.json().get("hits", [])
                      if h.get("title", "").lower().startswith("ask hn: who is hiring"))
    except (StopIteration, ValueError):
        return jobs

    resp = get(f"https://hn.algolia.com/api/v1/items/{thread['objectID']}", timeout=45)
    if resp is None:
        return jobs
    try:
        children = resp.json().get("children", [])
    except ValueError:
        return jobs

    for c in children:
        raw = c.get("text") or ""
        if not raw or not _HN_JUNIOR.search(raw):
            continue
        header = html_to_text(raw.split("<p>")[0])
        parts = [p.strip() for p in header.split("|") if p.strip()]
        if len(parts) < 2:
            continue
        company = parts[0][:60]
        role = next((p for p in parts[1:] if is_target_title(p)), "")
        if not role:
            continue
        loc = next((p for p in parts[1:] if is_us_location(p, bare_remote_ok=False)), "")
        if not loc:
            continue
        mode_txt = header.lower()
        mode = ("onsite" if "onsite" in mode_txt or "on-site" in mode_txt or "in-person" in mode_txt
                else "hybrid" if "hybrid" in mode_txt
                else "remote" if "remote" in mode_txt else "")
        text = html_to_text(raw)
        ok, exp = experience_ok(text)
        if not ok:
            continue
        jobs.append(entry(
            source     = "HackerNews",
            title      = role[:120],
            company    = company,
            location   = loc[:80],
            url        = f"https://news.ycombinator.com/item?id={c.get('id')}",
            posted     = (c.get("created_at") or "")[:10],
            work_mode  = mode,
            job_type   = infer_job_type("", role, text, default="Full-time"),
            experience = exp,
        ))

    log.info(f"  ✓ Hacker News → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: Remote boards (US-restricted listings only)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_remoteok() -> list[dict]:
    """
    RemoteOK public API — free, no key needed. Most listings are worldwide;
    only ones pinned to the US are kept. Docs: https://remoteok.com/api
    """
    log.info("🔍 RemoteOK ...")
    jobs: list[dict] = []
    resp = get("https://remoteok.com/api", headers={"Accept": "application/json"})
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
        title    = item.get("position", "")
        location = item.get("location", "")
        if not is_target_title(title) or not is_us_location(location, bare_remote_ok=False):
            continue
        ok, exp = experience_ok(html_to_text(item.get("description", "")))
        if not ok:
            continue
        jobs.append(entry(
            source     = "RemoteOK",
            title      = title,
            company    = item.get("company", ""),
            location   = location,
            url        = item.get("url", f"https://remoteok.com/remote-jobs/{item.get('id','')}"),
            posted     = (item.get("date") or "")[:10],
            tags       = " ".join(item.get("tags", [])),
            work_mode  = "remote",
            job_type   = infer_job_type("", title, html_to_text(item.get("description", ""))),
            experience = exp,
        ))

    log.info(f"  ✓ RemoteOK → {len(jobs)} relevant jobs")
    return jobs


def fetch_remotive() -> list[dict]:
    """
    Remotive public API — free, no key needed.
    Docs: https://remotive.com/api/remote-jobs
    """
    log.info("🔍 Remotive ...")
    jobs: list[dict] = []
    seen_urls: set[str] = set()

    for category in ["software-dev", "data", "qa", "customer-support", "devops"]:
        resp = get("https://remotive.com/api/remote-jobs",
                   params={"category": category, "limit": 100})
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
            loc_req = item.get("candidate_required_location", "")
            if not is_target_title(title) or not is_us_location(loc_req, bare_remote_ok=False):
                continue
            jt = infer_job_type(item.get("job_type", ""), title)
            if jt == "Internship":
                continue
            ok, exp = experience_ok(html_to_text(item.get("description", "")))
            if not ok:
                continue
            jobs.append(entry(
                source     = "Remotive",
                title      = title,
                company    = item.get("company_name", ""),
                location   = loc_req,
                url        = url,
                posted     = (item.get("publication_date") or "")[:10],
                tags       = ", ".join(item.get("tags", [])[:5]),
                work_mode  = "remote",
                job_type   = jt,
                experience = exp,
            ))
        time.sleep(0.4)

    log.info(f"  ✓ Remotive → {len(jobs)} relevant jobs")
    return jobs


def fetch_weworkremotely() -> list[dict]:
    """
    We Work Remotely RSS feeds — free, no key needed. Only "USA Only" /
    "North America Only" listings are kept (<region> element).
    """
    log.info("🔍 We Work Remotely ...")
    jobs: list[dict] = []
    seen_urls: set[str] = set()
    feeds = [
        "https://weworkremotely.com/categories/remote-programming-jobs.rss",
        "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
        "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
        "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
        "https://weworkremotely.com/categories/remote-customer-support-jobs.rss",
        "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
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
            if title_el is None:
                continue
            region = (item.findtext("region") or "").strip()
            if not is_us_location(region, bare_remote_ok=False):
                continue

            # WWR titles are "Company: Job Title"
            raw   = (title_el.text or "").strip()
            parts = raw.split(": ", 1)
            company, title = (parts[0].strip(), parts[1].strip()) if len(parts) == 2 else ("", raw)

            url = (item.findtext("link") or item.findtext("guid") or "").strip()
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            if not is_target_title(title):
                continue
            desc = html_to_text(item.findtext("description") or "")
            ok, exp = experience_ok(desc)
            if not ok:
                continue

            pub_raw = item.findtext("pubDate") or ""
            try:
                posted = parsedate_to_datetime(pub_raw).strftime("%Y-%m-%d") if pub_raw else ""
            except Exception:
                posted = pub_raw[:10]

            jobs.append(entry(
                source     = "WeWorkRemotely",
                title      = title,
                company    = company,
                location   = f"Remote ({region})",
                url        = url,
                posted     = posted,
                work_mode  = "remote",
                job_type   = infer_job_type(item.findtext("type") or "", title, desc),
                experience = exp,
            ))
        time.sleep(0.5)

    log.info(f"  ✓ We Work Remotely → {len(jobs)} relevant jobs")
    return jobs


def fetch_jobicy() -> list[dict]:
    """
    Jobicy remote jobs API — free, no key needed. geo=usa server-side.
    Docs: https://jobicy.com/jobs-rss-feed
    """
    log.info("🔍 Jobicy ...")
    jobs: list[dict] = []
    seen_urls: set[str] = set()

    for industry in ["dev", "data-science", "technical-support", "engineering"]:
        resp = get("https://jobicy.com/api/v2/remote-jobs",
                   params={"count": 100, "geo": "usa", "industry": industry})
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
            level = (item.get("jobLevel") or "").lower()
            if any(s in level for s in ("senior", "director", "manager", "lead")):
                continue
            geo = item.get("jobGeo") or ""
            if not is_target_title(title) or not is_us_location(geo, bare_remote_ok=False):
                continue
            jt_raw = item.get("jobType") or ""
            jt = infer_job_type(jt_raw[0] if isinstance(jt_raw, list) and jt_raw else str(jt_raw), title)
            if jt == "Internship":
                continue
            desc = html_to_text(item.get("jobDescription", ""))
            ok, exp = experience_ok(desc)
            if not ok:
                continue
            jobs.append(entry(
                source     = "Jobicy",
                title      = title,
                company    = item.get("companyName", ""),
                location   = f"Remote ({geo})",
                url        = url,
                posted     = (item.get("pubDate") or "")[:10],
                work_mode  = "remote",
                job_type   = jt,
                experience = exp or ("Entry-level" if "entry" in level or "junior" in level else ""),
            ))
        time.sleep(0.4)

    log.info(f"  ✓ Jobicy → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: New-grad GitHub lists
# ─────────────────────────────────────────────────────────────────────────────

SIMPLIFY_JSON = ("https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/"
                 "dev/.github/scripts/listings.json")
MARKDOWN_REPOS = [
    ("https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/NEW_GRAD_USA.md",
     "GitHub/speedyapply"),
    ("https://raw.githubusercontent.com/zapplyjobs/New-Grad-Jobs-2027/main/README.md",
     "GitHub/zapplyjobs"),
]
NEW_GRAD_MAX_AGE_DAYS = 21


def fetch_simplify_newgrad() -> list[dict]:
    """
    SimplifyJobs/New-Grad-Positions structured feed (the README is generated
    from it). Active, visible, US, posted in the last 3 weeks.
    """
    log.info("🔍 SimplifyJobs new-grad feed ...")
    jobs: list[dict] = []
    resp = get(SIMPLIFY_JSON, timeout=60)
    if resp is None:
        return jobs
    try:
        items = resp.json()
    except ValueError:
        return jobs

    cutoff = (NOW - timedelta(days=NEW_GRAD_MAX_AGE_DAYS)).timestamp()
    for item in items:
        if not (item.get("active") and item.get("is_visible")):
            continue
        mark_live("GitHub/Simplify", item.get("company_name", ""), item.get("url", ""))
        if float(item.get("date_posted") or 0) < cutoff:
            continue
        if item.get("category") in ("Hardware", "Quant", "Product"):
            # Quant/Product still get in when the title itself is a target role
            if not role_category(item.get("title", "")) in ("swe", "data_analyst", "ml_ai"):
                continue
        title = item.get("title", "")
        locs  = item.get("locations") or []
        us_locs = [l for l in locs if is_us_location(l, bare_remote_ok=True)]
        if not us_locs or not is_target_title(title):
            continue
        location = "; ".join(us_locs[:3]) + (f" +{len(us_locs) - 3}" if len(us_locs) > 3 else "")
        jobs.append(entry(
            source     = "GitHub/Simplify",
            title      = title,
            company    = item.get("company_name", ""),
            location   = location,
            url        = item.get("url", ""),
            posted     = _epoch_date(item.get("date_posted")),
            tags       = item.get("category", ""),
            job_type   = "Full-time",
            experience = "New grad",
        ))

    log.info(f"  ✓ SimplifyJobs → {len(jobs)} relevant jobs")
    return jobs


_HREF_RE = re.compile(r'href="([^"]+)"|\]\((https?://[^)\s]+)\)')


def _md_cell_text(cell: str) -> str:
    text = re.sub(r"<[^>]+>|\*\*|\[|\]\([^)]*\)", "", cell)
    return re.sub(r"[\U0001F000-\U0001FFFF☀-➿​-‍️]+", "", text).strip()


def fetch_markdown_newgrad() -> list[dict]:
    """
    New-grad repos that publish pipe tables:
      | Company | Role/Position | Location | … | Apply/Posting | Age/Posted |
    Columns are located by header name so either layout works.
    """
    log.info("🔍 GitHub new-grad markdown lists ...")
    jobs: list[dict] = []

    for raw_url, label in MARKDOWN_REPOS:
        resp = get(raw_url, timeout=40)
        if resp is None:
            continue
        cols: dict[str, int] = {}
        last_company = ""
        kept = 0
        for line in resp.text.splitlines():
            if not line.startswith("|"):
                cols = cols if line.strip() == "" else cols
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            lower = [_md_cell_text(c).lower() for c in cells]
            if "company" in lower and ("role" in lower or "position" in lower):
                cols = {name: i for i, name in enumerate(lower)}
                continue
            if not cols or set(line) <= set("|-: "):
                continue

            def cell(*names):
                for n in names:
                    if n in cols and cols[n] < len(cells):
                        return cells[cols[n]]
                return ""

            company = _md_cell_text(cell("company"))
            if company in ("↳", ""):
                company = last_company
            last_company = company
            title    = _md_cell_text(cell("role", "position"))
            location = _md_cell_text(cell("location")).replace("</br>", "; ")
            link_cell = cell("apply", "application", "posting", "link")
            m = _HREF_RE.search(link_cell)
            if not m:
                continue            # no link → closed position
            url = m.group(1) or m.group(2)
            mark_live(label, company, url)
            age = _md_cell_text(cell("age", "posted", "date"))
            days = _age_days(age)
            if days is not None and days > NEW_GRAD_MAX_AGE_DAYS:
                continue

            if not is_target_title(title) or not is_us_location(location, bare_remote_ok=True):
                continue
            jobs.append(entry(
                source     = label,
                title      = title,
                company    = company,
                location   = location or "USA",
                url        = url,
                posted     = age,
                job_type   = infer_job_type("", title, default="Full-time"),
                experience = "New grad",
            ))
            kept += 1
        log.debug(f"    {label}: kept {kept}")

    log.info(f"  ✓ GitHub markdown lists → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: Company career boards — Greenhouse / Lever / Ashby / SmartRecruiters
#  Direct from the companies' own ATS. Mostly in-person roles → top priority.
# ─────────────────────────────────────────────────────────────────────────────

def _keep_company_role(title: str, location: str, desc: str) -> tuple[bool, str]:
    """
    Company boards list every level, so a role must be a target title in the
    US AND either:
      • say junior/new-grad/level-1 in the title (and not require >2 years), or
      • state years in the description with EVERY mention ≤1 year — a plain
        "Software Engineer" asking "2+ years … 5+ years with X" is mid-level.
    A plain title with no stated years is usually mid-level too — skipped.
    """
    if not is_target_title(title) or not is_us_location(location, bare_remote_ok=True):
        return False, ""
    years = min_years_required(desc)
    if years is not None and years > MAX_YEARS:
        return False, ""
    if is_junior_title(title):
        return True, experience_label(years) or "Entry-level"
    strict = max_years_required(desc)
    if strict is not None and strict <= STRICT_MAX_YEARS:
        return True, experience_label(years)
    return False, ""


def fetch_greenhouse_boards() -> list[dict]:
    """
    Greenhouse public board API — free, no key needed.
    content=true adds the description (for the years-of-experience check).
    Docs: https://developers.greenhouse.io/job-board.html
    """
    log.info("🔍 Greenhouse company boards ...")
    jobs: list[dict] = []

    for slug in GREENHOUSE_BOARDS:
        resp = get(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs",
                   params={"content": "true"}, timeout=60)
        if resp is None:
            continue
        try:
            items = resp.json().get("jobs", [])
        except ValueError:
            continue

        kept = 0
        for item in items:
            title    = item.get("title", "")
            location = (item.get("location") or {}).get("name", "")
            mark_live("Greenhouse", item.get("company_name") or slug.title(), item.get("absolute_url", ""))
            if not is_target_title(title):          # cheap check before parsing HTML
                continue
            offices = ", ".join(o.get("name", "") for o in item.get("offices") or [])
            desc = html_to_text(item.get("content", ""))
            ok, exp = _keep_company_role(title, f"{location} {offices}".strip(), desc)
            if not ok:
                continue
            jobs.append(entry(
                source     = "Greenhouse",
                title      = title,
                company    = item.get("company_name") or slug.title(),
                location   = location,
                url        = item.get("absolute_url", ""),
                posted     = (item.get("first_published") or item.get("updated_at") or "")[:10],
                tags       = ", ".join(d.get("name", "") for d in item.get("departments") or []),
                job_type   = infer_job_type("", title, desc, default="Full-time"),
                experience = exp,
            ))
            kept += 1
        log.debug(f"    {slug}: kept {kept}/{len(items)}")
        time.sleep(0.3)

    log.info(f"  ✓ Greenhouse → {len(jobs)} relevant jobs")
    return jobs


def fetch_lever_boards() -> list[dict]:
    """
    Lever public postings API — free, no key needed.
    Docs: https://github.com/lever/postings-api
    """
    log.info("🔍 Lever company boards ...")
    jobs: list[dict] = []

    for slug in LEVER_BOARDS:
        resp = get(f"https://api.lever.co/v0/postings/{slug}", params={"mode": "json"})
        if resp is None:
            continue
        try:
            items = resp.json()
        except ValueError:
            continue
        if not isinstance(items, list):
            continue

        for item in items:
            title = item.get("text", "")
            cats  = item.get("categories") or {}
            mark_live("Lever", slug.title(), item.get("hostedUrl", ""))
            jt = infer_job_type(cats.get("commitment", ""), title, default="Full-time")
            if jt == "Internship":
                continue
            location = cats.get("location", "") or ", ".join(cats.get("allLocations", []))
            desc = " ".join([
                item.get("descriptionPlain", ""), item.get("additionalPlain", ""),
                *(html_to_text(l.get("content", "")) for l in item.get("lists") or []),
            ])
            ok, exp = _keep_company_role(title, location, desc)
            if not ok:
                continue
            jobs.append(entry(
                source     = "Lever",
                title      = title,
                company    = slug.title(),
                location   = location,
                url        = item.get("hostedUrl", ""),
                posted     = _epoch_date(item.get("createdAt")),
                tags       = cats.get("team", ""),
                work_mode  = classify_work_mode(location, item.get("workplaceType") or ""),
                job_type   = jt,
                experience = exp,
            ))
        time.sleep(0.3)

    log.info(f"  ✓ Lever → {len(jobs)} relevant jobs")
    return jobs


def fetch_ashby_boards() -> list[dict]:
    """
    Ashby public job-board API — free, no key needed.
    Docs: https://developers.ashbyhq.com/docs/public-job-posting-api
    """
    log.info("🔍 Ashby company boards ...")
    jobs: list[dict] = []

    for slug in ASHBY_BOARDS:
        resp = get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}", timeout=40)
        if resp is None:
            continue
        try:
            items = resp.json().get("jobs", [])
        except ValueError:
            continue

        for item in items:
            title = item.get("title", "")
            mark_live("Ashby", slug.title(), item.get("jobUrl", ""))
            jt = infer_job_type(item.get("employmentType", ""), title, default="Full-time")
            if jt == "Internship":
                continue
            location = item.get("location", "")
            secondary = ", ".join((s.get("location") or "") for s in item.get("secondaryLocations") or [])
            ok, exp = _keep_company_role(title, f"{location} {secondary}".strip(),
                                         item.get("descriptionPlain", ""))
            if not ok:
                continue
            # workplaceType ("OnSite"/"Hybrid"/"Remote") beats isRemote, which
            # Ashby sets true even for hybrid HQ roles
            wt = item.get("workplaceType") or ""
            mode = classify_work_mode(location, wt) if wt else (
                "remote" if item.get("isRemote") else classify_work_mode(location))
            jobs.append(entry(
                source     = "Ashby",
                title      = title,
                company    = slug.title(),
                location   = location or "Remote",
                url        = item.get("jobUrl", ""),
                posted     = (item.get("publishedAt") or "")[:10],
                tags       = item.get("department", "") or item.get("team", ""),
                work_mode  = mode,
                job_type   = jt,
                experience = exp,
            ))
        time.sleep(0.3)

    log.info(f"  ✓ Ashby → {len(jobs)} relevant jobs")
    return jobs


def fetch_smartrecruiters_boards() -> list[dict]:
    """
    SmartRecruiters public postings API — free, no key needed. Has an explicit
    experienceLevel field ("entry_level", "associate", …).
    """
    log.info("🔍 SmartRecruiters company boards ...")
    jobs: list[dict] = []

    for company in SMARTRECRUITERS_BOARDS:
        for offset in (0, 100):
            resp = get(f"https://api.smartrecruiters.com/v1/companies/{company}/postings",
                       params={"country": "us", "limit": 100, "offset": offset})
            if resp is None:
                break
            try:
                items = resp.json().get("content", [])
            except ValueError:
                break
            for item in items:
                title = item.get("name", "")
                level = (item.get("experienceLevel") or {}).get("id", "")
                if level in ("internship", "mid_senior_level", "director", "executive"):
                    continue
                if not is_target_title(title):
                    continue
                if level not in ("entry_level", "associate") and not is_junior_title(title):
                    continue
                loc = item.get("location") or {}
                location = loc.get("fullLocation") or ", ".join(
                    x for x in (loc.get("city"), loc.get("region")) if x)
                mode = "remote" if loc.get("remote") else "hybrid" if loc.get("hybrid") else "onsite"
                jobs.append(entry(
                    source     = "SmartRecruiters",
                    title      = title,
                    company    = (item.get("company") or {}).get("name", company),
                    location   = location,
                    url        = f"https://jobs.smartrecruiters.com/{company}/{item.get('id', '')}",
                    posted     = (item.get("releasedDate") or "")[:10],
                    work_mode  = mode,
                    job_type   = infer_job_type((item.get("typeOfEmployment") or {}).get("label", ""),
                                                title, default="Full-time"),
                    experience = "Entry-level" if level == "entry_level" else "",
                ))
            if len(items) < 100:
                break
            time.sleep(0.3)

    log.info(f"  ✓ SmartRecruiters → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: Workday career sites (Twin Cities + enterprise employers)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_workday_boards() -> list[dict]:
    """
    Workday's public career-site JSON (what myworkdayjobs.com pages call).
    1) search each board for a few keywords, 2) fetch details only for
    candidate titles — details carry the description, time type and country.
    """
    log.info("🔍 Workday career sites ...")
    jobs: list[dict] = []

    for company, host, tenant, site in WORKDAY_BOARDS:
        api = f"https://{host}/wday/cxs/{tenant}/{site}"
        candidates: dict[str, dict] = {}
        for q in WORKDAY_QUERIES:
            data = post_json(f"{api}/jobs", {"appliedFacets": {}, "limit": 20,
                                             "offset": 0, "searchText": q})
            if data is None:
                break               # board down — don't hammer it
            for p in data.get("jobPostings", []):
                title = p.get("title", "")
                path = p.get("externalPath", "")
                if path and path not in candidates and is_target_title(title):
                    candidates[path] = p
            time.sleep(0.3)

        kept = 0
        for path, p in list(candidates.items())[:WORKDAY_DETAIL_CAP]:
            resp = get(f"{api}{path}")
            if resp is None:
                continue
            try:
                info = resp.json().get("jobPostingInfo", {})
            except ValueError:
                continue
            title   = info.get("title") or p.get("title", "")
            country = ((info.get("country") or {}).get("descriptor") or "")
            if country and "united states" not in country.lower():
                continue
            location = info.get("location") or p.get("locationsText") or ""
            desc = html_to_text(info.get("jobDescription", ""))
            ok, exp = _keep_company_role(title, location or "United States", desc)
            if not ok:
                continue
            jt = infer_job_type(info.get("timeType", ""), title, desc, default="Full-time")
            if jt == "Internship":
                continue
            remote_type = (info.get("remoteType") or p.get("remoteType") or "").lower()
            mode = ("remote" if remote_type.startswith("remote") and "hybrid" not in remote_type
                    else "hybrid" if "hybrid" in remote_type
                    else classify_work_mode(location, "onsite" if remote_type else ""))
            jobs.append(entry(
                source     = "Workday",
                title      = title,
                company    = company,
                location   = location,
                url        = info.get("externalUrl") or f"https://{host}/{site}{path}",
                posted     = info.get("startDate", "") or TODAY,
                work_mode  = mode,
                job_type   = jt,
                experience = exp,
            ))
            kept += 1
            time.sleep(0.25)
        log.debug(f"    {company}: kept {kept}/{len(candidates)} candidates")

    log.info(f"  ✓ Workday → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: USAJobs (requires free API key)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_usajobs() -> list[dict]:
    """
    USAJobs search API — FREE key: https://developer.usajobs.gov/apirequest/
    Set USAJOBS_KEY + USAJOBS_EMAIL secrets. Searches IT (2210), computer
    science (1550), computer engineering (0854) and data science (1560)
    series at entry grades (GS-5 to GS-9), including Pathways Recent Graduates.
    """
    if not USAJOBS_KEY or not USAJOBS_EMAIL:
        log.info("⏭  USAJobs skipped (no API key — see README to add it)")
        return []

    log.info("🔍 USAJobs ...")
    jobs: list[dict] = []
    resp = get("https://data.usajobs.gov/api/search", headers={
        "Host": "data.usajobs.gov",
        "User-Agent": USAJOBS_EMAIL,
        "Authorization-Key": USAJOBS_KEY,
    }, params={
        "JobCategoryCode": "2210;1550;0854;1560",
        "PayGradeLow": "05", "PayGradeHigh": "09",
        "DatePosted": 7, "ResultsPerPage": 250,
    })
    if resp is None:
        return jobs
    try:
        items = resp.json()["SearchResult"]["SearchResultItems"]
    except (ValueError, KeyError):
        return jobs

    for it in items:
        d = it.get("MatchedObjectDescriptor", {})
        title = d.get("PositionTitle", "")
        schedule = ((d.get("PositionSchedule") or [{}])[0]).get("Name", "")
        details = (d.get("UserArea") or {}).get("Details", {})
        paths = ", ".join(h.get("Name", "") for h in d.get("HiringPath") or [])
        location = d.get("PositionLocationDisplay", "")
        if "intern" in paths.lower() or "student" in paths.lower():
            continue
        remote = str(details.get("RemoteIndicator") or d.get("PositionRemoteIndicator") or "").lower() == "true"
        jobs.append(entry(
            source     = "USAJobs",
            title      = title,
            company    = d.get("OrganizationName", ""),
            location   = location,
            url        = d.get("PositionURI", ""),
            posted     = (d.get("PublicationStartDate") or "")[:10],
            tags       = f"GS-{details.get('LowGrade', '?')}–{details.get('HighGrade', '?')}; {paths}",
            work_mode  = "remote" if remote else "",
            job_type   = infer_job_type(schedule, title, default="Full-time"),
            experience = "Recent grad" if "graduate" in paths.lower() else "Entry grade",
        ))

    log.info(f"  ✓ USAJobs → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  SOURCE: JSearch — Google for Jobs (requires free RapidAPI key)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_jsearch() -> list[dict]:
    """
    JSearch on RapidAPI aggregates Google for Jobs → Indeed, Glassdoor,
    ZipRecruiter, LinkedIn, company sites. FREE tier ≈ 200 requests/month,
    so only 5 queries/day. https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
    Set JSEARCH_KEY in GitHub Actions secrets.
    """
    if not JSEARCH_KEY:
        log.info("⏭  JSearch skipped (no API key — see README to add it)")
        return []

    log.info("🔍 JSearch (Indeed / Glassdoor / ZipRecruiter …) ...")
    jobs: list[dict] = []
    queries = ["junior software engineer", "entry level software developer",
               "entry level data analyst", "associate software engineer Minneapolis",
               "entry level solutions engineer"]
    headers = {"X-RapidAPI-Key": JSEARCH_KEY, "X-RapidAPI-Host": "jsearch.p.rapidapi.com"}
    # JSearch moved job search to /search-v2 (cursor-paged); the old /search
    # path 404s for new subscriptions. Try v2 first, fall back to v1.
    endpoints = ["https://jsearch.p.rapidapi.com/search-v2",
                 "https://jsearch.p.rapidapi.com/search"]
    for q in queries:
        params = {
            "query": f"{q} in USA", "country": "us",
            "date_posted": "today", "employment_types": "FULLTIME",
            "job_requirements": "under_3_years_experience,no_experience",
        }
        resp = None
        for ep in list(endpoints):
            try:
                r = SESSION.get(ep, headers=headers, params=params, timeout=30)
            except requests.RequestException as e:
                log.warning(f"    JSearch request failed: {_redact(str(e))}")
                break
            if r.status_code == 404 and len(endpoints) > 1:
                log.debug(f"    JSearch {ep.rsplit('/', 1)[-1]} → 404, trying next endpoint")
                endpoints.remove(ep)     # remember for the remaining queries
                continue
            if r.status_code != 200:
                log.warning(f"    JSearch HTTP {r.status_code}: {r.text[:120]}")
                break
            resp = r
            break
        if resp is None:
            continue
        try:
            data = resp.json().get("data", [])
        except ValueError:
            continue
        # v1: {"data": [jobs]}  ·  v2: {"data": {"jobs": [...], "cursor": ...}}
        items = data if isinstance(data, list) else (data.get("jobs") or data.get("data") or [])
        for it in items:
            title = it.get("job_title", "")
            if not is_target_title(title):
                continue
            if (it.get("job_country") or "US") != "US":
                continue
            location = ", ".join(x for x in (it.get("job_city"), it.get("job_state")) if x) or "USA"
            ok, exp = experience_ok(it.get("job_description", "") or "")
            if not ok:
                continue
            jobs.append(entry(
                source     = f"JSearch/{it.get('job_publisher', '')}".rstrip("/"),
                title      = title,
                company    = it.get("employer_name", ""),
                location   = location,
                url        = it.get("job_apply_link", ""),
                posted     = (it.get("job_posted_at_datetime_utc") or "")[:10],
                work_mode  = "remote" if it.get("job_is_remote") else "",
                job_type   = infer_job_type(it.get("job_employment_type", ""), title),
                experience = exp,
            ))
        time.sleep(1.0)

    log.info(f"  ✓ JSearch → {len(jobs)} relevant jobs")
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
    queries = ["junior software engineer", "entry level software developer",
               "associate software engineer", "entry level data analyst",
               "junior frontend developer", "entry level IT support"]

    for q in queries:
        resp = get(
            "https://api.adzuna.com/v1/api/jobs/us/search/1",
            params={
                "app_id": ADZUNA_APP_ID,
                "app_key": ADZUNA_APP_KEY,
                "what": q,
                "sort_by": "date",
                "results_per_page": 50,
                "max_days_old": 2,
                "full_time": 1,
            },
        )
        if resp is None:
            continue
        try:
            items = resp.json().get("results", [])
        except ValueError:
            continue

        for item in items:
            title    = BeautifulSoup(item.get("title", ""), "html.parser").get_text()
            location = item.get("location", {}).get("display_name", "")
            desc     = BeautifulSoup(item.get("description", ""), "html.parser").get_text()
            if not is_target_title(title) or not is_us_location(location or "USA"):
                continue
            ok, exp = experience_ok(desc)
            if not ok:
                continue
            ctype = item.get("contract_type", "")
            jobs.append(entry(
                source     = "Adzuna",
                title      = title,
                company    = item.get("company", {}).get("display_name", ""),
                location   = location,
                url        = item.get("redirect_url", ""),
                posted     = (item.get("created") or "")[:10],
                tags       = item.get("category", {}).get("label", ""),
                job_type   = infer_job_type(ctype if ctype == "contract" else item.get("contract_time", ""),
                                            title, desc),
                experience = exp,
            ))
        time.sleep(0.5)

    log.info(f"  ✓ Adzuna → {len(jobs)} relevant jobs")
    return jobs

# ─────────────────────────────────────────────────────────────────────────────
#  OUTPUT
# ─────────────────────────────────────────────────────────────────────────────

def write_csv(rows: list[dict]) -> None:
    # If today's CSV already exists (re-run same day), merge instead of clobber
    if OUT_CSV.exists():
        with open(OUT_CSV, newline="", encoding="utf-8") as f:
            existing = list(csv.DictReader(f))
        have = {r.get("id") for r in existing}
        rows = existing + [r for r in rows if r.get("id") not in have]

    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    log.info(f"📄 Wrote {len(rows)} rows → {OUT_CSV.name}")


def print_summary(rows: list[dict]) -> None:
    by_source: dict[str, int] = {}
    by_type: dict[str, int] = {}
    for r in rows:
        by_source[r["source"]] = by_source.get(r["source"], 0) + 1
        jt = r.get("job_type") or "Unspecified"
        by_type[jt] = by_type.get(jt, 0) + 1

    w = 54
    bar = "═" * w
    log.info(f"\n╔{bar}╗")
    log.info(f"║{'JOB HUNT DAILY REPORT':^{w}}║")
    log.info(f"║{TODAY:^{w}}║")
    log.info(f"╠{bar}╣")
    log.info(f"║  {'Jobs found:':<28}{len(rows):<{w-30}}║")
    for jt, cnt in sorted(by_type.items(), key=lambda x: -x[1]):
        log.info(f"║    {jt + ':':<26}{cnt:<{w-30}}║")
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

FETCHERS = [
    fetch_linkedin,
    fetch_dice,
    fetch_himalayas,
    fetch_hn_hiring,
    fetch_simplify_newgrad,
    fetch_markdown_newgrad,
    fetch_greenhouse_boards,
    fetch_lever_boards,
    fetch_ashby_boards,
    fetch_smartrecruiters_boards,
    fetch_workday_boards,
    fetch_usajobs,
    fetch_jsearch,
    fetch_adzuna,
    fetch_remoteok,
    fetch_remotive,
    fetch_weworkremotely,
    fetch_jobicy,
]


def main() -> None:
    log.info(f"{'='*60}")
    log.info(f"  JOB HUNTER  —  {TODAY}  —  Chan Hen")
    log.info(f"{'='*60}")

    seen = load_seen()

    # ── Run all fetchers (optionally a subset: `python job_hunter.py dice ...`) ──
    only = {a.lower() for a in sys.argv[1:]}
    fetchers = [f for f in FETCHERS if not only or any(o in f.__name__ for o in only)]

    all_raw: list[dict] = []
    for fn in fetchers:
        try:
            results = fn()
            all_raw.extend(results)
            log.debug(f"  {fn.__name__} added {len(results)} raw entries")
        except Exception as exc:
            log.error(f"  {fn.__name__} raised unexpected error: {exc}", exc_info=True)
        time.sleep(0.8)

    log.info(f"Total raw entries across all sources: {len(all_raw)}")

    # ── Final guard: every source must satisfy the same rules ──────────────
    all_raw = [r for r in all_raw
               if r.get("job_type") != "Internship" and is_target_title(r["title"])]

    # ── Deduplicate against seen + within today's batch ────────────────────
    new_rows:   list[dict] = []
    today_seen: set[str]   = set()
    title_co:   set[str]   = set()   # same role posted on several boards

    for item in all_raw:
        jid = make_id(item["title"], item.get("company", ""), item.get("url", ""))
        tc  = f"{item['title'].lower()}|{item.get('company', '').lower()}"
        if jid in seen or jid in today_seen or tc in title_co:
            log.debug(f"  DUPE skipped: {item['title'][:60]}")
            continue
        item["id"]         = jid
        item["date_found"] = TODAY
        new_rows.append(item)
        today_seen.add(jid)
        title_co.add(tc)

    dupes = len(all_raw) - len(new_rows)
    log.info(f"Deduplication: {len(new_rows)} new  |  {dupes} duplicates removed")

    # ── Persist & output ───────────────────────────────────────────────────
    # Full-time first, then in-person > hybrid > remote (per-group order kept)
    _TYPE_RANK = {"Full-time": 0, "": 1, "Contract": 2, "Part-time": 3, "Temporary": 3}
    _MODE_RANK = {"onsite": 0, "hybrid": 1, "remote": 2}
    new_rows.sort(key=lambda r: (_TYPE_RANK.get(r.get("job_type", ""), 4),
                                 _MODE_RANK.get(r.get("work_mode", ""), 3)))

    if new_rows:
        write_csv(new_rows)
    else:
        log.info("No new listings today — CSV not written.")

    seen.update(today_seen)
    save_seen(seen)
    save_live()
    print_summary(new_rows)
    log.info("Done ✓")


if __name__ == "__main__":
    main()
