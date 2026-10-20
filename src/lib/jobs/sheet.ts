/* Your tracker sheet: rows in its column order, and the Apps Script auto-fill. */
import type { Job, Prep } from "@/lib/data/types";

export const SHEET_COLS = ["Last Update", "Company", "Job", "Location", "Status", "Application"];
export function sheetToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// the Application column says where you applied, in the words your sheet already uses
const BOARDS: [RegExp, string][] = [
  [/linkedin\./, "LinkedIn"], [/indeed\./, "Indeed"], [/adzuna\./, "Adzuna"], [/dice\.com/, "Dice"], [/himalayas\./, "Himalayas"],
  [/handshake/, "Handshake"], [/simplify\.jobs/, "Simplify"], [/ziprecruiter\./, "ZipRecruiter"], [/jobicy\./, "Jobicy"], [/usajobs\./, "USAJobs"],
];
export function applicationOf(j: Pick<Job, "url" | "direct">) {
  const href = (j.direct || j.url || "").toLowerCase();
  return BOARDS.find(([re]) => re.test(href))?.[1] ?? "Company website";
}
export function sheetRow(j: Job, status: string, date = sheetToday()) {
  return [date, j.company, j.title, j.location, status, applicationOf(j)];
}
export const isAppsScriptUrl = (u: string) => /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(u);

/** Add an Applied row to the sheet. Apps Script needs a "simple" text/plain request to skip CORS preflight. */
export async function pushToSheet(url: string, j: Job, prep: Prep | undefined) {
  await fetch(url, {
    method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ date: sheetToday(), company: j.company, title: j.title, location: j.location, status: "Applied",
                           application: j.id === "__test__" ? "Test" : applicationOf(j), url: j.direct || j.url, id: j.id, jobType: j.jobType || "", prep: prep?.text ?? "" }),
  });
}

/** Copy as one sheet row: HTML table (keeps the multi-line LeetCode cell together) plus TSV fallback. */
export async function copySheetRow(vals: string[]) {
  const tsv = vals.map(v => /[\t\n"]/.test(v) ? '"' + v.replace(/\t/g, " ").replace(/"/g, '""') + '"' : v).join("\t");
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const html = "<table><tr>" + vals.map(v => "<td>" + esc(v).replace(/\n/g, "<br>") + "</td>").join("") + "</tr></table>";
  if (window.ClipboardItem && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([tsv], { type: "text/plain" }) })]);
  } else await navigator.clipboard.writeText(tsv);
}
