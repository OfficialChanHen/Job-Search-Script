# 🎯 Job scraper

The daily pipeline behind the app. It finds **entry-level SWE and tech-adjacent roles in the US**, reads the
full postings, and writes the data the website shows.

Runs every morning at **8:00 AM CST** via GitHub Actions (`.github/workflows/daily_jobs.yml`):

1. `job_hunter.py` scrapes every source into `data/jobs_YYYY-MM-DD.csv`
2. `enrich.py` reads full postings (summaries, years of experience, knockout flags, company blurbs)
3. `build_data.py` scores and flags every job and writes `../public/data/*.json` for the app
4. `notify.py` sends the morning digest (if a channel is set up)
5. The results are committed, and Vercel redeploys the site with the new data

**Focus:** full-time first, US only, little to no experience, no internships, in-person before hybrid before remote.

Shared rules live in `job_rules.py` (what counts as a target job) and `interview_prep.py` (LeetCode picks per job).

---

## 🧭 Roles it targets

SWE roles are the core, but entry-level SWE postings are shrinking (Indeed Hiring
Lab, Jul 2026: entry-level postings −7.5% YoY while senior +14.7%; ~69% of software
postings are senior). These adjacent roles are where new-grad hiring is holding
up or growing, and they fit a CS + Data Science background:

| Category | Example titles | Coding interview? |
|---|---|---|
| **SWE / Frontend / Mobile** | Software Engineer I, Associate SWE, Frontend (React), React Native | Yes — LeetCode easy–medium |
| **Solutions / FDE** | Forward Deployed Engineer, Deployment Strategist, Solutions / Implementation / Support Engineer | Practical coding + customer case |
| **Data / BI** | Data Analyst, BI Analyst, Analytics Engineer | SQL screen (LeetCode SQL 50) |
| **AI / ML** | AI Engineer, Applied AI, ML Engineer I | Yes — mediums + ML basics |
| **QA / Cloud / DevOps** | QA Engineer, SDET, Cloud Support Associate | Lighter LeetCode + scripting |
| **Salesforce / ERP** | Salesforce Developer, ServiceNow Developer, Epic analyst | Light |
| **IT / Tech analyst** | IT Analyst, Business Systems Analyst, Technology Associate | Usually none |
| **Early-career programs** | U.S. Bank Engineering Rotation, Target Technology programs, apprenticeships | Varies |

AI-trainer coding contracts (DataAnnotation, Outlier, Mercor) are matched too, but
they're 1099 contract work — useful side income, ranked below full-time roles.

**Filtered out:** internships / co-ops / student roles, senior/staff/lead/manager / "Senior
Associate", level II+ titles (II, 3, E3+, P3+), clearance-required (TS/SCI) roles, hardware-only
engineering, and anything whose **full posting asks for 2+ years** — the target is **0–1 years**.

Every new job's full posting is read (`enrich.py`) — including LinkedIn, Dice and the new-grad
lists, whose search results don't show requirements — so "entry level" labels that turn out to
want 3–5 years are dropped. Years are read from the requirements, not "preferred"/"nice to have"
lines; "BS + 3 years or MS + 1 year" counts as 3; LinkedIn "Mid-Senior level" is dropped too.
Older jobs are re-checked a few hundred per day.

---

## 📦 What it scrapes

| Source | Type | Key Required? |
|---|---|---|
| **LinkedIn** | Public job search — entry-level, full-time, last 24h | ❌ Free |
| **Dice** | Tech recruiting board — full-time, posted today | ❌ Free |
| **Himalayas** | US + entry-level search API | ❌ Free |
| **Hacker News** | Monthly "Who is hiring?" posts mentioning junior/new grad | ❌ Free |
| **SimplifyJobs** | New-Grad-Positions JSON feed (last 3 weeks) | ❌ Free |
| **speedyapply / zapplyjobs** | 2027 new-grad lists (USA) | ❌ Free |
| **Greenhouse** | ~60 company boards (Stripe, SpaceX, Datadog, Jamf, Jane Street, …) | ❌ Free |
| **Ashby** | ~26 boards (OpenAI, Ramp, Plaid, Snowflake, Cursor, …) | ❌ Free |
| **Lever** | Palantir, Zoox | ❌ Free |
| **SmartRecruiters** | ServiceNow, AbbVie | ❌ Free |
| **Workday** | Large employers (Target, U.S. Bank, Medtronic, 3M, General Mills, Thomson Reuters, C.H. Robinson, Securian, Ameriprise, Xcel, …) + Capital One, Nvidia, Salesforce, Visa, … | ❌ Free |
| **RemoteOK / Remotive / WeWorkRemotely / Jobicy** | Remote boards — only US-restricted listings kept | ❌ Free |
| **USAJobs** | Federal IT/CS/data jobs, GS-5–9, incl. Pathways Recent Graduates | ✅ Free signup |
| **JSearch** | Google for Jobs → Indeed, Glassdoor, ZipRecruiter, … | ✅ Free RapidAPI tier |
| **Adzuna** | Large job aggregator | ✅ Free signup |

Not scraped (need a login — check them by hand): **Handshake** (the most important
one for new grads), Wellfound, YC Work at a Startup, Built In.
Indeed is covered indirectly through JSearch once its key is added.

