# 🎯 Job Hunter — Chan Hen

Automated daily job scraper for junior software engineer roles.  
Runs every morning at **8:00 AM CST** via GitHub Actions.  
Results are committed back to this repo as `data/jobs_YYYY-MM-DD.csv`, and an
interactive **dashboard** is rebuilt at `docs/index.html` (serve it with GitHub Pages).

**Priority: in-person US roles first, then hybrid, then remote.**

---

## 📊 The Dashboard

Every run rebuilds `docs/index.html` — a single self-contained page with **all
jobs ever collected**, scored against your resume skills:

- Tabs: **New today / Minnesota / In-person / Hybrid / Remote / Junior / Internships**
- Search, source filter, best-match sorting, one-click **Apply ↗** links
- Track progress per job: **★ Save / ✓ Applied / 🚫 Hide** (stored in your browser)
- **Export tracked (CSV)** button downloads your Applied + Saved list

**One-time setup:** repo → Settings → Pages → Source: *Deploy from a branch* →
Branch `main`, folder `/docs`. Your dashboard then lives at
`https://officialchanhen.github.io/Job-Search-Script/` and refreshes daily.

To rebuild locally: `python build_dashboard.py` then open `docs/index.html`.

---

## 📦 What it scrapes

| Source | Type | Key Required? |
|---|---|---|
| **Greenhouse boards** | Company career pages (Stripe, Databricks, Axon, SpaceX, +25 more) | ❌ Free |
| **Ashby boards** | Company career pages (OpenAI, Ramp, Notion, Cursor, …) | ❌ Free |
| **Lever boards** | Company career pages (Palantir, Zoox, …) | ❌ Free |
| **GitHub/NewGrad** | SimplifyJobs new-grad table | ❌ Free |
| **GitHub/Internship** | SimplifyJobs internships | ❌ Free |
| **RemoteOK** | Remote tech jobs | ❌ Free |
| **Remotive** | Remote dev jobs | ❌ Free |
| **Arbeitnow** | Remote / relocation jobs | ❌ Free |
| **Himalayas** | Startup remote jobs | ❌ Free |
| **WeWorkRemotely** | Remote dev RSS | ❌ Free |
| **Jobicy** | Remote jobs API | ❌ Free |
| **Adzuna** | Large job aggregator | ✅ Free signup |
| **Eventbrite** | Tech networking events | ✅ Free signup |

All results are filtered to **US-based or US-open remote** locations and scored
against your resume skills (React, TypeScript, Next.js, Python, React Native, etc.).
Company-board results are additionally filtered to junior-friendly titles.

---

## 🚀 Setup (5 minutes)

### 1. Fork or clone this repo
```bash
git clone https://github.com/YOUR_USERNAME/job-hunter.git
cd job-hunter
```

### 2. Add optional free API keys (unlocks 2 more sources)

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Where to get it |
|---|---|
| `ADZUNA_APP_ID` | [developer.adzuna.com](https://developer.adzuna.com/) → free account |
| `ADZUNA_APP_KEY` | Same page as above |
| `EVENTBRITE_KEY` | [eventbrite.com/platform/api](https://www.eventbrite.com/platform/api) → free account |

> Both take under 2 minutes to sign up for. Adzuna gives 250 free requests/month. Eventbrite is unlimited.

### 3. Enable GitHub Actions

Go to **Actions** tab → click **"I understand my workflows, go ahead and enable them"**

That's it. The workflow runs automatically at 8 AM CST every day.

---

## ▶️ Run manually

**From GitHub:** Actions tab → "Daily Job Hunt" → "Run workflow"

**Locally:**
```bash
pip install -r requirements.txt

# Optional: set API keys
export ADZUNA_APP_ID=your_id
export ADZUNA_APP_KEY=your_key
export EVENTBRITE_KEY=your_key

python job_hunter.py
```

---

## 📁 Output files

```
data/
  seen_jobs.json          ← tracks all seen IDs (prevents duplicates across days)
  jobs_2026-05-06.csv     ← today's new listings
  jobs_2026-05-07.csv     ← tomorrow's new listings
  ...

logs/
  job_hunter_2026-05-06.log   ← full debug log for each run
```

### CSV columns

| Column | Description |
|---|---|
| `id` | Stable 12-char hash (MD5 of title+company+url) |
| `date_found` | Date this listing was first seen |
| `type` | `job` or `networking` |
| `source` | Which site it came from |
| `title` | Job title or event name |
| `company` | Company or group name |
| `location` | Remote / city / state |
| `url` | Direct link to apply or RSVP |
| `posted` | Date the listing was posted |
| `tags` | Tech stack tags |
| `work_mode` | `onsite` / `hybrid` / `remote` (onsite sorts first) |

---

## 🔧 Customization

Open `job_hunter.py` and edit these at the top:

```python
# Add or remove skills to tune the relevance filter
MY_SKILLS = {
    "react", "typescript", "next.js", ...
}

# Change what gets searched
SEARCH_TERMS = [
    "junior software engineer",
    "react native developer",
    ...
]

# Add/remove companies whose career boards get scraped directly
GREENHOUSE_BOARDS = ["stripe", "databricks", ...]
LEVER_BOARDS      = ["palantir", ...]
ASHBY_BOARDS      = ["openai", "ramp", ...]
```

> Find a company's board slug from its careers-page URL:
> `boards.greenhouse.io/<slug>`, `jobs.lever.co/<slug>`, or `jobs.ashbyhq.com/<slug>`.

Change the cron schedule in `.github/workflows/daily_jobs.yml`:
```yaml
- cron: "0 14 * * *"   # 8 AM CST — change to your preferred time
```

---

## 💡 Tips

- **Bookmark the Actions tab** — you'll see a green ✓ or red ✗ each morning
- **Download the CSV artifact** from the Actions run summary without pulling the repo
- Open CSVs in Excel / Google Sheets and use filters to sort by `source` or `tags`
- The `seen_jobs.json` file grows over time — it's what prevents the same job appearing twice. Don't delete it.
