/* XP, levels, badges and daily quests. XP is derived from real progress, so
   un-marking something takes its XP back: there's nothing to farm.        */
import type { Job } from "@/lib/data/types";
import type { Progress } from "./progress";
import { sheetCounts } from "./sheet";
import { localDay } from "./time";

export const TITLES = ["Resume Rookie", "Cover Letter Cadet", "Networking Novice", "Recruiter Whisperer",
  "OA Survivor", "Phone-Screen Pro", "Onsite Warrior", "Offer Magnet", "Negotiation Ninja", "Final Boss of Job Hunting"];
export const levelStart = (n: number) => 50 * n * (n - 1);   // L2 = 100 XP, L3 = 300, L4 = 600…
export function levelFor(xp: number) { let n = 1; while (xp >= levelStart(n + 1)) n++; return n; }
export const titleFor = (n: number) =>
  TITLES[Math.min(n, TITLES.length) - 1] + (n > TITLES.length ? " " + "★".repeat(Math.min(n - TITLES.length, 5)) : "");

/** Village numbers some badges look at (passed in to keep this module independent). */
export interface VillageFacts { zones: number; raidWins: number; bldMax: number; hunters: number }

export interface Stats {
  today: string;
  applied: number; saved: number; solved: number;
  appliedToday: number; solvedToday: number; triagedToday: number;
  direct: number; onsite: number; cats: number;
  clears: number; outreach: number; followed: number; reviews: number;
  streak: number; interviews: number; offers: number;
  lcToday: number; netToday: number; daHours: number;
  triaged: number; times: number[];
  zones: number; raidWins: number; bldMax: number; hunters: number;
  quests: [string, number, number][];
  xp: number;
}

export type Badge = [id: string, icon: string, name: string, desc: string, test: (s: Stats) => boolean];
export const BADGES: Badge[] = [
  ["first",   "🩸", "First Blood",     "Submit your first application",       s => s.applied >= 1],
  ["ten",     "🔟", "Double Digits",   "10 applications",                     s => s.applied >= 10],
  ["fifty",   "🚀", "Half-Century",    "50 applications",                     s => s.applied >= 50],
  ["hundred", "💯", "Centurion",       "100 applications",                    s => s.applied >= 100],
  ["direct",  "🔗", "Straight to the Source", "Apply to 5 jobs on the company's own site", s => s.direct >= 5],
  ["grass",   "🏢", "Touch Grass",     "Apply to 5 in-person jobs",           s => s.onsite >= 5],
  ["explore", "🧭", "Explorer",        "Apply across 4 role categories",      s => s.cats >= 4],
  ["streak3", "🔥", "On Fire",         "3-day activity streak",               s => s.streak >= 3],
  ["streak7", "🌋", "Unstoppable",     "7-day activity streak",               s => s.streak >= 7],
  ["lc10",    "🧠", "Grinder",         "Solve 10 LeetCode problems",          s => s.solved >= 10],
  ["lc50",    "🐉", "LeetCode Dragon", "Solve 50 LeetCode problems",          s => s.solved >= 50],
  ["speed",   "⚡", "Speed Runner",    "Triage 25 jobs in Quick Play",        s => s.triaged >= 25],
  ["clear",   "🎯", "Quest Clear",     "Finish all daily quests once",        s => s.clears >= 1],
  ["early",   "🌅", "Early Bird",      "Apply before 9 AM",                   s => s.times.some(h => h < 9)],
  ["owl",     "🦉", "Night Owl",       "Apply after 11 PM",                   s => s.times.some(h => h >= 23)],
  ["connect", "🤝", "Connector",       "Reach out to 5 people for referrals", s => s.outreach >= 5],
  ["persist", "📬", "Persistent",      "Follow up on 5 applications",         s => s.followed >= 5],
  ["spaced",  "🔁", "Spaced Out",      "Finish 10 LeetCode reviews",          s => s.reviews >= 10],
  ["boss",    "🎤", "Boss Battle",     "Land an interview (from your sheet)", s => s.interviews >= 1],
  ["offer",   "👑", "Offer!",          "Get an offer (from your sheet)",      s => s.offers >= 1],
  ["squad",   "🧑‍🤝‍🧑", "Full Roster",     "Recruit 10 hunters (LeetCode topics)", s => s.hunters >= 10],
  ["deep",    "🗺️", "Deep Hunter",     "Unlock hunting zone 4",               s => s.zones >= 4],
  ["chief",   "🏰", "Village Chief",   "Upgrade a building to level 3",       s => s.bldMax >= 3],
  ["raid",    "🐲", "Raid Slayer",     "Defeat a weekly world boss",          s => s.raidWins >= 1],
  ["contract","💼", "Contractor",      "Log 10 hours of DataAnnotation",      s => s.daHours >= 10],
];

