// Days are local-calendar strings (YYYY-MM-DD), the same format the old dashboard stored.
export const DAY_MS = 86_400_000;

export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return localDay(d);
}
export function daysSince(iso: string, now: Date = new Date()): number {
  return Math.floor((new Date(localDay(now) + "T12:00:00").getTime() - new Date(iso + "T12:00:00").getTime()) / DAY_MS);
}
/** Monday of the week containing d. */
export function weekStart(d: Date = new Date()): string {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return localDay(x);
}
/** Sheet dates come as MM/DD/YYYY or ISO. */
export function parseSheetDate(v: string | undefined): string {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  let y = +m[3];
  if (y < 100) y += 2000;
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}
