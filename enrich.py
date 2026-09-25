#!/usr/bin/env python3
"""
enrich.py — read each job's full posting and derive:

  • required years of experience  → the 0–1 year entry-level filter
  • a job summary                 → what you'd do / what they want / pay / stack
  • a company summary             → the posting's "About us", else Wikipedia
  • interview topics              → LeetCode picks that fit the posting

Results are cached so each posting is fetched once:
  data/enrich.json     per job id
  data/companies.json  per company

job_hunter.py calls enrich_rows() for each day's new jobs (descriptions the
scrapers already have are reused, nothing is re-fetched). Run it directly to
work through older jobs:

    python enrich.py                 # backlog, ~10 min budget
    python enrich.py --budget 300    # seconds
"""

import argparse
import csv
import glob
import html as htmllib
import json
import re
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlparse

import requests
from bs4 import BeautifulSoup

from interview_prep import detect_topics
from job_rules import is_target_title, max_years_required, min_years_required

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
ENRICH_FILE = DATA_DIR / "enrich.json"
COMPANY_FILE = DATA_DIR / "companies.json"
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
WIKI_UA = "JobHuntDashboard/1.0 (https://github.com/OfficialChanHen/Job-Search-Script)"
WORKERS = 8
PER_HOST = {"www.linkedin.com": 1}          # everything else: 3 at a time
HOST_GAP = {"www.linkedin.com": 1.2}        # seconds between requests to a host
SKIP_SOURCES = {"GitHub/Internship", "Arbeitnow", "Eventbrite"}

# LinkedIn "Seniority level" values that are never 0–1 years
SENIOR_LEVELS = {"mid-senior level", "director", "executive"}

_local = threading.local()
_host_locks: dict[str, threading.Semaphore] = defaultdict(lambda: threading.Semaphore(3))
_host_last: dict[str, float] = defaultdict(float)
_host_gap_lock = threading.Lock()
_blocked_hosts: set[str] = set()
_ashby_boards: dict[str, list] = {}
_ashby_lock = threading.Lock()


def _session() -> requests.Session:
    if not hasattr(_local, "s"):
        _local.s = requests.Session()
        _local.s.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    return _local.s


def _get(url: str, **kw) -> requests.Response | None:
    host = urlparse(url).netloc
    if host in _blocked_hosts:
        return None
    sem = _host_locks[host] if host not in PER_HOST else _host_locks.setdefault(
        host + "#", threading.Semaphore(PER_HOST[host]))
    with sem:
        gap = HOST_GAP.get(host, 0)
        if gap:
            with _host_gap_lock:
                wait = _host_last[host] + gap - time.time()
                _host_last[host] = max(time.time(), _host_last[host] + gap)
            if wait > 0:
                time.sleep(wait)
        try:
            r = _session().get(url, timeout=kw.pop("timeout", 25), **kw)
        except requests.RequestException:
            return None
    if r.status_code == 429:
        _blocked_hosts.add(host)            # rate-limited: leave the rest for next run
        return None
    return r

# ─────────────────────────────────────────────────────────────────────────────
#  FETCHERS  → {"desc": html_or_text, "level": str, "org": str, "st": status}
#  st: ok · gone (posting removed) · retry (blocked/transient) · none (no text)
# ─────────────────────────────────────────────────────────────────────────────


def _jsonld_posting(page: str) -> dict | None:
    soup = BeautifulSoup(page, "html.parser")
    for tag in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(tag.string or tag.get_text() or "")
        except ValueError:
            continue
        stack = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        for it in stack:
            if isinstance(it, dict) and "JobPosting" in str(it.get("@type")):
                return it
    return None


