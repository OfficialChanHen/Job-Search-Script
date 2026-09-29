"""
direct_links.py — find the company's own posting for jobs that came from a
job board or aggregator (LinkedIn, Dice, Adzuna, Jobicy, JSearch, …).

LinkedIn hides the company's apply link from logged-out visitors and most
Dice jobs are Dice "Easy Apply", so the link can't just be read off the page.
Instead, cheapest first:

  1. same company + title among postings we already have from company ATSs
     (our CSVs + the SimplifyJobs feed: ~20k direct Greenhouse / Lever / Ashby /
     Workday / … links)
  2. the company's own job board — learned from any direct link we've seen
     for that company, or found by trying likely slugs on Greenhouse / Lever /
     Ashby — searched for the same title
  3. nothing found → the dashboard shows a one-click search instead

Results land in data/enrich.json as  du (direct url) and dv (how it was found).
Which board each company uses is cached in data/companies.json ("ats").
"""

import csv
import glob
import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

DATA_DIR = Path(__file__).parent / "data"
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
SIMPLIFY_JSON = ("https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/"
                 "dev/.github/scripts/listings.json")

# Sources whose links already point at the employer's own posting
DIRECT_SOURCES = {"Greenhouse", "Lever", "Ashby", "Workday", "SmartRecruiters", "USAJobs",
                  "GitHub/Simplify", "GitHub/NewGrad", "GitHub/speedyapply"}
# Hosts that are job boards / aggregators, not the employer
AGGREGATOR_HOSTS = re.compile(
    r"linkedin\.com|dice\.com|adzuna\.|jobicy\.com|himalayas\.app|remoteok\.|remotive\.|weworkremotely\.|"
    r"indeed\.|glassdoor\.|ziprecruiter\.|zapply\.jobs|news\.ycombinator\.com|simplify\.jobs|jooble|talent\.com|"
    r"careerbuilder|monster\.com|builtin\.com|wellfound|lensa\.com|jobright|handshake", re.I)

_SUFFIX = re.compile(r"\b(inc|llc|l\.l\.c|ltd|corp|corporation|co|company|group|holdings|plc|usa|us|the|"
                     r"technologies|technology|labs|systems|solutions|software|services|international)\b\.?", re.I)
_LEVEL_WORDS = re.compile(r"\b(i|ii|iii|1|2|3|jr|sr|junior|senior|remote|hybrid|onsite|new grad|entry level|"
                          r"early career|full time|contract)\b", re.I)


def company_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", _SUFFIX.sub(" ", (name or "").lower())).strip()


def _tokens(title: str) -> set[str]:
    t = re.sub(r"[^a-z0-9+#]+", " ", (title or "").lower())
    return {w for w in t.split() if len(w) > 1 or w in ("c", "r")}


