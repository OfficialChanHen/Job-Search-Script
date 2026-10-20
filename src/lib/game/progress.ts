/* What you've done, as synced rows, and a read-only snapshot of it.
 *
 * Each namespace below is one kind of row in the store. Counters that two
 * devices could bump at once (reviews, outreach per day…) are stored as
 * separate events or derived from the rows they count, never as a number
 * that both devices overwrite.                                            */
import type { Store } from "@/lib/sync/store";
import { REVIEW_GAPS, nextGap } from "./reviews";
import { addDays, localDay, parseSheetDate } from "./time";

export const NS = {
  status: "status",       // jobId → StatusEntry
  solved: "solved",       // problem number → day solved
  rev: "rev",             // problem number → { s: reviews done, due }
  review: "review",       // event id → { n, d }: one finished review
  outreach: "outreach",   // jobId → day you reached out
  followed: "followed",   // jobId or "u:<url>" → { d, how: "done" | "skip" }
  clear: "clear",         // day → 1: all daily quests finished
  badge: "badge",         // badge id → day unlocked
  triage: "triage",       // day → jobs triaged in Quick Play that day
  meta: "meta",           // misc numbers (lastLevel, legacy counters)
  kitStd: "kitstd",       // form field → your usual answer
  kitJob: "kitjob",       // jobId → { why?, you? } your rewrites
  resume: "resume",       // file name → skills found
  da: "da",               // session id → DataAnnotation session
  daRun: "darun",         // "timer" → { run: ms | 0, rate }
  pref: "pref",           // settings that follow you (job type filter, sheet URL)
  synced: "synced",       // jobId → 1: already added to the Google Sheet
  sheet: "sheet",         // "rows" → your sheet's rows (cache, this device only)
  village: "village",     // "state" → VillageState (versioned)
} as const;
export const VERSIONED = [NS.village];
export const LOCAL_ONLY = [NS.sheet];

export type JobStatus = "applied" | "saved" | "hidden";
export interface StatusEntry { s: JobStatus; t: string; ts?: number }
export interface RevEntry { s: number; due: string | null }
export interface Followed { d: string; how: "done" | "skip" }
export interface DASession { d: string; m: number; g: number }
export interface DARun { run: number; rate: string }
export interface SheetRow { date?: string; company?: string; title?: string; location?: string; status?: string; url?: string }
export interface KitJob { why?: string; you?: string }
export interface ResumeEntry { name: string; skills: string[]; chars: number; added: string }

export interface Progress {
  status: Record<string, StatusEntry>;
  solved: Record<string, string>;
  rev: Record<string, RevEntry>;
  reviews: number;
  revDays: Record<string, number>;
  outreach: Record<string, string>;
  outDays: Record<string, number>;
  followed: Record<string, Followed>;
  fuDays: Record<string, number>;
  clears: Record<string, 1>;
  unlocked: Record<string, string>;
  triaged: number;
  triToday: number;
  times: number[];              // hour of day of each application (Early Bird / Night Owl)
  lastLevel: number;
  da: [string, DASession][];
  daRun: DARun;
  sheetRows: SheetRow[];
}

/** Sheet rows dated in these ranges (inclusive) are ignored everywhere: 2026-10-01..19 were filler, not real applications. */
export const IGNORED_SHEET_DAYS: [string, string][] = [["2026-10-01", "2026-10-19"]];
export const isIgnoredSheetRow = (r: SheetRow) => {
  const d = parseSheetDate(r.date);
  return !!d && IGNORED_SHEET_DAYS.some(([a, b]) => d >= a && d <= b);
};

const countBy = (days: string[]) => days.reduce<Record<string, number>>((m, d) => { if (d) m[d] = (m[d] || 0) + 1; return m; }, {});