def fetch_linkedin(url: str) -> dict:
    m = re.search(r"(\d{8,})", url)
    if not m:
        return {"st": "none"}
    r = _get(f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{m.group(1)}")
    if r is None:
        return {"st": "retry"}
    if r.status_code in (404, 410):
        return {"st": "gone"}
    soup = BeautifulSoup(r.text, "html.parser")
    body = soup.select_one(".show-more-less-html__markup") or soup.select_one(".description__text")
    level = ""
    for item in soup.select(".description__job-criteria-item"):
        h = item.select_one("h3")
        if h and "seniority" in h.get_text(strip=True).lower():
            level = item.select_one("span").get_text(strip=True) if item.select_one("span") else ""
    if soup.select_one(".closed-job") or "No longer accepting applications" in r.text:
        return {"st": "gone", "level": level}
    return {"st": "ok" if body else "none", "desc": str(body) if body else "", "level": level}


def fetch_greenhouse(url: str) -> dict | None:
    m = re.search(r"greenhouse\.io/(?:embed/job_app\?for=)?([\w-]+)/jobs/(\d+)", url) or \
        re.search(r"greenhouse\.io/embed/job_app\?for=([\w-]+)&token=(\d+)", url)
    if not m:
        return None
    r = _get(f"https://boards-api.greenhouse.io/v1/boards/{m.group(1)}/jobs/{m.group(2)}")
    if r is None:
        return {"st": "retry"}
    if r.status_code == 404:
        return {"st": "gone"}
    try:
        return {"st": "ok", "desc": htmllib.unescape(r.json().get("content", ""))}
    except ValueError:
        return {"st": "retry"}


def fetch_lever(url: str) -> dict | None:
    m = re.search(r"jobs\.lever\.co/([\w.-]+)/([0-9a-f-]{36})", url)
    if not m:
        return None
    r = _get(f"https://api.lever.co/v0/postings/{m.group(1)}/{m.group(2)}")
    if r is None:
        return {"st": "retry"}
    if r.status_code == 404:
        return {"st": "gone"}
    try:
        j = r.json()
    except ValueError:
        return {"st": "retry"}
    parts = [j.get("description", "")]
    for lst in j.get("lists") or []:
        parts.append(f"<h3>{lst.get('text', '')}</h3><ul>{lst.get('content', '')}</ul>")
    parts.append(j.get("additional", ""))
    return {"st": "ok", "desc": "".join(parts)}


def fetch_ashby(url: str) -> dict | None:
    m = re.search(r"jobs\.ashbyhq\.com/([^/?#]+)/([0-9a-f-]{36})", url)
    if not m:
        return None
    slug, jid = m.group(1), m.group(2)
    with _ashby_lock:
        board = _ashby_boards.get(slug)
    if board is None:
        r = _get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}", timeout=40)
        try:
            board = r.json().get("jobs", []) if r is not None and r.ok else []
        except ValueError:
            board = []
        with _ashby_lock:
            _ashby_boards[slug] = board
    for j in board:
        if j.get("id") == jid or jid in (j.get("jobUrl") or ""):
            return {"st": "ok", "desc": j.get("descriptionHtml") or j.get("descriptionPlain", "")}
    return {"st": "gone"} if board else {"st": "retry"}


def fetch_smartrecruiters(url: str) -> dict | None:
    m = re.search(r"jobs\.smartrecruiters\.com/([^/?#]+)/(\d+)", url)
    if not m:
        return None
    r = _get(f"https://api.smartrecruiters.com/v1/companies/{m.group(1)}/postings/{m.group(2)}")
    if r is None:
        return {"st": "retry"}
    if r.status_code == 404:
        return {"st": "gone"}
    try:
        sec = (r.json().get("jobAd") or {}).get("sections") or {}
    except ValueError:
        return {"st": "retry"}
    titles = {"jobDescription": "The role", "qualifications": "Qualifications",
              "additionalInformation": "Additional information"}
    desc = "".join(f"<h3>{t}</h3>{(sec.get(k) or {}).get('text', '')}" for k, t in titles.items())
    return {"st": "ok", "desc": desc, "org": html_text((sec.get("companyDescription") or {}).get("text", ""))}