def title_score(a: str, b: str) -> float:
    """Jaccard similarity of title words; exact (case/punctuation-insensitive) match = 1."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    if ta == tb:
        return 1.0
    return len(ta & tb) / len(ta | tb)


def _core(title: str) -> str:
    return " ".join(sorted(_tokens(_LEVEL_WORDS.sub(" ", title or ""))))


def ats_of(url: str) -> dict | None:
    """Which ATS board a direct posting URL belongs to."""
    u = url or ""
    m = re.search(r"greenhouse\.io/(?:embed/job_app\?for=)?([\w-]+)/jobs/\d+", u)
    if m:
        return {"t": "gh", "s": m.group(1)}
    m = re.search(r"jobs\.lever\.co/([\w.-]+)/[0-9a-f-]{36}", u)
    if m:
        return {"t": "lever", "s": m.group(1)}
    m = re.search(r"jobs\.ashbyhq\.com/([^/?#]+)/[0-9a-f-]{36}", u)
    if m:
        return {"t": "ashby", "s": m.group(1)}
    m = re.search(r"https://(([^./]+)\.wd\d+\.myworkdayjobs\.com)/(?:[a-z]{2}-[A-Z]{2}/)?([^/?#]+)/job/", u)
    if m:
        return {"t": "wd", "h": m.group(1), "tn": m.group(2), "s": m.group(3)}
    m = re.search(r"jobs\.smartrecruiters\.com/([^/?#]+)/\d+", u)
    if m:
        return {"t": "sr", "s": m.group(1)}
    return None


def is_direct(url: str) -> bool:
    return bool(url) and not AGGREGATOR_HOSTS.search(urlparse(url).netloc)


def clean_url(url: str) -> str:
    """Drop tracking params (utm_*, ref=Simplify) so the link is the plain posting."""
    base, _, q = (url or "").partition("?")
    keep = [kv for kv in q.split("&") if kv and not re.match(r"(utm_\w+|ref|source|src|gh_src)=", kv, re.I)]
    return base + ("?" + "&".join(keep) if keep else "")

# ─────────────────────────────────────────────────────────────────────────────
#  INDEX of direct postings we already know about
# ─────────────────────────────────────────────────────────────────────────────


class DirectIndex:
    def __init__(self, session: requests.Session, log=print):
        self.s, self.log = session, log
        self.by_company: dict[str, list[tuple[str, str]]] = {}   # ck → [(title, url)]
        self.boards: dict[str, list[dict]] = {}                   # ck → [ats dicts]

    def add(self, company: str, title: str, url: str) -> None:
        ck = company_key(company)
        if not ck or not is_direct(url):
            return
        self.by_company.setdefault(ck, []).append((title, clean_url(url)))
        a = ats_of(url)
        if a and a not in self.boards.setdefault(ck, []):
            self.boards[ck].append(a)

    def load(self) -> "DirectIndex":
        for path in glob.glob(str(DATA_DIR / "jobs_*.csv")):
            with open(path, encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    if r.get("source") in DIRECT_SOURCES or is_direct(r.get("url", "")):
                        self.add(r.get("company", ""), r.get("title", ""), r.get("url", ""))
        try:
            items = self.s.get(SIMPLIFY_JSON, timeout=60).json()
            for it in items:
                if it.get("is_visible", True):
                    self.add(it.get("company_name", ""), it.get("title", ""), it.get("url", ""))
        except (requests.RequestException, ValueError):
            self.log("    (SimplifyJobs feed unavailable — using local postings only)")
        self.log(f"    direct-link index: {sum(len(v) for v in self.by_company.values())} postings, "
                 f"{len(self.boards)} companies with a known board")
        return self

    def match(self, company: str, title: str) -> str:
        best, url = 0.0, ""
        for t, u in self.by_company.get(company_key(company), []):
            sc = title_score(title, t)
            if sc > best:
                best, url = sc, u
        return url if best >= 0.75 else ""

# ─────────────────────────────────────────────────────────────────────────────
#  BOARD SEARCH  (one board = one company's ATS)
# ─────────────────────────────────────────────────────────────────────────────


class BoardSearch:
    def __init__(self, session: requests.Session):
        self.s = session
        self.cache: dict[str, list[tuple[str, str, str]]] = {}   # board id → [(title, url, location)]

    def _get_json(self, url, **kw):
        try:
            r = self.s.get(url, timeout=25, **kw)
            return r.json() if r.ok else None
        except (requests.RequestException, ValueError):
            return None

    def listings(self, a: dict, title: str) -> list[tuple[str, str, str]]:
        """All (title, url, location) on a board; Workday/SR are searched by title."""
        bid = json.dumps(a, sort_keys=True) + ("|" + title if a["t"] in ("wd", "sr") else "")
        if bid in self.cache:
            return self.cache[bid]
        out: list[tuple[str, str, str]] = []
        if a["t"] == "gh":
            j = self._get_json(f"https://boards-api.greenhouse.io/v1/boards/{a['s']}/jobs")
            out = [(x.get("title", ""), x.get("absolute_url", ""), (x.get("location") or {}).get("name", ""))
                   for x in (j or {}).get("jobs", [])]
        elif a["t"] == "lever":
            j = self._get_json(f"https://api.lever.co/v0/postings/{a['s']}", params={"mode": "json"})
            out = [(x.get("text", ""), x.get("hostedUrl", ""), (x.get("categories") or {}).get("location", ""))
                   for x in (j if isinstance(j, list) else [])]
        elif a["t"] == "ashby":
            j = self._get_json(f"https://api.ashbyhq.com/posting-api/job-board/{a['s']}")
            out = [(x.get("title", ""), x.get("jobUrl", ""), x.get("location", "")) for x in (j or {}).get("jobs", [])]
        elif a["t"] == "sr":
            j = self._get_json(f"https://api.smartrecruiters.com/v1/companies/{a['s']}/postings",
                               params={"q": title, "limit": 50})
            out = [(x.get("name", ""), f"https://jobs.smartrecruiters.com/{a['s']}/{x.get('id', '')}",
                    (x.get("location") or {}).get("fullLocation", "")) for x in (j or {}).get("content", [])]
        elif a["t"] == "wd":
            try:
                r = self.s.post(f"https://{a['h']}/wday/cxs/{a['tn']}/{a['s']}/jobs", timeout=25,
                                json={"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": title})
                posts = r.json().get("jobPostings", []) if r.ok else []
            except (requests.RequestException, ValueError):
                posts = []
            out = [(p.get("title", ""), f"https://{a['h']}/{a['s']}{p.get('externalPath', '')}", p.get("locationsText", ""))
                   for p in posts if p.get("externalPath")]
        self.cache[bid] = out
        return out

    def find(self, boards: list[dict], title: str, location: str) -> str:
        loc_words = {w for w in re.split(r"[^a-z]+", (location or "").lower()) if len(w) > 2}
        best, url = 0.0, ""
        for a in boards:
            for t, u, loc in self.listings(a, title):
                sc = title_score(title, t)
                if sc < 0.6 and _core(title) != _core(t):
                    continue
                if loc_words and loc_words & set(re.split(r"[^a-z]+", (loc or "").lower())):
                    sc += 0.1            # same city/state breaks ties between locations
                if sc > best:
                    best, url = sc, u
        return url

    def discover(self, company: str) -> list[dict]:
        """Try likely board slugs for a company we've never seen a direct link for."""
        ck = company_key(company)
        if not ck:
            return []
        slugs = list(dict.fromkeys([ck.replace(" ", ""), ck.replace(" ", "-"), ck.split()[0]]))
        found = []
        for slug in slugs[:3]:
            for t, url in (("gh", f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"),
                           ("lever", f"https://api.lever.co/v0/postings/{slug}?mode=json&limit=1"),
                           ("ashby", f"https://api.ashbyhq.com/posting-api/job-board/{slug}")):
                j = self._get_json(url)
                ok = (isinstance(j, list) and j) or (isinstance(j, dict) and j.get("jobs"))
                if ok:
                    found.append({"t": t, "s": slug})
            if found:
                break
        return found

# ─────────────────────────────────────────────────────────────────────────────
#  RUNNER
# ─────────────────────────────────────────────────────────────────────────────


def needs_direct(row: dict, rec: dict | None) -> bool:
    if rec is None or rec.get("st") == "gone" or "dv" in rec:
        return False
    return not (row.get("source") in DIRECT_SOURCES or is_direct(row.get("url", "")))


def resolve_direct(rows: list[dict], cache: dict, companies: dict, budget_s: float = 300, log=print) -> int:
    """Fill du/dv for board/aggregator rows in `rows` (cache = enrich.json dict,
    companies = companies.json dict, both updated in place). Returns # found."""
    todo = [r for r in rows if needs_direct(r, cache.get(r.get("id")))]
    if not todo:
        return 0
    t0 = time.time()
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    log(f"🔗 Looking for direct company links for {len(todo)} board/aggregator postings …")
    index = DirectIndex(s, log).load()
    boards = BoardSearch(s)
    stale = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
    found = 0
    for r in todo:
        if time.time() - t0 > budget_s:
            break
        rec = cache[r["id"]]
        # a redirect (zapply etc.) may already have landed on the employer's page
        if rec.get("final") and is_direct(rec["final"]):
            rec["du"], rec["dv"] = clean_url(rec.pop("final")), "redirect"
            found += 1
            continue
        company, title = r.get("company", ""), r.get("title", "")
        ck = company_key(company)
        url, how = index.match(company, title), "known posting"
        if not url:
            known = index.boards.get(ck, [])
            co = companies.setdefault(ck, {}) if ck else {}
            if not known and ck:
                cached = co.get("ats")
                if cached is None or (not cached.get("b") and cached.get("d", "") < stale):
                    co["ats"] = {"b": boards.discover(company), "d": TODAY}
                known = co["ats"].get("b", [])
            url, how = (boards.find(known, title, r.get("location", "")), "company board") if known else ("", "")
        rec["dv"] = how if url else "none"
        if url:
            rec["du"] = clean_url(url)
            found += 1
    log(f"  ✓ Direct links: found {found} of {len(todo)} in {int(time.time() - t0)}s")
    return found