export function snapshot(store: Store, now: Date = new Date()): Progress {
  const obj = <T,>(ns: string) => Object.fromEntries(store.entries<T>(ns)) as Record<string, T>;
  const status = obj<StatusEntry>(NS.status);
  const reviews = store.entries<{ n?: number; d: string }>(NS.review).map(([, v]) => v);
  const outreach = obj<string>(NS.outreach);
  const followed = obj<Followed>(NS.followed);
  const triage = obj<number>(NS.triage);
  const meta = (k: string) => store.get<number | number[]>(NS.meta, k);
  const today = localDay(now);
  const appliedHours = Object.values(status).filter(v => v.s === "applied" && v.ts).map(v => new Date(v.ts!).getHours());
  return {
    status,
    solved: obj<string>(NS.solved),
    rev: obj<RevEntry>(NS.rev),
    reviews: reviews.length,
    revDays: countBy(reviews.map(r => r.d)),
    outreach,
    outDays: countBy(Object.values(outreach)),
    followed,
    fuDays: countBy(Object.values(followed).filter(f => f.how === "done").map(f => f.d)),
    clears: obj<1>(NS.clear),
    unlocked: obj<string>(NS.badge),
    triaged: Object.values(triage).reduce((a, n) => a + n, 0) + ((meta("legacyTriaged") as number) || 0),
    triToday: triage[today] || 0,
    times: [...(((meta("legacyTimes") as number[]) || [])), ...appliedHours],
    lastLevel: (meta("lastLevel") as number) || 1,
    da: store.entries<DASession>(NS.da),
    daRun: store.get<DARun>(NS.daRun, "timer") ?? { run: 0, rate: "" },
    sheetRows: ((store.get<{ rows: SheetRow[] }>(NS.sheet, "rows")?.rows) ?? []).filter(r => !isIgnoredSheetRow(r)),
  };
}

/* ── changes ─────────────────────────────────────────────────── */
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function setStatus(store: Store, jobId: string, s: JobStatus | "", now: Date = new Date()) {
  const prev = store.get<StatusEntry>(NS.status, jobId);
  if (!s) return store.delete(NS.status, jobId);
  if (s === "applied" && prev?.s === "applied") return;
  store.set(NS.status, jobId, { s, t: localDay(now), ...(s === "applied" ? { ts: now.getTime() } : {}) });
}

/** Tick or untick a LeetCode problem. Solving schedules its first spaced review. */
export function toggleSolved(store: Store, n: number, now: Date = new Date()): boolean {
  const k = String(n);
  if (store.get(NS.solved, k)) {
    store.batch(() => { store.delete(NS.solved, k); store.delete(NS.rev, k); });
    return false;
  }
  const d = localDay(now);
  store.batch(() => { store.set(NS.solved, k, d); store.set(NS.rev, k, { s: 0, due: addDays(d, REVIEW_GAPS[0]) }); });
  return true;
}

export function markReviewed(store: Store, n: number, now: Date = new Date()) {
  const k = String(n), r = store.get<RevEntry>(NS.rev, k) ?? { s: 0, due: null };
  const s = r.s + 1, d = localDay(now);
  store.batch(() => {
    store.set(NS.rev, k, { s, due: addDays(d, nextGap(s)) });
    store.set(NS.review, newId(), { n, d });
  });
}

export function toggleOutreach(store: Store, jobId: string, now: Date = new Date()): boolean {
  if (store.get(NS.outreach, jobId)) { store.delete(NS.outreach, jobId); return false; }
  store.set(NS.outreach, jobId, localDay(now));
  return true;
}

export function markFollowed(store: Store, key: string, how: Followed["how"], now: Date = new Date()) {
  store.set(NS.followed, key, { d: localDay(now), how });
}

export function addTriage(store: Store, now: Date = new Date()) {
  const d = localDay(now);
  store.set(NS.triage, d, (store.get<number>(NS.triage, d) || 0) + 1);
}

export function addDASession(store: Store, s: DASession) { store.set(NS.da, newId(), s); }
