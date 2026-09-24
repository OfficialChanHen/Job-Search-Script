# 🎯 Job Hunter — Chan Hen

Automated daily job scraper for **entry-level SWE and tech-adjacent roles in the US**.
Runs every morning at **8:00 AM CST** via GitHub Actions.
Results are committed back to this repo as `data/jobs_YYYY-MM-DD.csv`, and an
interactive **dashboard** is rebuilt at `docs/index.html` (served with GitHub Pages).

**Focus:** full-time first · US only · little to no experience · no internships ·
in-person > hybrid > remote.

---

## 📊 The Dashboard

Every run rebuilds `docs/index.html` — a single self-contained page with **all
jobs ever collected** (history is re-filtered with today's rules), scored against
your resume skills, entry-level signals, full-time, in-person and Minnesota.

- Tabs: **New today / All / Minnesota / In-person / Hybrid / Remote / Entry-level / SWE / Tech-adjacent / Saved / Applied / Hidden**
- Filters: **job type** (defaults to Full-time), **role** (SWE, Frontend, Data/BI, Solutions/FDE, QA, Cloud, IT…), source, sort
- Every card shows **Full-time / Contract / Part-time**, work mode, role category, stated experience,
  and a **⚠ check grad window** flag on class-of-2026/2027 new-grad postings
- **📄 Summary** on each job, read from the full posting: what the role is, what you'd do, what
  they want, pay, tech stack, and required years — plus a **company summary** (the posting's
  "About us", else Wikipedia)
- **🧠 LeetCode prep** on each job: what the interview usually tests for that role (and company,
  where there's a well-known pattern) plus 6 problems chosen **for that job** — from ~175 problems
  in 20 topic pools, weighted by what the posting emphasizes (routing/logistics → graphs,
  real-time → heaps, databases → SQL, React → JS…), so different jobs get different lists
- Track per job: **✓ Applied / ★ Save / Hide** (stored in your browser)
- **Google Sheets:** ✓ Applied auto-adds a row to your tracker (see [sheet-sync/README.md](sheet-sync/README.md));
  **📋 Copy row** copies any job in your sheet's column order for pasting;
  **⬇ Export tracked** downloads Applied + Saved in the same order

Sheet columns: `Last Update | Company | Job | Location | Status | Application | Job Type | LeetCode Prep`
(the LeetCode Prep cell is the interview focus plus one `• #N Problem` bullet per line).

### 🎯 Getting more replies

- **🤝 Referral** on every job: one-click LinkedIn searches for UW–Madison alumni, recruiters and
  engineers at that company, plus an editable ≤300-character outreach note to copy.
  Mark **✉ I reached out** (+30 XP).
- **📬 Follow-ups:** applications 7+ days old with no reply (from your ✓ Applied marks *and* your
  sheet) with a ready-to-send follow-up message. ✓ Followed up: +15 XP.
- **📈 Results:** interview rate from your sheet's Status column, broken down by channel,
  location, role type and month — so you can apply where you actually get callbacks.
  "Applied" rows older than 30 days count as no reply; a status like *Behavioral / Phone screen /
  Interview / OA / Offer* counts as a response (and is worth +200 XP in the game).
- **🔁 LeetCode reviews:** problems you tick as solved come back after 3, 7 and 14 days (+10 XP each).
- **Ghost-job flags:** ⛔ *Closed* when a posting has disappeared from its company board (those are
  hidden except in Saved/Applied), 🔁 *Posted N×* when the same title/company/location keeps being
  re-posted, 📅 *30+ days old* when a listing can't be re-checked.
- **Morning digest** (optional): the day's top 10 new matches — full-time and Minnesota first — plus
  follow-ups due, pushed to your phone or inbox right after the daily run. Setup below.

### 🎮 The game layer

Job hunting, but with XP — so it's less of a grind:

- **Level up** from *Resume Rookie* → *Recruiter Whisperer* → *OA Survivor* → … → *Final Boss of Job Hunting*.
  XP comes only from real progress: ✓ applied **+50**, 🧠 LeetCode problem solved **+20** (tick it in any
  prep panel), ★ saved **+10**, 🎮 job triaged **+2**, daily quests cleared **+50**, badge unlocked **+25**.
  Un-marking something takes its XP back.
- **Daily quests:** apply to 3 jobs, solve or review 2 LeetCode problems, reach out or follow up once,
  triage 10 jobs — plus a 🔥 activity streak.
- **🎮 Quick Play:** one job at a time with its summary, keyboard-driven — **←** pass, **↑** save,
  **→** open & apply. After opening, it asks "did you submit?": **Enter** applied · **↑** save for
  later · **←** didn't apply, pass. Combos, confetti, and a job-search tip each round.
  It plays whatever tab + filters you have selected, so pick *Minnesota* or *Full-time · SWE* first.
- **🏆 20 badges** — First Blood, Local Legend, Touch Grass (in-person), Connector, Persistent,
  Grinder, Spaced Out, Boss Battle (first interview), Offer!…

Progress lives in your browser (same as Applied/Saved marks); applying through Quick Play still
auto-fills your Google Sheet.

**One-time setup:** repo → Settings → Pages → Source: *Deploy from a branch* →
Branch `main`, folder `/docs`. Your dashboard then lives at
`https://officialchanhen.github.io/Job-Search-Script/` and refreshes daily.

To rebuild locally: `python build_dashboard.py` then open `docs/index.html`.

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
| **Workday** | Twin Cities employers (Target, U.S. Bank, Medtronic, 3M, General Mills, Thomson Reuters, C.H. Robinson, Securian, Ameriprise, Xcel, …) + Capital One, Nvidia, Salesforce, Visa, … | ❌ Free |
| **RemoteOK / Remotive / WeWorkRemotely / Jobicy** | Remote boards — only US-restricted listings kept | ❌ Free |
| **USAJobs** | Federal IT/CS/data jobs, GS-5–9, incl. Pathways Recent Graduates | ✅ Free signup |
| **JSearch** | Google for Jobs → Indeed, Glassdoor, ZipRecruiter, … | ✅ Free RapidAPI tier |
| **Adzuna** | Large job aggregator | ✅ Free signup |

Not scraped (need a login — check them by hand): **Handshake** (the most important
one for new grads), Wellfound, YC Work at a Startup, Built In Minnesota.
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

Preview it locally with `python notify.py --dry-run`.

### 2. Enable GitHub Actions

**Actions** tab → enable workflows. The workflow runs automatically at 8 AM CST.

---

## ▶️ Run manually

**From GitHub:** Actions tab → "Daily Job Hunt" → "Run workflow"

**Locally:**
```bash
pip install -r requirements.txt
python job_hunter.py                 # all sources
python job_hunter.py linkedin dice   # just some sources (substring of fetch_* names)
python enrich.py --budget 600        # read older postings (summaries / years), 10 min
python build_dashboard.py
python notify.py --dry-run           # preview the morning digest
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
| Scoring weights | `classify_and_score()` in `build_dashboard.py` |

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
