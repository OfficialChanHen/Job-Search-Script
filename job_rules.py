"""
Shared job-filtering rules for job_hunter.py (scraping) and build_dashboard.py
(re-filtering history). Everything here is pure — no network, no logging.

Target: US-only, full-time-first, SWE + tech-adjacent roles that need little
to no experience. Internships are excluded everywhere.
"""

import hashlib
import html
import re

# ─────────────────────────────────────────────────────────────────────────────
#  ROLE CATEGORIES
# ─────────────────────────────────────────────────────────────────────────────
# (category, label, title substrings). First match wins, so specific buckets
# come before the generic "swe" bucket. Every substring here also counts as a
# target title for the scraper.
ROLE_CATEGORIES: list[tuple[str, str, tuple[str, ...]]] = [
    ("ai_training", "AI Training", (
        "ai trainer", "ai tutor", "ai data specialist", "coding evaluator",
        "llm evaluator", "ai model evaluator", "ai training", "rlhf",
    )),
    ("solutions", "Solutions / FDE", (
        "forward deployed", "forward-deployed", "deployment strategist",
        "solutions engineer", "solution engineer", "sales engineer",
        "customer engineer", "implementation engineer", "integration engineer",
        "implementation consultant", "implementation specialist",
        "implementation analyst", "technical consultant", "solutions consultant",
        "technical account manager", "developer advocate", "developer relations",
        "technical support engineer", "support engineer", "application support",
        "applications support", "production support", "customer success engineer",
        "ai operations", "ai support",
    )),
    ("ml_ai", "AI / ML", (
        "machine learning", "ml engineer", "ai engineer", "applied ai",
        "ai developer", "ai software", "llm", "genai", "generative ai",
        "data scientist", "prompt engineer", "ai builder",
    )),
    ("data_eng", "Data Eng", (
        "data engineer", "analytics engineer", "etl developer", "etl engineer",
        "database developer", "database engineer", "big data",
    )),
    ("data_analyst", "Data / BI", (
        "data analyst", "business intelligence", "bi analyst", "bi developer",
        "bi engineer", "reporting analyst", "product analyst", "analytics analyst",
        "insights analyst", "data specialist", "data associate",
    )),
    ("qa", "QA / Test", (
        "qa engineer", "qa analyst", "qa automation", "quality assurance",
        "sdet", "software development engineer in test", "test engineer",
        "test automation", "automation engineer", "software tester", "test analyst",
        "quality engineer",
    )),
    ("devops", "Cloud / DevOps", (
        "devops", "site reliability", "sre", "platform engineer",
        "cloud engineer", "cloud support", "cloud associate", "cloud developer",
        "infrastructure engineer", "systems engineer", "system engineer",
        "systems administrator", "linux administrator",
    )),
    ("mobile", "Mobile", (
        "mobile", "ios", "android", "react native", "flutter",
    )),
    ("frontend", "Frontend / Web", (
        "frontend", "front-end", "front end", "ui engineer", "ui developer",
        "ux engineer", "design engineer", "web developer", "web engineer",
        "react developer", "react engineer", "javascript developer",
        "typescript developer", "wordpress developer", "shopify developer",
    )),
    ("platform_dev", "Salesforce / ERP", (
        "salesforce", "servicenow", "workday analyst", "workday developer",
        "sap ", "erp analyst", "erp developer", "dynamics 365", "power platform",
        "power apps", "rpa developer", "uipath", "epic analyst",
        "clinical applications analyst", "application analyst",
        "applications analyst",
    )),
    ("it_support", "IT / Support", (
        "it support", "help desk", "helpdesk", "service desk", "desktop support",
        "it specialist", "it analyst", "it technician", "it associate",
        "technical support specialist", "technical support analyst",
        "it engineer", "network technician", "network administrator",
        "information technology",
    )),
    ("analyst", "Tech Analyst", (
        "business systems analyst", "systems analyst", "technical analyst",
        "technology analyst", "programmer analyst", "it business analyst",
        "technical business analyst",
        "gis analyst", "gis developer", "technology associate",
    )),
    ("swe", "SWE", (
        "software engineer", "software developer", "software development engineer",
        "swe", "sde", "backend", "back-end", "back end", "full stack", "fullstack",
        "full-stack", "application developer", "application engineer",
        "applications developer", "applications engineer", "python developer",
        "python engineer", "java developer", "node developer", "node engineer",
        ".net developer", "c# developer", "golang", "product engineer",
        "programmer", "developer", "software",
        # early-career programs that are SWE tracks
        "technology development program", "technology leadership program",
        "engineering rotation", "engineering rotational", "technology rotational",
        "software apprentice", "technology apprentice", "developer apprentice",
        "engineering apprentice", "it apprentice",
    )),
]