def fetch_oracle(url: str) -> dict | None:
    m = re.search(r"https://([^/]+)/hcmUI/CandidateExperience/[^/]+/sites/([^/]+)/job/(\d+)", url)
    if not m:
        return None
    host, site, jid = m.groups()
    r = _get(f"https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails"
             f"?expand=all&onlyData=true&finder=ById;Id=%22{jid}%22,siteNumber={site}")
    if r is None:
        return {"st": "retry"}
    try:
        items = r.json().get("items") or []
    except ValueError:
        return {"st": "retry"}
    if not items:
        return {"st": "gone"}
    it = items[0]
    parts = [("", it.get("ExternalDescriptionStr")), ("Responsibilities", it.get("ExternalResponsibilitiesStr")),
             ("Qualifications", it.get("ExternalQualificationsStr"))]
    return {"st": "ok", "desc": "".join(f"<h3>{h}</h3>{v}" if h else v for h, v in parts if v),
            "org": html_text(it.get("CorporateDescriptionStr") or "")}


_WD_RE = re.compile(r"https://(([^./]+)\.wd\d+\.myworkdayjobs\.com)/(?:[a-z]{2}-[A-Z]{2}/)?([^/?#]+)/job/([^?#]+)")


def fetch_workday(url: str) -> dict | None:
    """Workday's career-site JSON (same API the page uses). Open postings → 200
    with the description; closed ones → 403/404/422 with an errorCode."""
    m = _WD_RE.match(url)
    if not m:
        return None
    host, tenant, site, path = m.groups()
    r = _get(f"https://{host}/wday/cxs/{tenant}/{site}/job/{path}", headers={"Accept": "application/json"})
    if r is None:
        return {"st": "retry"}
    if r.status_code in (403, 404, 410, 422) and "errorCode" in r.text:
        return {"st": "gone"}
    try:
        info = r.json().get("jobPostingInfo") or {}
    except ValueError:
        return {"st": "retry"}
    if not info.get("jobDescription"):
        return {"st": "none"}
    return {"st": "ok", "desc": info["jobDescription"]}


def fetch_workable(url: str) -> dict | None:
    m = re.search(r"apply\.workable\.com/([^/?#]+)/j/([A-Z0-9]+)", url)
    if not m:
        return None
    r = _get(f"https://apply.workable.com/api/v2/accounts/{m.group(1)}/jobs/{m.group(2)}")
    if r is None:
        return {"st": "retry"}
    if r.status_code in (404, 410):
        return {"st": "gone"}
    try:
        j = r.json()
    except ValueError:
        return {"st": "retry"}
    desc = "".join(f"<h3>{h}</h3>{j.get(k) or ''}" if h else (j.get(k) or "")
                   for k, h in (("description", ""), ("requirements", "Requirements"), ("benefits", "Benefits")))
    return {"st": "ok" if desc.strip() else "none", "desc": desc}


def fetch_adzuna(url: str) -> dict | None:
    m = re.search(r"adzuna\.com/(?:land/ad|details)/(\d+)", url)
    if not m:
        return None
    r = _get(f"https://www.adzuna.com/details/{m.group(1)}")
    if r is None:
        return {"st": "retry"}
    if r.status_code in (404, 410):
        return {"st": "gone"}
    soup = BeautifulSoup(r.text, "html.parser")
    body = soup.select_one("section.adp-body") or soup.select_one(".adp-body")
    return {"st": "ok" if body else "none", "desc": str(body) if body else ""}


def fetch_generic(url: str) -> dict:
    """Any other page: schema.org JobPosting JSON-LD (Workday, Dice, Eightfold,
    JazzHR, many career sites) — else nothing."""
    r = _get(url, allow_redirects=True)
    if r is None:
        return {"st": "retry"}
    if r.status_code in (404, 410):
        return {"st": "gone"}
    if r.status_code >= 400:
        return {"st": "retry" if r.status_code in (403, 405, 429, 503) else "none"}
    # zapply / redirect pages that land on a known ATS → use its API
    if urlparse(r.url).netloc != urlparse(url).netloc:
        for fn in (fetch_workday, fetch_greenhouse, fetch_lever, fetch_ashby, fetch_smartrecruiters,
                   fetch_oracle, fetch_workable):
            got = fn(r.url)
            if got:
                return got
    jp = _jsonld_posting(r.text)
    if not jp:
        return {"st": "none"}
    org = jp.get("hiringOrganization") or {}
    months = ((jp.get("experienceRequirements") or {}) if isinstance(jp.get("experienceRequirements"), dict) else {}).get("monthsOfExperience")
    out = {"st": "ok", "desc": htmllib.unescape(str(jp.get("description", ""))),
           "org": html_text(org.get("description", "")) if isinstance(org, dict) else ""}
    if months not in (None, ""):
        try:
            out["months"] = int(float(months))
        except (TypeError, ValueError):
            pass
    return out


