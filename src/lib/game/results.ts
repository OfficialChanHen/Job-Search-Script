/* Response rates from the tracker sheet's Status column. */
import type { SheetRow } from "./progress";
import { outcomeOf, type Outcome } from "./sheet";
import { parseSheetDate } from "./time";

export function channelOf(app?: string) {
  const a = (app || "").toLowerCase();
  if (!a) return "Not recorded";
  if (a.includes("simplify")) return "Simplify";
  if (a.includes("handshake")) return "Handshake";
  if (a.includes("linkedin")) return "LinkedIn";
  if (a.includes("indeed")) return "Indeed";
  if (a.includes("ziprecruit")) return "ZipRecruiter";
  if (a.includes("dice")) return "Dice";
  if (/greenhouse|lever\.co|ashbyhq|myworkdayjobs|icims|smartrecruiters|oraclecloud|workable|jobvite/.test(a)) return "Company site (ATS)";
  if (a.includes("company")) return "Company website";
  if (/^https?:/.test(a)) return "Other link";
  return "Other";
}
export function placeOf(loc?: string) {
  const l = (loc || "").toLowerCase();
  if (!l) return "Not recorded";
  if (/\bmn\b|minnesota|minneapolis|st\.? ?paul|shakopee|burnsville|eden prairie|chanh|plym|mounds view|minnetonka|twin cities|hopkins|eagan|bloomington/.test(l)) return "Minnesota";
  if (/remote|anywhere|worldwide/.test(l)) return "Remote";
  return "Elsewhere in US";
}
export function roleOf(t?: string) {
  const s = (t || "").toLowerCase();
  if (/data|analyst|analytics|bi\b/.test(s)) return "Data / analyst";
  if (/front|web|ui\b|react|design/.test(s)) return "Frontend / web";
  if (/\bqa\b|quality|test/.test(s)) return "QA / test";
  if (/ai\b|machine learning|ml\b/.test(s)) return "AI / ML";
  if (/engineer|developer|programmer|software|swe|sde/.test(s)) return "SWE / general";
  return "Other";
}

export type Scored = SheetRow & { o: Exclude<Outcome, "other"> };
export function sheetStats(rows: SheetRow[], now = new Date()) {
  const scored = rows.map(r => ({ ...r, o: outcomeOf(r, 30, now) })).filter((r): r is Scored => r.o !== "other");
  const c = { interview: 0, offer: 0, rejected: 0, noreply: 0, pending: 0 };
  scored.forEach(r => c[r.o]++);
  return { rows: scored, c, positive: c.interview + c.offer };
}
export interface Group { n: number; pos: number; decided: number }
export function breakdown(rows: Scored[], fn: (r: Scored) => string): [string, Group][] {
  const g: Record<string, Group> = {};
  rows.forEach(r => {
    const k = fn(r), x = (g[k] ??= { n: 0, pos: 0, decided: 0 });
    x.n++;
    if (r.o === "interview" || r.o === "offer") x.pos++;
    if (r.o !== "pending") x.decided++;
  });
  return Object.entries(g).sort((a, b) => b[1].n - a[1].n);
}
export const byMonth = (rows: Scored[]) => breakdown(rows, r => (parseSheetDate(r.date) || "Undated").slice(0, 7)).sort((a, b) => a[0].localeCompare(b[0]));