---

## 🚀 Setup

### 1. Optional free API keys (unlock 3 more sources)

Repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Where to get it |
|---|---|
| `USAJOBS_KEY` | [developer.usajobs.gov/apirequest](https://developer.usajobs.gov/apirequest/) |
| `USAJOBS_EMAIL` | The email you registered the USAJobs key with |
| `JSEARCH_KEY` | [rapidapi.com → JSearch](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch) → subscribe to the free plan → copy `X-RapidAPI-Key` (free tier ≈ 200 req/month; the scraper uses 5/day) |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | [developer.adzuna.com](https://developer.adzuna.com/) |

You're eligible for **Pathways Recent Graduates** for 2 years after your degree
(until about mid-2027).

**Morning digest** — add the secret(s) for whichever channel you want (any combination works):

| Secret | Channel |
|---|---|
| `NTFY_TOPIC` | [ntfy](https://ntfy.sh) push notifications — install the app, subscribe to a topic, use the same name here. Pick something unguessable (e.g. `chan-jobs-7f3k9q`): anyone who knows a topic name can read it. |
| `DISCORD_WEBHOOK_URL` | Discord channel → Edit Channel → Integrations → Webhooks → New → Copy URL |
| `SMTP_USER`, `SMTP_PASSWORD`, `DIGEST_EMAIL_TO` | Email. For Gmail: `SMTP_USER` = your address, `SMTP_PASSWORD` = an [App Password](https://myaccount.google.com/apppasswords) (needs 2-Step Verification), `DIGEST_EMAIL_TO` = where to send it |
| `SHEET_EXEC_URL` | Your Apps Script `/exec` URL — adds "follow up today" to the digest |

Preview it locally with `python scraper/notify.py --dry-run`.

### 2. Enable GitHub Actions

**Actions** tab → enable workflows. The workflow runs automatically at 8 AM CST.

---

## ▶️ Run manually

**From GitHub:** Actions tab → "Daily Job Hunt" → "Run workflow"

**Locally:**
```bash
pip install -r scraper/requirements.txt
python scraper/job_hunter.py                 # all sources
python scraper/job_hunter.py linkedin dice   # just some sources (substring of fetch_* names)
python scraper/enrich.py --budget 600        # read older postings (summaries / years), 10 min
python scraper/build_data.py                 # write public/data/*.json for the app
python scraper/notify.py --dry-run           # preview the morning digest
```

---

## 📁 Output files

```
data/
  seen_jobs.json          ← tracks all seen IDs (prevents duplicates across days)
  jobs_2026-09-23.csv     ← that day's new listings
  live_jobs.json          ← which postings are still up on each board (closed-job detection)
  enrich.json             ← per job: summary, required years, topics (from the full posting)
  companies.json          ← per company: summary + source
logs/
  job_hunter_2026-09-23.log   ← full debug log for each run (API keys are redacted)
```

### CSV columns

| Column | Description |
|---|---|
| `id` | Stable 12-char hash (MD5 of title+company+url) |
| `date_found` | Date this listing was first seen |
| `type` | `job` |
| `source` | Which site it came from |
| `title`, `company`, `location`, `url` | The listing |
| `posted` | Date (or age, for new-grad lists) the listing was posted |
| `tags` | Department / tech tags when the source has them |
| `work_mode` | `onsite` / `hybrid` / `remote` |
| `job_type` | `Full-time` / `Contract` / `Part-time` / `Temporary` (blank = source didn't say) |
| `experience` | Stated requirement, e.g. `0 yrs`, `1+ yrs`, `Entry-level`, `New grad` |
| `category` | Role bucket: `swe`, `frontend`, `data_analyst`, `solutions`, … |

---

## 🔧 Customization

| What | Where |
|---|---|
| Keyword searches (LinkedIn etc.) | `SEARCH_TERMS`, `TWIN_CITIES_TERMS` in `job_hunter.py` |
| Company boards | `GREENHOUSE_BOARDS`, `ASHBY_BOARDS`, `LEVER_BOARDS`, `SMARTRECRUITERS_BOARDS`, `WORKDAY_BOARDS` in `job_hunter.py` |
| Which titles count, seniority, internships, years-of-experience cutoffs, US check | `job_rules.py` (`ROLE_CATEGORIES`, `MAX_YEARS`, `STRICT_MAX_YEARS`) |
| LeetCode problem lists per role / company | `interview_prep.py` |
| Scoring weights | `classify_and_score()` in `build_data.py` |

> Find a board slug from a careers-page URL: `boards.greenhouse.io/<slug>`,
> `jobs.lever.co/<slug>`, `jobs.ashbyhq.com/<slug>`, or for Workday
> `<tenant>.wdN.myworkdayjobs.com/<site>`.

Change the cron schedule in `.github/workflows/daily_jobs.yml`:
```yaml
- cron: "0 14 * * *"   # 8 AM CST — change to your preferred time
```

---

## 💡 Tips

- LinkedIn sometimes rate-limits GitHub's servers; when it does, the log says
  "rate-limited (429)" and the other sources still run.
- The `seen_jobs.json` file is what prevents the same job appearing twice. Don't delete it.