def fetch_posting(url: str) -> dict:
    host = urlparse(url).netloc.lower()
    if "linkedin.com" in host:
        return fetch_linkedin(url)
    if "icims.com" in host:
        return {"st": "none"}               # blocks automated requests
    for fn in (fetch_workday, fetch_greenhouse, fetch_lever, fetch_ashby, fetch_smartrecruiters,
               fetch_oracle, fetch_workable, fetch_adzuna):
        got = fn(url)
        if got:
            return got
    if not url.startswith("http") or "news.ycombinator.com" in host:
        return {"st": "none"}
    return fetch_generic(url)

# ─────────────────────────────────────────────────────────────────────────────
#  PARSING  → sections → summary fields
# ─────────────────────────────────────────────────────────────────────────────

def html_text(raw: str) -> str:
    if not raw:
        return ""
    raw = htmllib.unescape(raw) if "&lt;" in raw else raw
    return re.sub(r"\s+", " ", BeautifulSoup(raw, "html.parser").get_text(" ")).strip()


def to_lines(desc: str) -> list[str]:
    """Description → lines; '## ' marks a heading, '- ' a bullet."""
    if not desc:
        return []
    if "&lt;" in desc and "<" not in desc.replace("&lt;", ""):
        desc = htmllib.unescape(desc)
    if "<" in desc and ">" in desc:
        soup = BeautifulSoup(desc, "html.parser")
        for t in soup(["script", "style"]):
            t.decompose()
        for br in soup.find_all("br"):
            br.replace_with("\n")
        for h in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
            h.insert_before("\n## ")
            h.insert_after("\n")
        for p in soup.find_all(["p", "div"]):
            strong = p.find(["strong", "b"])
            txt = p.get_text(" ", strip=True)
            if strong and txt and len(txt) < 90 and strong.get_text(" ", strip=True) == txt:
                p.insert_before("\n## ")
            p.insert_after("\n")
        # LinkedIn / many ATSs: "<strong>Responsibilities</strong><br><ul>…" — a short bold
        # run that ends a line (followed by a break or a list, or ending in ':') is a heading
        for b in soup.find_all(["strong", "b"]):
            txt = b.get_text(" ", strip=True)
            if not txt or len(txt) > 70 or len(txt.split()) > 9:
                continue
            nxt = b.next_sibling
            while nxt is not None and isinstance(nxt, str) and not nxt.strip():
                nxt = nxt.next_sibling
            ends_line = (nxt is None or getattr(nxt, "name", None) in ("br", "ul", "ol", "p", "div")
                         or (isinstance(nxt, str) and nxt.lstrip().startswith(("\n", ":"))))
            if txt.endswith(":") or ends_line:
                b.insert_before("\n## ")
                b.insert_after("\n")
        for li in soup.find_all("li"):
            li.insert_before("\n- ")
            li.insert_after("\n")
        text = soup.get_text(" ")
    else:
        text = desc
    lines = []
    for raw in text.split("\n"):
        line = re.sub(r"\s+", " ", raw).strip()
        if not line or line in ("##", "-"):
            continue
        if re.match(r"^[•·*▪◦●]\s*", line):
            line = "- " + re.sub(r"^[•·*▪◦●]\s*", "", line)
        if not line.startswith(("## ", "- ")) and len(line) < 70 and line.endswith(":"):
            line = "## " + line
        lines.append(line)
    return lines


