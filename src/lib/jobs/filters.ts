/* Which jobs show in which tab, and the one-company-at-a-time rule. */
import type { Job } from "@/lib/data/types";
import type { StatusEntry, SheetRow } from "@/lib/game/progress";
import { outcomeOf } from "@/lib/game/sheet";
import { daysSince, parseSheetDate } from "@/lib/game/time";

export const TABS: [string, string][] = [
  ["new", "New today"], ["all", "All jobs"], ["direct", "Direct link"], ["parttime", "Local part-time"],
  ["onsite", "In person"], ["hybrid", "Hybrid"], ["remote", "Remote"], ["junior", "Entry-level"],
  ["swe", "SWE"], ["adjacent", "Tech-adjacent"], ["saved", "Saved"], ["applied", "Applied"], ["hidden", "Hidden"],
];
export const JOB_TYPES: [string, string][] = [
  ["Full-time", "Full-time"], ["", "All job types"], ["Contract", "Contract"], ["Part-time", "Part-time"],
  ["Temporary", "Temporary"], ["?", "Unspecified"],
];

export function matchesTab(j: Job, tab: string, status: Record<string, StatusEntry>, latest: string): boolean {
  const s = status[j.id]?.s || "";
  if (tab === "hidden") return s === "hidden";
  if (s === "hidden") return false;
  if (j.closed && tab !== "saved" && tab !== "applied") return false;   // closed postings stay only where you track them
  if (tab === "parttime") return j.type === "parttime";
  if (j.type === "parttime" && tab !== "saved" && tab !== "applied") return false;
  switch (tab) {
    case "new": return j.date === latest;
    case "direct": return !!j.direct;
    case "onsite": return j.mode === "onsite";
    case "hybrid": return j.mode === "hybrid";
    case "remote": return j.mode === "remote";
    case "junior": return j.junior;
    case "swe": return j.swe;
    case "adjacent": return !j.swe;
    case "saved": return s === "saved";
    case "applied": return s === "applied";
    default: return true;
  }
}

export interface Filters { query: string; source: string; cat: string; jobType: string }
export function passesFilters(j: Job, f: Filters, tab: string): boolean {
  const q = f.query.toLowerCase();
  return (!f.source || j.source === f.source) &&
    (!f.cat || j.cat === f.cat) &&
    (!f.jobType || tab === "parttime" || j.type === "parttime" || (f.jobType === "?" ? !j.jobType : j.jobType === f.jobType)) &&
    (!q || `${j.title} ${j.company} ${j.location} ${j.catLabel} ${j.chips.join(" ")}`.toLowerCase().includes(q));
}

/* Browsing tabs skip companies you applied to in the last 6 months (your ✓ Applied
   marks and your sheet), and show at most the 2 best listings per company. */
export const COOLDOWN_DAYS = 182, PER_COMPANY = 2;
const CO_SUFFIX = /\b(inc|llc|l\.l\.c|ltd|corp|corporation|co|company|group|holdings|plc|usa|us|the|technologies|technology|labs)\b\.?/gi;
export const coKey = (name: string) => (name || "").toLowerCase().replace(CO_SUFFIX, " ").replace(/[^a-z0-9]+/g, " ").trim();

export function recentlyApplied(status: Record<string, StatusEntry>, byId: Map<string, Job>, rows: SheetRow[], now = new Date()) {
  const last: Record<string, string> = {};
  const note = (co: string | undefined, iso: string) => { const k = coKey(co || ""); if (k && iso && (!last[k] || iso > last[k])) last[k] = iso; };
  Object.entries(status).forEach(([id, v]) => { const j = byId.get(id); if (v.s === "applied" && j) note(j.company, v.t); });
  rows.forEach(r => { if (outcomeOf(r, 0, now) !== "other") note(r.company, parseSheetDate(r.date)); });
  Object.keys(last).forEach(k => { if (daysSince(last[k], now) > COOLDOWN_DAYS) delete last[k]; });
  return last;
}

export function onePerCompany(rows: Job[], tab: string, applied: Record<string, string>) {
  if (["saved", "applied", "hidden"].includes(tab)) return { rows, cooled: 0, capped: 0 };
  const seen: Record<string, number> = {};
  let cooled = 0, capped = 0;
  const best = [...rows].sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  const keep = new Set(best.filter(j => {
    const k = coKey(j.company);
    if (!k) return true;
    if (applied[k]) { cooled++; return false; }
    seen[k] = (seen[k] || 0) + 1;
    if (seen[k] > PER_COMPANY) { capped++; return false; }
    return true;
  }));
  return { rows: rows.filter(j => keep.has(j)), cooled, capped };
}
