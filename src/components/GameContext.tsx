"use client";
import { createContext, useContext, useMemo } from "react";
import type { Job, JobData } from "@/lib/data/types";
import { NS, snapshot, type Progress } from "@/lib/game/progress";
import { gameStats, levelFor, type Stats, type VillageFacts } from "@/lib/game/xp";
import { normalize, topicIndex, trainingOf, type Ctx, type VillageState } from "@/lib/game/village/engine";
import type { Store } from "@/lib/sync/store";

export interface Game {
  data: JobData;
  byId: Map<string, Job>;
  topicOf: Record<string, string>;
  store: Store;
  rev: number;
  p: Progress;
  stats: Stats;
  ctx: Ctx;
  village: VillageState | null;
}

const GameCtx = createContext<Game | null>(null);
export const GameProvider = GameCtx.Provider;
export function useGame(): Game {
  const g = useContext(GameCtx);
  if (!g) throw new Error("useGame outside GameProvider");
  return g;
}

/** Everything derived from the rows, recomputed when any row changes. */
export function useDerived(data: JobData, store: Store, rev: number): Game {
  const byId = useMemo(() => new Map(data.jobs.map(j => [j.id, j])), [data]);
  const topicOf = useMemo(() => topicIndex(data.topics), [data]);
  return useMemo(() => {
    const now = new Date();
    const p = snapshot(store, now);
    const raw = store.get<VillageState>(NS.village, "state");
    const village = raw ? normalize(raw) : null;
    const base: Ctx = { p, topics: data.topics, topicOf, cmd: 1 };
    const facts: VillageFacts = {
      zones: village?.unlocked ?? 1,
      raidWins: Object.keys(village?.raids ?? {}).length,
      bldMax: Math.max(1, ...Object.values(village?.bld ?? {})),
      hunters: Object.keys(data.topics).filter(k => trainingOf(base, k) > 0).length,
    };
    const stats = gameStats(p, byId, facts, now);
    const ctx: Ctx = { ...base, cmd: 1 + 0.02 * (levelFor(stats.xp) - 1) };
    return { data, byId, topicOf, store, rev, p, stats, ctx, village };
    // rev is the store's change counter: every write bumps it
  }, [data, byId, topicOf, store, rev]);
}