H_ABOUT = re.compile(r"about (us|the company|our company|the team|[a-z0-9&.' -]{2,40}$)|who we are|our (mission|company|story)|company (overview|description)|why (join|work)", re.I)
H_ROLE = re.compile(r"about (the|this) (role|job|position|opportunity)|the role|role (overview|summary)|job (summary|description|overview)|position (summary|overview)|overview|the opportunity|what is the role|summary", re.I)
H_DUTY = re.compile(r"responsibilit|what you('| wi)ll do|you will|you'll|day[- ]to[- ]day|duties|in this role|what you('ll| will) be doing|key (accountabilities|activities)|your impact|what you('ll)? work on", re.I)
H_REQ = re.compile(r"requirement|qualifications|what you('ll)? (bring|need|have)|you have|who you are|skills|must[- ]have|what we('re| are) looking for|about you|experience", re.I)
H_PREF = re.compile(r"prefer|nice[- ]to[- ]have|bonus|plus|desired|ideal", re.I)
H_BENEFIT = re.compile(r"benefit|perks|compensation|salary|pay|what we offer|equal opportunity|eeo", re.I)

COMPANY_INTRO = re.compile(r"\b(is (a|an|the)|was founded|founded in|we are|we're|our mission|headquartered|is a leading|leading provider|has been|for over \d+ years)\b", re.I)

PAY_RE = re.compile(
    r"\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?[kK]?(?:\s?(?:-|–|—|to)\s?\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?[kK]?)?"
    r"(?:\s?(?:per|/|an|a)\s?(?:hour|hr|year|yr|annum|annually))?")
STACK = [
    ("Python", r"\bpython\b"), ("Java", r"\bjava\b(?!script)"), ("JavaScript", r"javascript"),
    ("TypeScript", r"typescript"), ("React", r"\breact(?!\s*native)\b"), ("React Native", r"react native"),
    ("Next.js", r"next\.?js"), ("Node.js", r"\bnode(\.?js)?\b"), ("Angular", r"\bangular"), ("Vue", r"\bvue"),
    ("SQL", r"\bsql\b"), ("PostgreSQL", r"postgres"), ("MongoDB", r"mongo"), ("AWS", r"\baws\b|amazon web services"),
    ("Azure", r"\bazure\b"), ("GCP", r"\bgcp\b|google cloud"), ("Docker", r"docker"), ("Kubernetes", r"kubernetes|\bk8s\b"),
    ("Go", r"\bgolang\b|\bin go\b|(?:python|java|rust|c\+\+|typescript|kotlin),? (?:and |or )?go\b|\bgo (?:and|or) (?:python|java|rust)"),
    ("C++", r"c\+\+"),
    ("C#", r"c#|\.net"), ("Rust", r"\brust\b"), ("Kotlin", r"kotlin"), ("Swift", r"\bswift\b"),
    ("Spark", r"apache spark|pyspark|\bspark (?:sql|streaming|jobs?)\b"), ("Kafka", r"kafka"), ("Terraform", r"terraform"), ("Linux", r"linux"),
    ("GraphQL", r"graphql"), ("REST APIs", r"\brest(ful)?\b"), ("Tableau", r"tableau"), ("Power BI", r"power ?bi"),
    ("Excel", r"\bexcel\b"), ("pandas", r"pandas"), ("PyTorch", r"pytorch"), ("TensorFlow", r"tensorflow"),
    ("LLMs", r"\bllms?\b|large language model"), ("Salesforce", r"salesforce"), ("Snowflake", r"snowflake"),
    ("Git", r"\bgit\b"), ("CI/CD", r"ci/cd|continuous integration"),
    ("HTML/CSS", r"\bhtml5?\b|\bcss3?\b"), ("Tailwind CSS", r"tailwind"), ("Figma", r"figma"),
    ("Spring", r"spring boot|\bspring\b(?= framework| mvc| boot|,)"), ("Django", r"django"), ("Flask", r"\bflask\b"),
    ("FastAPI", r"fastapi"), ("Express", r"express\.?js|\bexpress\b(?= framework|,| and node)"),
    ("Redis", r"\bredis\b"), ("MySQL", r"mysql"), ("NoSQL", r"nosql|dynamodb|cassandra"),
    ("Supabase", r"supabase"), ("Firebase", r"firebase"), ("Vercel", r"vercel"),
    ("Jest", r"\bjest\b"), ("Cypress", r"cypress"), ("Playwright", r"playwright"), ("Selenium", r"selenium"),
    ("Airflow", r"airflow"), ("dbt", r"\bdbt\b"), ("Databricks", r"databricks"), ("BigQuery", r"bigquery"),
    ("Looker", r"looker"), ("R", r"\bR\b(?=\s*(,|/|and\b|programming|\(|studio))"),
    ("Statistics", r"statistic"), ("Machine Learning", r"machine learning|\bml\b"),
    ("Agile/Scrum", r"\bagile\b|\bscrum\b"), ("Jira", r"\bjira\b"), ("Expo", r"\bexpo\b(?= go|,| sdk)"),
]
STACK_RE = [(label, re.compile(rx, 0 if label == "R" else re.I)) for label, rx in STACK]