CATEGORY_LABEL = {k: label for k, label, _ in ROLE_CATEGORIES}
# Categories that are core SWE (everything else is "tech-adjacent")
SWE_CATEGORIES = {"swe", "frontend", "mobile", "ml_ai", "data_eng", "devops", "qa"}

# Titles that contain a target term but aren't tech jobs
_NOT_TECH = re.compile(
    r"business development|sales development|real estate|cnc|plc|"
    r"mechanical|civil|hvac|electrical engineer|nurse|clinical research|"
    r"pharmac|physician|therapist|teacher|driver|warehouse|retail|cashier|"
    r"account executive|recruiter|marketing manager|land developer|"
    r"accountant|accounting|\bcmm\b|machinist|welder|"
    r"\(m/f/d\)|\(m/w/d\)|\(f/m/d\)",
    re.IGNORECASE)
# Non-software engineering disciplines — excluded unless "software" is in the title
_HARDWARE = re.compile(
    r"hardware|manufacturing|mechanical|avionics|propulsion|structures|"
    r"electrical|rf |antenna|firmware|chamber|nozzle|vehicle systems|"
    r"control room|operator\b|technician\b(?<!it technician)|silicon|"
    r"physical design|satellite|electromagnetic|foundry|test engineer|thermal",
    re.IGNORECASE)

# ─────────────────────────────────────────────────────────────────────────────
#  SENIORITY / INTERNSHIP / CLEARANCE
# ─────────────────────────────────────────────────────────────────────────────

_JUNIOR = re.compile(
    r"\bjunior\b|\bjr\b|entry[ -]?level|new[ -]grad|new graduate|early[ -]career|"
    r"university grad|recent grad|graduate|\bassociate\b|apprentice|"
    r"rotation|development program|leadership program|\b20(26|27)\b",
    re.IGNORECASE)

# Always blocked, even with a junior word ("Associate Director")
_HARD_SENIOR = re.compile(
    r"\b(staff|stf|principal|director|vp|vice president|head of|manager|"
    r"architect|distinguished|fellow|chief)\b", re.IGNORECASE)
# Blocked unless an explicit junior signal is present
_SOFT_SENIOR = re.compile(r"\b(senior|sr|lead|expert|specialist ii)\b", re.IGNORECASE)
# "Senior Associate" is a mid-level rung (consulting/finance), not a junior one
_SENIOR_ASSOC = re.compile(r"\b(senior|sr\.?)\s+associate\b", re.IGNORECASE)
# Level II+ ("Engineer II", "Developer 3", "L4") — typically 2+ years
_LEVEL_UP = re.compile(r"\b(ii|iii|iv|v|2|3|4|l[4-9]|[ep][3-9]|ic[3-9])\b\s*($|[-–,(/|:])", re.IGNORECASE)
# Level I ("Engineer I", "Software Engineer 1")
_LEVEL_ONE = re.compile(r"\b(i|1)\b\s*($|[-–,(/|:])", re.IGNORECASE)

_INTERN = re.compile(
    r"\bintern\b|\binterns\b|internship|co-?op\b|\bstudent\b|summer 20\d\d|"
    r"\bsummer\b.*\b(analyst|engineer|developer)\b|externship|fellowship",
    re.IGNORECASE)

_CLEARANCE = re.compile(
    r"ts/sci|top secret|polygraph|\bclearance\b|\bcleared\b", re.IGNORECASE)


def role_category(title: str) -> str:
    """Bucket a title into one of ROLE_CATEGORIES ('' if not a target role)."""
    t = f" {title.lower()} "
    for key, _, terms in ROLE_CATEGORIES:
        if any(term in t for term in terms):
            # "developer"/"software"/"programmer" alone are only SWE if the
            # title isn't obviously non-tech (checked in is_target_title)
            return key
    return ""


def is_intern(title: str) -> bool:
    return bool(_INTERN.search(title))


def is_too_senior(title: str) -> bool:
    if _HARD_SENIOR.search(title) or _SENIOR_ASSOC.search(title):
        return True
    if _LEVEL_UP.search(title) and not _LEVEL_ONE.search(title):
        return True
    return bool(_SOFT_SENIOR.search(title)) and not _JUNIOR.search(title)


