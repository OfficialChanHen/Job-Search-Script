import type { StatusEntry } from "./progress";
import { localDay } from "./time";

/** Applications today, in the last hour, per hour, and minutes between them. */
export function paceStats(status: Record<string, StatusEntry>, now = Date.now()) {
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const applied = Object.values(status).filter(v => v.s === "applied");
  const today = applied.filter(v => v.ts && v.ts >= dayStart.getTime()).map(v => v.ts!).sort((a, b) => a - b);
  const todayCount = applied.filter(v => v.t === localDay(new Date(now))).length;
  const lastHour = today.filter(t => now - t <= 3600e3).length;
  // pace = per hour since your first application today (at least 15 min, so 1 app isn't 60/hr)
  const hrs = today.length ? Math.max((now - today[0]) / 3600e3, 0.25) : 0;
  const perHr = today.length ? today.length / hrs : 0;
  const gaps = today.slice(1).map((t, i) => t - today[i]);
  const avgMin = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length / 60000 : null;
  const hours = Array(24).fill(0) as number[];
  today.forEach(t => hours[new Date(t).getHours()]++);
  const days: [string, number][] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const k = localDay(d);
    days.push([k, applied.filter(v => v.t === k).length]);
  }
  return { todayCount, lastHour, perHr, avgMin, hours, days };
}