_EMOJI = re.compile(r"[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D]+")


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", _EMOJI.sub("", s)).strip(" -–—|:")


_FILLER = re.compile(r"instagram|facebook|twitter|linkedin page|follow us|check out our|click here|apply now|"
                     r"equal opportunity|e-?verify|accommodation|privacy (policy|notice)|recruitment fraud", re.I)


def _is_prose(p: str) -> bool:
    """A real sentence, not a title line ('Full Stack .NET Developer – Fort Worth, TX') or filler."""
    return (len(p) >= 60 and len(p.split()) >= 10 and not _FILLER.search(p)
            and bool(re.search(r"[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}", p)))


def _clip(s: str, n: int) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def _sentences(s: str, k: int) -> str:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z])", s.strip())
    return " ".join(parts[:k])


def summarize(desc: str, company: str) -> dict:
    lines = to_lines(desc)
    sections: list[tuple[str, list[str]]] = [("", [])]
    for line in lines:
        if line.startswith("## "):
            sections.append((line[3:].strip(" :"), []))
        else:
            sections[-1][1].append(line)

    def kind(head: str) -> str:
        h = head.lower()
        if not h:
            return "intro"
        if H_PREF.search(h):
            return "pref"
        if H_BENEFIT.search(h):
            return "benefit"
        if H_DUTY.search(h):
            return "duty"
        if H_REQ.search(h):
            return "req"
        if H_ROLE.search(h):
            return "role"
        if H_ABOUT.search(h) or (company and company.lower().split()[0] in h and "about" in h):
            return "about"
        return "other"

    paras = lambda items: [_clean(i) for i in items if not i.startswith("- ") and len(_clean(i)) > 40]
    bullets = lambda items: [_clean(i[2:]) for i in items if i.startswith("- ") and len(_clean(i[2:])) > 12]

    about = role = ""
    duties: list[str] = []
    reqs: list[str] = []
    req_text: list[str] = []
    for head, items in sections:
        k = kind(head)
        if k == "about" and not about and paras(items):
            about = " ".join(paras(items)[:2])
        elif k == "role" and not role and [p for p in paras(items) if _is_prose(p)]:
            role = [p for p in paras(items) if _is_prose(p)][0]
        elif k == "duty":
            duties += bullets(items) or paras(items)
            if not role and paras(items):
                role = paras(items)[0]
        elif k == "req":
            reqs += bullets(items) or paras(items)
            req_text += items
        elif k == "intro":
            first_word = company.lower().split()[0] if company.strip() else ""
            for p in paras(items)[:4]:
                starts_with_co = bool(first_word) and p.lower().startswith((first_word, "at " + first_word, "about " + first_word))
                if (COMPANY_INTRO.search(p[:160]) or starts_with_co) and not about:
                    about = p
                elif not role and _is_prose(p):
                    role = p
    full = " ".join(lines)
    # required years: requirement sections if the posting has them, else everything
    # (preferred / nice-to-have sections never count)
    basis = " \n".join(req_text) if req_text else "\n".join(
        l for (h, items) in sections if kind(h) not in ("pref", "benefit", "about") for l in items)
    pay = PAY_RE.search(full)
    pay_s = pay.group(0).strip() if pay and re.search(r"\d{2}", pay.group(0)) else ""
    stack = [label for label, rx in STACK_RE if rx.search(full)][:16]
    # prefer requirement bullets that say something concrete
    reqs.sort(key=lambda r: 0 if re.search(r"year|degree|experience|proficien|knowledge of", r, re.I) else 1)
    return {
        "sum": _clip(_sentences(role, 2), 300) if role else "",
        "do": [_clip(d, 150) for d in duties[:3]],
        "need": [_clip(r, 150) for r in reqs[:3]],
        "pay": pay_s,
        "stack": stack,
        "about": _clip(_sentences(about, 2), 320) if about else "",
        # "2+ years overall, 1+ year Spring Boot" → 2: the highest real requirement
        "y": max_years_required(basis),
        "ymin": min_years_required(basis),
        "tp": detect_topics(full),
    }

