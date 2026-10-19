/* Import a backup from the old GitHub Pages dashboard (💾 Back up progress).
 *
 * The old page kept everything in a few localStorage blobs. Here each tracked
 * thing becomes its own row. Old per-day counters that can't be split back
 * into events (reviews, Quick Play triage) are kept as one-off rows so XP
 * and badges come out the same.                                          */
import type { Store } from "./store";
import { NS, type DASession, type Followed, type KitJob, type RevEntry, type StatusEntry } from "@/lib/game/progress";
import { normalize, type VillageState } from "@/lib/game/village/engine";

interface LegacyGame {
  solved?: Record<string, string>;
  rev?: Record<string, RevEntry>;
  reviews?: number;
  revDays?: Record<string, number>;
  outreach?: Record<string, string>;
  followed?: Record<string, Followed>;
  clears?: Record<string, 1>;
  unlocked?: Record<string, string>;
  triaged?: number; triDay?: string; triToday?: number;
  times?: number[];
  lastLevel?: number;
  sheet?: { rows?: unknown[]; at?: number };
  village?: Partial<VillageState> & { sel?: string };
  da?: { sess?: DASession[]; run?: number; rate?: string };
}

export interface ImportSummary { applied: number; saved: number; hidden: number; solved: number; reviews: number; badges: number; daSessions: number; village: boolean }

export function parseBackup(text: string): Record<string, string> {
  const j = JSON.parse(text);
  if (j?.app !== "chan-job-hunt" || typeof j.data !== "object") throw new Error("That file isn't a job-hunt backup");
  return j.data;
}

export function importLegacy(store: Store, data: Record<string, string>): ImportSummary {
  const read = <T,>(k: string): T | undefined => { try { return data[k] ? JSON.parse(data[k]) as T : undefined; } catch { return undefined; } };
  const status = read<Record<string, StatusEntry>>("chan-job-status-v1") ?? {};
  const game = read<LegacyGame>("chan-job-game-v1") ?? {};
  const kit = read<{ std?: Record<string, string>; jobs?: Record<string, KitJob> }>("chan-applykit-v1") ?? {};
  const resumes = read<{ name: string; skills: string[]; chars: number; added: string }[]>("chan-resumes-v1") ?? [];
  const synced = read<Record<string, 1>>("chan-sheet-synced-v1") ?? {};
  const sum: ImportSummary = { applied: 0, saved: 0, hidden: 0, solved: 0, reviews: 0, badges: 0, daSessions: 0, village: false };
  const keep = <T,>(ns: string, m: Record<string, T> | undefined) => Object.entries(m ?? {}).forEach(([k, v]) => store.set(ns, k, v));

  store.batch(() => {
    Object.entries(status).forEach(([id, v]) => {
      if (!v?.s) return;
      store.set(NS.status, id, v);
      if (v.s === "applied") sum.applied++; else if (v.s === "saved") sum.saved++; else sum.hidden++;
    });
    keep(NS.solved, game.solved); sum.solved = Object.keys(game.solved ?? {}).length;
    keep(NS.rev, game.rev);
    // reviews: one event per counted review, dated where the old page knew the day
    let n = 0;
    Object.entries(game.revDays ?? {}).forEach(([d, c]) => { for (let i = 0; i < c; i++) store.set(NS.review, `legacy-${d}-${i}`, { d }); n += c; });
    for (let i = n; i < (game.reviews ?? 0); i++) store.set(NS.review, `legacy-undated-${i}`, { d: "" });
    sum.reviews = Math.max(n, game.reviews ?? 0);
    keep(NS.outreach, game.outreach);
    keep(NS.followed, game.followed);
    keep(NS.clear, game.clears);
    keep(NS.badge, game.unlocked); sum.badges = Object.keys(game.unlocked ?? {}).length;
    // Quick Play: today's count as a day row, the rest as a lump
    const today = game.triDay && game.triToday ? game.triToday : 0;
    if (today) store.set(NS.triage, game.triDay!, today);
    store.set(NS.meta, "legacyTriaged", Math.max(0, (game.triaged ?? 0) - today));
    if (game.times?.length) store.set(NS.meta, "legacyTimes", game.times);
    if (game.lastLevel) store.set(NS.meta, "lastLevel", game.lastLevel);
    if (game.sheet?.rows) store.set(NS.sheet, "rows", { rows: game.sheet.rows, at: game.sheet.at ?? 0 });
    (game.da?.sess ?? []).forEach((s, i) => store.set(NS.da, `legacy-${s.d}-${i}`, s));
    sum.daSessions = game.da?.sess?.length ?? 0;
    if (game.da) store.set(NS.daRun, "timer", { run: game.da.run || 0, rate: game.da.rate || "" });
    if (game.village?.born) {
      const { sel, ...rest } = game.village;
      void sel;
      store.mutate(NS.village, "state", () => normalize(rest));
      sum.village = true;
    }
    keep(NS.kitStd, kit.std);
    keep(NS.kitJob, kit.jobs);
    resumes.forEach(r => store.set(NS.resume, r.name, r));
    keep(NS.synced, synced);
    if (data["chan-job-type-v1"] !== undefined) store.set(NS.pref, "jobType", data["chan-job-type-v1"]);
    if (data["chan-sheet-url-v1"]) store.set(NS.pref, "sheetUrl", data["chan-sheet-url-v1"]);
  });
  return sum;
}
