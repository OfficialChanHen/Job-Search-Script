/* Applications 7+ days old with no reply yet: time for a polite nudge. */
import type { Job } from "@/lib/data/types";
import type { Progress } from "./progress";
import { outcomeOf } from "./sheet";
import { daysSince, parseSheetDate } from "./time";

export const FOLLOW_UP_DAYS = 7;
export interface FollowUp { key: string; company: string; title: string; url: string; date: string; days: number }

export function followUps(p: Progress, byId: Map<string, Job>, now = new Date()): FollowUp[] {
  const out: FollowUp[] = [], urls = new Set<string>();
  const sheetByUrl = new Map(p.sheetRows.filter(r => r.url).map(r => [r.url!.trim(), r]));
  Object.entries(p.status).forEach(([id, v]) => {
    if (v.s !== "applied" || p.followed[id] || daysSince(v.t, now) < FOLLOW_UP_DAYS) return;
    const j = byId.get(id);
    if (!j) return;
    urls.add(j.url);
    const sr = sheetByUrl.get(j.url);
    if (sr && outcomeOf(sr, 0, now) !== "pending") return;     // the sheet already says rejected / interviewing
    out.push({ key: id, company: j.company, title: j.title, url: j.url, date: v.t, days: daysSince(v.t, now) });
  });
  p.sheetRows.forEach(r => {
    const iso = parseSheetDate(r.date);
    if (!iso || !r.url || urls.has(r.url) || !/^https?:/i.test(r.url)) return;
    const key = "u:" + r.url;
    if (p.followed[key] || outcomeOf(r, 0, now) !== "pending") return;
    const d = daysSince(iso, now);
    if (d < FOLLOW_UP_DAYS || d > 45) return;
    out.push({ key, company: r.company || "", title: r.title || "", url: r.url, date: iso, days: d });
  });
  return out.sort((a, b) => b.days - a.days);
}

export const followMsg = (f: FollowUp) =>
  `Hi [Name], I applied for the ${f.title} role at ${f.company} on ${f.date} and wanted to reiterate my interest. ` +
  `My background in React/TypeScript, Python and SQL lines up well with the role, and I'd be glad to share more. ` +
  `Is there anything else I can provide? Thanks, Chan`;

export const outreachMsg = (j: Job) =>
  `Hi [Name], I'm Chan, a UW–Madison CS + Data Science grad. I'm applying for the ${j.title} role at ${j.company} ` +
  `and would love to hear what the team is like. Would you be open to a quick chat, or referring me? Thanks so much!`;
export const liSearch = (kw: string) => "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(kw);
