/* 💼 DataAnnotation sessions: freelance, any length. Each hour pays the village
   gold (an hour of hunting in your best zone) plus an hour of food. */
import type { Store } from "@/lib/sync/store";
import { NS, addDASession, type DARun } from "./progress";
import { daWage, type VillageState } from "./village/engine";
import { localDay } from "./time";

export const MAX_SESSION_MIN = 600;
export const daRun = (store: Store): DARun => store.get<DARun>(NS.daRun, "timer") ?? { run: 0, rate: "" };

export function startDA(store: Store, now = Date.now()) {
  store.set(NS.daRun, "timer", { ...daRun(store), run: now });
}
/** Stop the timer and log the session. Returns minutes and gold, or null if under a minute. */
export function stopDA(store: Store, village: VillageState | null, now = Date.now()) {
  const r = daRun(store);
  if (!r.run) return null;
  const m = Math.min(MAX_SESSION_MIN, Math.round((now - r.run) / 60000));
  store.set(NS.daRun, "timer", { ...r, run: 0 });
  if (m < 1) return null;
  return logDA(store, village, localDay(new Date(r.run)), m);
}
export function logDA(store: Store, village: VillageState | null, day: string, m: number) {
  const g = Math.round(m / 60 * (village ? daWage(village) : 24));
  addDASession(store, { d: day, m, g });
  return { m, g };
}
export const setDARate = (store: Store, rate: string) => store.set(NS.daRun, "timer", { ...daRun(store), rate });