export function gameStats(p: Progress, jobsById: Map<string, Job>, v: VillageFacts, now: Date = new Date()): Stats {
  const today = localDay(now);
  const entries = Object.entries(p.status);
  const appliedIds = entries.filter(([, x]) => x.s === "applied").map(([k]) => k);
  const appliedJobs = appliedIds.map(id => jobsById.get(id)).filter((j): j is Job => !!j);
  const solvedDays = Object.values(p.solved);
  // streak: consecutive days, ending today or yesterday, with real activity
  const active = new Set([...entries.filter(([, x]) => x.s === "applied").map(([, x]) => x.t), ...solvedDays,
    ...Object.keys(p.outDays), ...Object.keys(p.fuDays), ...Object.keys(p.revDays)]);
  let streak = 0;
  const d = new Date(now);
  if (!active.has(localDay(d))) d.setDate(d.getDate() - 1);
  while (active.has(localDay(d))) { streak++; d.setDate(d.getDate() - 1); }
  const sh = sheetCounts(p.sheetRows, now);
  const daHours = p.da.reduce((a, [, x]) => a + x.m, 0) / 60;
  const followed = Object.values(p.followed).filter(f => f.how === "done").length;
  const s: Stats = {
    today,
    applied: appliedIds.length,
    saved: entries.filter(([, x]) => x.s === "saved").length,
    solved: solvedDays.length,
    appliedToday: entries.filter(([, x]) => x.s === "applied" && x.t === today).length,
    solvedToday: solvedDays.filter(x => x === today).length,
    triagedToday: p.triToday,
    direct: appliedJobs.filter(j => j.direct).length,
    onsite: appliedJobs.filter(j => j.mode === "onsite").length,
    cats: new Set(appliedJobs.map(j => j.cat)).size,
    clears: Object.keys(p.clears).length,
    outreach: Object.keys(p.outreach).length,
    followed,
    reviews: p.reviews,
    streak,
    interviews: sh.interview + sh.offer,
    offers: sh.offer,
    lcToday: solvedDays.filter(x => x === today).length + (p.revDays[today] || 0),
    netToday: (p.outDays[today] || 0) + (p.fuDays[today] || 0),
    daHours,
    triaged: p.triaged,
    times: p.times,
    ...v,
    quests: [],
    xp: 0,
  };
  s.quests = [
    ["Apply to 3 jobs", s.appliedToday, 3],
    ["Solve or review 2 LeetCode problems", s.lcToday, 2],
    ["Reach out or follow up once", s.netToday, 1],
    ["Triage 10 jobs in Quick Play", s.triagedToday, 10],
  ];
  s.xp = s.applied * 50 + s.saved * 10 + s.solved * 20 + s.triaged * 2 +
         s.clears * 50 + Object.keys(p.unlocked).length * 25 +
         s.outreach * 30 + s.followed * 15 + s.reviews * 10 +
         s.interviews * 200 + s.offers * 1000 + Math.floor(daHours) * 10;
  return s;
}
