import type { Store } from "@/lib/sync/store";
import { NS } from "./progress";
import { localDay } from "./time";
import { BADGES, levelFor, type Badge, type Stats } from "./xp";

export interface CheckResult { cleared: boolean; badges: Badge[]; levelUp: number | null; stats: Stats }

/** Record quest clears, badge unlocks and level-ups that current progress has earned. */
export function checkProgress(store: Store, compute: () => Stats, now: Date = new Date()): CheckResult {
  const today = localDay(now);
  let s = compute();
  let cleared = false;
  if (s.quests.every(([, n, goal]) => n >= goal) && !store.get(NS.clear, today)) {
    store.set(NS.clear, today, 1);
    cleared = true;
    s = compute();
  }
  const fresh = BADGES.filter(([id, , , , test]) => !store.get(NS.badge, id) && test(s));
  if (fresh.length) {
    store.batch(() => fresh.forEach(([id]) => store.set(NS.badge, id, today)));
    s = compute();
  }
  const lvl = levelFor(s.xp), last = store.get<number>(NS.meta, "lastLevel") || 1;
  if (lvl !== last) store.set(NS.meta, "lastLevel", lvl);
  return { cleared, badges: fresh, levelUp: lvl > last ? lvl : null, stats: s };
}