# ─────────────────────────────────────────────────────────────────────────────
#  COMPANY SUMMARY  (posting's "About us" first; Wikipedia as a fallback)
# ─────────────────────────────────────────────────────────────────────────────

_CO_SUFFIX = re.compile(r"\b(inc|llc|l\.l\.c|ltd|corp|corporation|co|company|group|holdings|plc|usa|us|the|technologies|technology|labs)\b\.?", re.I)
_CO_WORDS = re.compile(r"\b(company|corporation|conglomerate|firm|startup|retailer|bank|manufacturer|provider|developer|"
                       r"multinational|business|organization|agency|insurer|university|nonprofit|founded|headquartered|brand)\b", re.I)


def company_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", _CO_SUFFIX.sub(" ", (name or "").lower())).strip()


def wikipedia_summary(company: str) -> dict | None:
    key = company_key(company)
    if len(key) < 2:
        return None
    try:
        r = requests.get("https://en.wikipedia.org/w/api.php", headers={"User-Agent": WIKI_UA}, timeout=15, params={
            "action": "query", "list": "search", "srsearch": f"{company} company", "format": "json", "srlimit": 4})
        hits = r.json().get("query", {}).get("search", [])
    except (requests.RequestException, ValueError):
        return None
    first = key.split()[0]
    for hit in hits:
        title = hit.get("title", "")
        if first not in company_key(title) and key not in company_key(title):
            continue
        try:
            s = requests.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title.replace(' ', '_'))}",
                             headers={"User-Agent": WIKI_UA}, timeout=15).json()
        except (requests.RequestException, ValueError):
            continue
        extract = s.get("extract", "")
        if s.get("type") == "disambiguation" or not _CO_WORDS.search(extract[:300]):
            continue
        return {"s": _clip(_sentences(extract, 2), 320), "src": "Wikipedia",
                "u": (s.get("content_urls") or {}).get("desktop", {}).get("page", "")}
    return None

# ─────────────────────────────────────────────────────────────────────────────
#  CACHE + RUNNER
# ─────────────────────────────────────────────────────────────────────────────

def _load(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}


def _save(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False, sort_keys=True), encoding="utf-8")


MAX_RETRIES = 3


def _needs(rec: dict | None) -> bool:
    """Not fetched yet, or a retry (blocked / transient) not already attempted
    today — up to MAX_RETRIES days, then it's left as "none"."""
    return rec is None or (rec.get("st") == "retry" and rec.get("d") != TODAY
                           and rec.get("n", 0) < MAX_RETRIES)


def _enrich_one(row: dict) -> tuple[str, dict]:
    desc, meta = row.get("_desc") or "", {}
    if not desc:
        meta = fetch_posting(row.get("url", ""))
        desc = meta.get("desc", "")
    rec = {"d": TODAY, "st": meta.get("st", "ok" if desc else "none")}
    if desc:
        rec.update({k: v for k, v in summarize(desc, row.get("company", "")).items() if v not in ("", [], None)})
        rec["st"] = "ok"
    if meta.get("level"):
        rec["lvl"] = meta["level"]
    if meta.get("months") is not None and rec.get("y") is None:
        rec["y"] = meta["months"] // 12
    if meta.get("org"):
        rec["about"] = rec.get("about") or _clip(_sentences(meta["org"], 2), 320)
    return row["id"], rec