def is_junior_title(title: str) -> bool:
    """Explicit junior / new-grad / level-1 signal in the title."""
    return bool(_JUNIOR.search(title) or _LEVEL_ONE.search(title))


def is_target_title(title: str) -> bool:
    """SWE or tech-adjacent, not senior, not an internship, not clearance-gated."""
    if not title or is_intern(title) or is_too_senior(title):
        return False
    if _NOT_TECH.search(title) or _CLEARANCE.search(title):
        return False
    if _HARDWARE.search(title) and not re.search(r"software|developer|\bit\b|\bqa\b|web|data|cloud", title, re.I):
        return False
    return bool(role_category(title))

# ─────────────────────────────────────────────────────────────────────────────
#  EXPERIENCE REQUIRED  (parsed from descriptions when a source provides them)
# ─────────────────────────────────────────────────────────────────────────────

_NUM = r"(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)"
_WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
             "seven": 7, "eight": 8, "nine": 9, "ten": 10}
_YEARS_RE = re.compile(
    rf"(?<![\d.]){_NUM}\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*{_NUM}\s*\+?\s*)?"
    r"(?:years?|yrs?)(?:['’]s?)?\s*(?:of\s+)?"
    r"(?:(?:[a-z/,&-]+\s+){0,5}?(?:experience|exp\b)"
    r"|(?:professional\s+|industry\s+|relevant\s+|hands[- ]on\s+|work\s+)?"
    r"(?:working|building|developing|designing|writing|programming|coding|shipping|"
    r"in\s+(?:a\s+)?(?:software|engineering|development|the industry|industry|professional|related|"
    r"similar|data|it\b|web|back|front|full|production|a\s+\w+\s+role)))",
    re.IGNORECASE)
_NO_EXP_RE = re.compile(
    r"no (?:prior |professional )?experience (?:is )?(?:required|necessary|needed)|"
    r"new grad|recent graduate|entry[- ]level|0\s*(?:-|–|to)\s*[12]\s*years?",
    re.IGNORECASE)
# sentences whose years don't count as the real requirement
_PREFERRED_RE = re.compile(
    r"prefer|nice[- ]to[- ]have|bonus|a plus|is a plus|ideally|desired|desirable|would be great|"
    r"in lieu of|instead of a degree|without a degree|equivalent combination", re.IGNORECASE)
# "we've served clients for 15+ years" — about the company, not the candidate
_COMPANY_YEARS_RE = re.compile(
    r"\b(we|we've|we have|our|us)\b.*\byears\b|for (over|more than) \d+ years|years in business|years of (service|history)",
    re.IGNORECASE)
_CANDIDATE_RE = re.compile(r"\byou\b|\byour\b|candidate|applicant|required|requirement|must|minimum|qualif", re.IGNORECASE)
_ADV_DEGREE_RE = re.compile(r"master|ph\.?d|doctora|advanced degree|graduate degree|\bms\b|\bm\.s\.", re.IGNORECASE)
_SENTENCE_SPLIT = re.compile(r"(?<=[.;!?•·])\s+|\n+|\s{2,}|•")

MAX_YEARS = 1          # 0–1 years: drop postings whose (minimum) requirement is above this
STRICT_MAX_YEARS = 1   # plain titles (no junior signal): every mention must be ≤ this


