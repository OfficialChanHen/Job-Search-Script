import type { SheetRow } from "./progress";
import { daysSince, parseSheetDate } from "./time";

export type Outcome = "offer" | "interview" | "rejected" | "noreply" | "pending" | "other";
const POS_RE = /interview|behavio|phone|screen|onsite|on-site|technical|\boa\b|assessment|final|offer|hired|round|recruiter call/i;

/** Read a tracker row's Status column. "Applied" rows older than staleDays count as no reply. */
export function outcomeOf(r: SheetRow, staleDays = 0, now: Date = new Date()): Outcome {
  const s = (r.status || "").toLowerCase();
  if (/offer|hired/.test(s)) return "offer";
  if (POS_RE.test(s)) return "interview";
  if (/reject|declin|not selected|no longer/.test(s)) return "rejected";
  if (/ghost/.test(s)) return "noreply";
  if (/applied|submitted|pending|in review|under review/.test(s) || !s) {
    const iso = parseSheetDate(r.date);
    if (staleDays && iso && daysSince(iso, now) > staleDays) return "noreply";
    return "pending";
  }
  return "other";     // e.g. "Side Gig": not an application
}

export function sheetCounts(rows: SheetRow[], now: Date = new Date()) {
  const c = { interview: 0, offer: 0, rejected: 0, noreply: 0, pending: 0 };
  rows.forEach(r => { const o = outcomeOf(r, 30, now); if (o !== "other") c[o]++; });
  return c;
}
