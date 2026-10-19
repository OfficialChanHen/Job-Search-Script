# Legacy dashboard (reference only)

This is the old single-page dashboard that GitHub Pages served from `docs/index.html` until October 2026. The
live site is now the Next.js app at the repo root. The GitHub Pages address now shows a "moved" page that lets
each browser download its saved progress for the new app's **💾 Import backup**.

Kept here so features can be ported faithfully:

- `build_dashboard.py`: the whole old page. Python builds one HTML file with all CSS and JavaScript inline
  (`HTML_TEMPLATE`). The game logic, quests, village, Quick Play, apply kit, follow-ups, results and resume
  matching are all in that template.
- The new app's tests compare against it: `src/lib/game/__fixtures__/legacy-expected.json` holds numbers produced by
  running this page.

## Build it locally to compare

```bash
.venv/bin/python legacy/build_dashboard.py   # writes legacy/index.html (gitignored)
python3 -m http.server 8000 -d legacy        # open http://localhost:8000
```

It reads the same `scraper/data/` the app's data comes from, so both show the same jobs. Its saved progress
lives in that browser at that address, separate from the app.

Every version the daily run built is also in git history as `docs/index.html`.

---

## What the old dashboard did

Every run rebuilds `docs/index.html` — a single self-contained page with **all
jobs ever collected** (history is re-filtered with today's rules), scored against
your resume skills, entry-level signals, full-time, in-person and whether there's a direct company link.
Location isn't ranked — anywhere in the US counts the same.

- **Sticky bar** (stays on screen while you scroll): your LinkedIn / GitHub / portfolio / Hourelle links
  (tap to copy, ↗ to open), **✓ applied today · in the last hour · per hour · minutes each**, the tabs
  (with counts) and the search + filters. Shortcuts: **/** search, **t** back to top; the list loads
  more as you scroll and a ↑ button takes you back up.
- **⏱ Pace panel** (click the applied-today pill): applications today, last hour, per hour, per minute,
  average time per application, an hour-by-hour chart for today and a 7-day chart.
- **🔗 Direct links:** **Apply ↗** goes to the posting on the company's own site whenever it can be
  found — also for LinkedIn / Dice / Adzuna / Jobicy jobs (matched against ~23k direct ATS postings
  and searched on the company's Greenhouse / Lever / Ashby / Workday / SmartRecruiters board), with a
  small "via LinkedIn" link underneath. When no direct posting is found: **🔎 Find on company site**
  searches for that exact title on the company's career site.
- **🏪 Local part-time** tab: part-time jobs around Shakopee at **tech-related employers** — Best Buy /
  Geek Squad, Apple, Micro Center, Verizon / T-Mobile / AT&T / Xfinity, GameStop, Amazon, Seagate, … —
  where the role itself can be anything (sales associate, Apple Specialist, warehouse), plus
  tech-flavoured part-time roles anywhere nearby. No hard distance cutoff: each job shows the drive
  from Shakopee (miles, gas + wear per shift, round-trip minutes) and, when pay is listed, **$/hr after
  driving** = (pay × 4-hr shift − driving cost) ÷ (4 hrs + drive time). The tab is sorted by that;
  jobs that drop under ~$11/hr after driving (or are 45+ miles away) are left out. Assumptions live at
  the top of `local_parttime.py` (cost per mile, shift length, average speed).
- **🏰 Hunter village** (an idle game under the progress card, in the spirit of Evil Hunter Tycoon). It only
  runs on real work:
  - **Hunters are LeetCode topics.** Solving any problem in a topic recruits that hunter (🕸️ Graph Weaver,
    🧩 DP Sage, 🗄️ SQL Oracle…). Every solve and every spaced review adds training: rank II at 3, III at 8,
    IV at 16. Topics share traits (Arrays, Structures, Recursion…), so covering more interview patterns
    makes the whole party stronger. Each hunter's card lists its topic's problems with solve checkboxes.
  - **Hunters on duty hunt by themselves**, even with the tab closed, but they eat. **Food** comes from
    applications (4 hours each), solves (2), reviews (1), outreach and follow-ups (2), cleared daily quests (6)
    and DataAnnotation hours (1). Clearing every daily quest is about a full day of hunting. With no food they
    sleep in town.
  - **Gold** comes from hunting and DataAnnotation. It buys gear (weapon and armor levels) and buildings:
    Inn (more hunters on duty), Kitchen (food lasts longer), Forge (higher gear cap), Market (more gold).
  - **Zones** are themed after hiring obstacles (Application Fields, Ghostwood, OA Caverns…). Each ends in a
    boss that plays out on its own. Party, front and back rows, and the boss's quirk decide it
    (armored bosses are weak to crits, slam bosses need HP). A fight costs 1 hour of food.
  - **Get stronger with real work** lists the solves that would raise your boss win chance most, with the
    problem link and how much each one helps.
  - **Weekly world boss**: only applications, solves, reviews, outreach, quests and DataAnnotation damage it.
  - **💼 DataAnnotation timer** in the sticky bar. Start and stop it, or add minutes by hand. Every hour pays
    gold (an hour of hunting in your best zone) and food. Add your hourly rate to see the week's pay.
  - Like XP, food is derived from what you've marked, so un-marking something takes its food back. Everything
    is stored in this browser's localStorage.
- Tabs: **New today / All / Direct link / Local part-time / In-person / Hybrid / Remote / Entry-level / SWE / Tech-adjacent / Saved / Applied / Hidden**
- Filters: **job type** (defaults to Full-time), **role** (SWE, Frontend, Data/BI, Solutions/FDE, QA, Cloud, IT…), source, sort
- Every card shows **Full-time / Contract / Part-time**, work mode, role category, stated experience,
  and a **⚠ check grad window** flag on class-of-2026/2027 new-grad postings
- **📄 Summary** on each job, read from the full posting: what the role is, what you'd do, what
  they want, pay, tech stack, and required years — plus a **company summary** (the posting's
  "About us", else Wikipedia)
- **📄 My resumes** (toolbar): drag & drop your resume PDFs into the dashboard. They're read
  **in your browser** and only the list of skills found is kept there — never uploaded, never
  committed. Each job then shows a **📄 best resume · 6/8** chip (how many of the posting's skills
  it covers) and, in its Summary, how every resume compares plus the skills none of them mention.
- **🧠 LeetCode prep** on each job: what the interview usually tests for that role (and company,
  where there's a well-known pattern) plus 6 problems chosen **for that job** — from ~175 problems
  in 20 topic pools, weighted by what the posting emphasizes (routing/logistics → graphs,
  real-time → heaps, databases → SQL, React → JS…), so different jobs get different lists
- **One company at a time:** browsing tabs hide companies you applied to in the last 6 months
  (✓ Applied marks + your sheet) and show at most the 2 best-matching jobs from each other company
- **🎒 Apply kit** on each job: knockout checks read from the full posting (graduation year,
  current-student only, clearance, citizenship, master's/PhD, cover letter, 2+ years), which
  resume to send, your usual form answers with copy buttons (saved in your browser only), and
  "Why us?" / "About you" drafts to rewrite in your own words, with a check for phrases that
  read as generated. You still open the posting and press submit yourself.
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
- **Morning digest** (optional): the day's top 10 new matches — full-time and direct company links first — plus
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
  It plays whatever tab + filters you have selected, so pick *Direct link* or *Full-time · SWE* first.
- **🏆 20 badges** — First Blood, Straight to the Source (5 applications on company sites), Touch Grass (in-person), Connector, Persistent,
  Grinder, Spaced Out, Boss Battle (first interview), Offer!…

Progress lives in your browser (same as Applied/Saved marks); applying through Quick Play still
auto-fills your Google Sheet.

**One-time setup:** repo → Settings → Pages → Source: *Deploy from a branch* →
Branch `main`, folder `/docs`. Your dashboard then lives at
`https://officialchanhen.github.io/Job-Search-Script/` and refreshes daily.

To rebuild locally: `python build_dashboard.py` then open `docs/index.html`.