def html_to_text(raw: str) -> str:
    """Greenhouse/Ashby descriptions arrive as (sometimes escaped) HTML."""
    text = html.unescape(html.unescape(raw or ""))
    text = re.sub(r"<(br|/p|/li|/div|/h\d)[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"[ \t\r\f\v]+", " ", text)


def _year_mentions(text: str) -> list[int]:
    """
    Required-years figures, one per sentence that states one. Preferred /
    nice-to-have / degree-substitute sentences are skipped; a figure that
    only applies with a Master's/PhD is used only if nothing else is stated
    ("BS + 3 years, or MS + 1 year" → 3, not 1).
    """
    basic, advanced = [], []
    # "FOUR (4) years" / "two (2) years" → "4 years"
    text = re.sub(r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s*\((\d{1,2})\)", r"\1", text or "", flags=re.IGNORECASE)
    text = re.sub(r"\b(\d{1,2})\s*\(\1\)", r"\1", text)
    for sent in _SENTENCE_SPLIT.split(text):
        if not sent or _PREFERRED_RE.search(sent):
            continue
        if _COMPANY_YEARS_RE.search(sent) and not _CANDIDATE_RE.search(sent):
            continue
        # "BS and 3 years, or MS and 1 year" — judge each alternative on its own
        for clause in re.split(r"\bor\b", sent, flags=re.IGNORECASE):
            for m in _YEARS_RE.finditer(clause):
                raw = m.group(1).lower()
                n = _WORD_NUM.get(raw) if not raw.isdigit() else int(raw)
                if n is None or n > 15:
                    continue
                (advanced if _ADV_DEGREE_RE.search(clause) else basic).append(n)
    return basic or advanced


def min_years_required(text: str) -> int | None:
    """
    The posting's minimum required years (lowest figure among the real
    requirements), 0 for explicit no-experience / new-grad wording, or None
    if it never says.
    """
    if not text:
        return None
    mentions = _year_mentions(text)
    if mentions:
        return min(mentions)
    return 0 if _NO_EXP_RE.search(text) else None


def max_years_required(text: str) -> int | None:
    """Largest required-years figure (None if none) — the strict reading."""
    mentions = _year_mentions(text)
    return max(mentions) if mentions else None


def experience_label(years: int | None) -> str:
    if years is None:
        return ""
    return "0 yrs" if years == 0 else f"{years}+ yrs"

# ─────────────────────────────────────────────────────────────────────────────
#  JOB TYPE  (Full-time / Part-time / Contract / Temporary)
# ─────────────────────────────────────────────────────────────────────────────

JOB_TYPES = ("Full-time", "Part-time", "Contract", "Temporary")

_TYPE_ALIASES = {
    "fulltime": "Full-time", "full_time": "Full-time", "full-time": "Full-time",
    "full time": "Full-time", "permanent": "Full-time", "regular": "Full-time",
    "parttime": "Part-time", "part_time": "Part-time", "part-time": "Part-time",
    "part time": "Part-time",
    "contract": "Contract", "contractor": "Contract", "contracts": "Contract",
    "freelance": "Contract", "third party": "Contract", "c2c": "Contract",
    "contract to hire": "Contract", "contract-to-hire": "Contract",
    "temporary": "Temporary", "temp": "Temporary", "fixed-term": "Temporary",
    "fixed term": "Temporary", "seasonal": "Temporary",
    "intern": "Internship", "internship": "Internship",
}

_TITLE_TYPE = [
    (re.compile(r"part[- ]time", re.I), "Part-time"),
    (re.compile(r"\bcontract|\bcontractor\b|\bc2c\b|\b1099\b|freelance", re.I), "Contract"),
    (re.compile(r"\btemporary\b|\btemp\b|fixed[- ]term|seasonal", re.I), "Temporary"),
]
_DESC_TYPE = [
    (re.compile(r"this (?:is a |role is a |position is a )?part[- ]time (?:role|position|job)", re.I), "Part-time"),
    (re.compile(r"contract[- ]to[- ]hire|(?:this is a |is a )\d*[- ]?(?:month )?contract (?:role|position)|"
                r"\bw2 contract|\b1099\b|corp[- ]to[- ]corp", re.I), "Contract"),
    (re.compile(r"(?:this is a )temporary (?:role|position)", re.I), "Temporary"),
]


def normalize_job_type(raw: str) -> str:
    """Map a source's employment-type string to one of JOB_TYPES ('' if unknown)."""
    if not raw:
        return ""
    r = raw.strip().lower()
    if r in _TYPE_ALIASES:
        return _TYPE_ALIASES[r]
    # Composite labels like "Full-time, Third Party" — the first known one wins
    for part in re.split(r"[,/|;]", r):
        part = part.strip()
        if part in _TYPE_ALIASES:
            return _TYPE_ALIASES[part]
    for key, val in _TYPE_ALIASES.items():
        if key in r:
            return val
    return ""


def infer_job_type(explicit: str = "", title: str = "", text: str = "",
                   default: str = "") -> str:
    """
    Explicit source value wins; then the title; then a clear statement in the
    description; then `default` (company ATS boards and new-grad lists are
    overwhelmingly full-time, so their fetchers pass "Full-time").
    """
    jt = normalize_job_type(explicit)
    if jt:
        return jt
    for rx, label in _TITLE_TYPE:
        if rx.search(title):
            return label
    for rx, label in _DESC_TYPE:
        if rx.search(text or ""):
            return label
    return default

# ─────────────────────────────────────────────────────────────────────────────
#  LOCATION — US only
# ─────────────────────────────────────────────────────────────────────────────

_US_STATE_ABBR = re.compile(
    r'(?:,|\s-|\()\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|'
    r'MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|'
    r'SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b'
)
_US_STATE_NAMES = {
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
    "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
    "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
    "new mexico", "new york", "north carolina", "north dakota", "ohio",
    "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
    "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
    "washington", "west virginia", "wisconsin", "wyoming", "district of columbia",
}
_US_CITIES = {
    "san francisco", "new york", "nyc", "seattle", "austin", "boston",
    "chicago", "denver", "los angeles", "san jose", "palo alto", "san diego",
    "mountain view", "minneapolis", "st. paul", "st paul", "saint paul",
    "atlanta", "miami", "washington d.c", "washington dc", "bellevue",
    "menlo park", "sunnyvale", "redmond", "pittsburgh", "philadelphia",
    "raleigh", "durham", "dallas", "houston", "phoenix", "salt lake",
    "madison", "milwaukee", "detroit", "columbus", "nashville", "portland",
    "bay area", "silicon valley", "twin cities",
}
_US_TOKENS = re.compile(
    r"\busa\b|united states|\bu\.s\.?\b|\bus\b|\bus[- ]only\b|\bus[- ]based\b|"
    r"north(?:ern)? america|\bamericas\b|\bamer\b|us remote|remote[- ,(]+us\b",
    re.IGNORECASE)
_NON_US = {
    "mexico", "canada", "europe", "emea", "apac", "latam", "united kingdom",
    " uk", "(uk", "ireland", "germany", "france", "poland", "india", "brazil",
    "argentina", "spain", "portugal", "netherlands", "australia", "japan",
    "china", "singapore", "israel", "london", "berlin", "toronto", "vancouver, bc",
    "dublin", "amsterdam", "bangalore", "bengaluru", "tokyo", "sydney",
    "philippines", "montreal", "ontario", "quebec", "colombia", "nigeria",
    "pakistan", "romania", "ukraine", "korea", "taiwan", "vietnam", "remoto",
}


def is_us_location(location: str, bare_remote_ok: bool = True) -> bool:
    """
    True if a listing is in / open to the US.
    `bare_remote_ok`: accept a location of just "Remote" (or blank). True for
    US-company career boards; False for global remote boards, where a bare
    "Remote" usually means "anywhere but probably not paying US rates".
    Worldwide/anywhere listings are never accepted — US-only focus.
    """
    loc = (location or "").strip()
    low = loc.lower()
    if not low or low in ("remote", "remote.", "flexible / remote", "hybrid", "onsite"):
        return bare_remote_ok
    if (_US_TOKENS.search(loc) or _US_STATE_ABBR.search(loc)
            or any(s in low for s in _US_STATE_NAMES)
            or any(c in low for c in _US_CITIES)):
        return True
    return False if any(m in low for m in _NON_US) else False


# ─────────────────────────────────────────────────────────────────────────────
#  WORK MODE
# ─────────────────────────────────────────────────────────────────────────────

REMOTE_LOC_RE = re.compile(r"remote|anywhere|worldwide|global|distributed", re.IGNORECASE)


def classify_work_mode(location: str, explicit: str = "") -> str:
    """
    Bucket a listing as onsite / hybrid / remote.
    `explicit` wins when the source API states it.
    """
    e = (explicit or "").lower().replace("-", "").replace(" ", "").replace("_", "")
    if e in ("onsite", "inperson", "inoffice", "office"):
        return "onsite"
    if e in ("hybrid", "remote"):
        return e
    loc = (location or "").lower()
    if "hybrid" in loc:
        return "hybrid"
    if not loc.strip() or REMOTE_LOC_RE.search(loc):
        return "remote"
    return "onsite"


# ─────────────────────────────────────────────────────────────────────────────
#  URL KEY  (closed-job detection: "is this posting still on its board?")
# ─────────────────────────────────────────────────────────────────────────────

_TRACKING_PARAM = re.compile(r"^(utm_[a-z_]+|ref|source|gh_src|lever-source|src)$", re.IGNORECASE)


def url_key(url: str) -> str:
    """10-char hash of a posting URL with tracking params (utm_*, ref=…) removed,
    so the same posting linked from different lists matches."""
    u = (url or "").strip()
    base, _, query = u.partition("?")
    keep = [kv for kv in query.split("&") if kv and not _TRACKING_PARAM.match(kv.split("=", 1)[0])]
    norm = base.rstrip("/").lower() + ("?" + "&".join(sorted(keep)) if keep else "")
    return hashlib.md5(norm.encode()).hexdigest()[:10]