def is_too_experienced(rec: dict | None, max_years: int = 1) -> bool:
    """True if the full posting shows it isn't a 0–1 year role."""
    if not rec:
        return False
    if (rec.get("lvl") or "").lower() in SENIOR_LEVELS:
        return True
    y = rec.get("y")
    return y is not None and y > max_years


def enrich_rows(rows: list[dict], budget_s: float = 900, log=print) -> dict:
    """Enrich rows (dicts with id/url/title/company, optional _desc) in place;
    returns the whole cache. Stops starting new fetches after budget_s."""
    cache, companies = _load(ENRICH_FILE), _load(COMPANY_FILE)
    todo = [r for r in rows if r.get("id") and _needs(cache.get(r["id"]))]
    if not todo:
        return cache
    t0, done = time.time(), 0
    log(f"🔎 Enriching {len(todo)} postings (budget {int(budget_s)}s) …")
    with ThreadPoolExecutor(WORKERS) as pool:
        futures = {}
        it = iter(todo)
        # keep ~2×workers in flight; stop submitting once over budget
        for row in it:
            futures[pool.submit(_enrich_one, row)] = row
            if len(futures) >= WORKERS * 2:
                break
        while futures:
            for fut in as_completed(list(futures)):
                row = futures.pop(fut)
                try:
                    jid, rec = fut.result()
                    if rec.get("st") == "retry":
                        rec["n"] = (cache.get(jid) or {}).get("n", 0) + 1
                    cache[jid] = rec
                    done += 1
                    ck = company_key(row.get("company", ""))
                    if ck and rec.get("about") and ck not in companies:
                        companies[ck] = {"s": rec["about"], "src": "posting", "d": TODAY}
                except Exception as exc:          # never let one posting kill the run
                    log(f"    enrich error {row.get('url', '')[:60]}: {exc}")
                if time.time() - t0 < budget_s:
                    nxt = next(it, None)
                    if nxt is not None:
                        futures[pool.submit(_enrich_one, nxt)] = nxt
                break
            if done % 100 == 0:
                _save(ENRICH_FILE, cache)

    # Wikipedia for companies whose postings never described them (capped per run)
    need_co = []
    for row in todo:
        ck = company_key(row.get("company", ""))
        if ck and ck not in companies and ck not in {company_key(c) for c in need_co}:
            need_co.append(row.get("company", ""))
    for name in need_co[:150]:
        if time.time() - t0 > budget_s + 120:
            break
        got = wikipedia_summary(name)
        companies[company_key(name)] = (got or {"s": "", "src": "none"}) | {"d": TODAY}
        time.sleep(0.2)

    _save(ENRICH_FILE, cache)
    _save(COMPANY_FILE, companies)
    st = defaultdict(int)
    for r in todo:
        st[cache.get(r["id"], {}).get("st", "skipped")] += 1
    log(f"  ✓ Enriched {done}/{len(todo)} in {int(time.time() - t0)}s — {dict(st)}"
        + (f" · rate-limited: {', '.join(sorted(_blocked_hosts))}" if _blocked_hosts else ""))
    return cache


def backlog_rows() -> list[dict]:
    """Older CSV rows still worth enriching, newest first."""
    rows, seen = [], set()
    for path in sorted(glob.glob(str(DATA_DIR / "jobs_*.csv")), reverse=True):
        with open(path, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r.get("id") in seen or r.get("source") in SKIP_SOURCES or r.get("type", "job") != "job":
                    continue
                if not is_target_title(r.get("title", "")):
                    continue
                seen.add(r["id"])
                rows.append(r)
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--budget", type=float, default=600, help="seconds to spend fetching (default 600)")
    args = ap.parse_args()
    enrich_rows(backlog_rows(), budget_s=args.budget)
