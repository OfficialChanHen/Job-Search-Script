# 🎯 Chan's Job Hunt

A job board for entry-level SWE and tech-adjacent roles in the US, with a game built in to keep the search going:
XP, daily quests, badges, and a hunter village that only real work (applications, LeetCode, DataAnnotation hours)
can feed. Progress syncs between your phone and computer.

- **Site:** Next.js 16 on Vercel (this folder)
- **Sync and sign-in:** Supabase
- **Job data:** a Python scraper that runs every morning on GitHub Actions and commits fresh data, which redeploys the site

## What's where

| Path | What it is |
|---|---|
| `src/app/`, `src/components/` | The site's pages and screens |
| `src/lib/game/` | XP, badges, quests, the village and boss fights. Pure TypeScript with tests |
| `src/lib/sync/` | The offline-first store that syncs to Supabase, and the importer for old backups |
| `public/data/` | Job data written by the scraper every morning. Don't edit by hand |
| `supabase/migrations/` | The database table and the function that writes to it |
| `scraper/` | The Python pipeline: scraping, reading postings, scoring, the morning digest ([README](scraper/README.md)) |
| `sheet-sync/` | The Google Apps Script that adds Applied jobs to your tracker sheet |
| `legacy/` | The old single-page dashboard, kept for reference while features move over ([README](legacy/README.md)) |
| `docs/` | The old GitHub Pages address, now a "moved" page with a progress backup button |
| `public/sprites/` | The game's pixel art, picked from the Ninja Adventure pack by `tools/build_sprites.py` |
| `tools/` | `build_sprites.py`: copies the sprites the game uses and writes their manifest |

## The game

Your hunters are 20 adventurers, one per LeetCode topic: Sir Aldric trains on hash maps, Vex the Spellblade on
graphs, and so on. Solving and reviewing problems in a topic recruits and ranks up its hunter. Hunters hunt the
zones on their own while they have food, and food only comes from real work: applications, solves, reviews,
outreach, cleared quests and DataAnnotation hours. Gold buys gear and buildings; zone bosses are auto-battles.
On the map you can watch them attack, take hits, chop wood and mine stone, rest at the inn, and swing the
weapon their gear level has earned (armor shows as a rim under their feet). Hit markers can be turned off in the
village window.
Zones repeat in harder laps without end, and `src/lib/game/game.test.ts` simulates 300 days of a steady player to
check that progress never stalls or runs away.

Writing and layout follow the rules from Hourelle: status as one sentence, text only where it helps you decide,
one accent colour, coral only for things that need you now. Sprites are from the [Ninja Adventure asset pack](https://pixel-boy.itch.io/ninja-adventure-asset-pack)
by Pixel-boy and AAA (CC0). To change a pick, unzip the pack to `assets/ninja-adventure/` (gitignored), edit
`tools/build_sprites.py`, and run `python3 tools/build_sprites.py`.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # game logic, sync and parity tests
npm run lint
```

Sync needs `.env.local` (copy `.env.example`) with your Supabase project URL and publishable key. Without them the
site still works and saves in that browser only.

To refresh the job data locally: `.venv/bin/python scraper/build_data.py`.

## Deploy (Vercel Hobby, free)

1. **Supabase, one time:** run `supabase/migrations/0001_progress.sql` in the SQL Editor. Under Authentication →
   URL Configuration, set the Site URL to your site's address and add these Redirect URLs:
   `http://localhost:3000/auth/callback` and `https://<your-address>/auth/callback`.
2. **Vercel:** Add New → Project → import this GitHub repo. Leave Root Directory as the repo root; Vercel detects
   Next.js. Before the first deploy, add the environment variables `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. They're baked in at build time, so changing them later needs a redeploy.
3. Every push to `main` deploys, including the scraper's daily data commit.

### Choosing the address

- The project name becomes `https://<project-name>.vercel.app` if nobody has taken it.
- To change it: Project → Settings → Domains → Add, type any free `something.vercel.app` name, and set it as the
  primary domain.
- To use your own domain (like `jobs.chanhen.space`): add it in the same place, then create the DNS record
  Vercel shows you, usually a CNAME to `cname.vercel-dns.com`, at your domain registrar. HTTPS is automatic.
- After picking the address, update it in three places:
  - the Supabase Site URL and Redirect URLs
  - `NEW_APP` in `docs/index.html` (the moved page)
  - `DASHBOARD_URL`: add it as a repository variable (Settings → Secrets and variables → Actions → Variables) so
    the morning digest links to the site

## Moving progress from the old page

The old dashboard saved progress in each browser separately. On every device and browser you used it on:

1. Open the old GitHub Pages address. It now shows the moved page with what that browser saved.
2. Click **💾 Download backup**.
3. In the new site, sign in, click **💾 Import backup** and pick the file.

Imports combine, so importing from several devices (or twice) never double counts. Once every device is
imported, you can turn off GitHub Pages (repo Settings → Pages).
