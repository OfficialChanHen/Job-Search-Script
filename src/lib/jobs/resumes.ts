/* Which of your resumes covers the most of what a posting asks for.
   Resumes are read in the browser; only the list of skills found is kept. */
import type { Job } from "@/lib/data/types";
import type { ResumeEntry } from "@/lib/game/progress";

export type Vocab = [string, RegExp][];
export const compileVocab = (raw: [string, string, string][]): Vocab => raw.map(([l, rx, fl]) => [l, new RegExp(rx, fl)]);
export const skillsIn = (vocab: Vocab, text: string) => vocab.filter(([, rx]) => rx.test(text)).map(([l]) => l);

const CHIP_TO_SKILL: Record<string, string> = { React: "React", "React Native": "React Native", TypeScript: "TypeScript", "Next.js": "Next.js",
  Tailwind: "Tailwind CSS", JavaScript: "JavaScript", Python: "Python", SQL: "SQL", GraphQL: "GraphQL", Node: "Node.js", Figma: "Figma",
  Java: "Java", REST: "REST APIs", CSS: "HTML/CSS", Pandas: "pandas", Expo: "Expo" };
// resume file name → [role categories it's built for, ones it also suits]
const ROLE_HINTS: [RegExp, string[], string[]][] = [
  [/front[- ]?end/i, ["frontend", "mobile"], ["swe"]],
  [/full[- ]?stack/i, ["swe", "devops", "solutions", "qa", "platform_dev"], ["frontend", "mobile", "data_eng"]],
  [/\bdata\b/i, ["data_analyst", "data_eng", "analyst"], ["ml_ai"]],
  [/\bai\b|machine learning|\bml\b/i, ["ml_ai", "ai_training"], ["data_eng", "data_analyst", "swe"]],
];
function roleFit(r: ResumeEntry, cat: string) {
  let best = 0;
  ROLE_HINTS.forEach(([rx, primary, secondary]) => {
    if (rx.test(r.name)) best = Math.max(best, primary.includes(cat) ? 12 : secondary.includes(cat) ? 6 : 0);
  });
  return best;
}
export const shortName = (n: string) => (n.replace(/\.(pdf|txt|md|html?)$/i, "").replace(/^.*?\bhen[-_ ]*/i, "")
  .replace(/[-_ ]*resume[-_ ]*/i, " ").replace(/[-_]+/g, " ").trim() || n);
export function jobSkills(j: Job): string[] {
  const s = new Set(j.sm?.stack || []);
  j.chips.forEach(c => { if (CHIP_TO_SKILL[c]) s.add(CHIP_TO_SKILL[c]); });
  return [...s];
}
export interface FitRow { r: ResumeEntry; have: string[]; missing: string[]; pct: number; role: number; score: number }
export function fitFor(j: Job, resumes: ResumeEntry[]): { best: FitRow; all: FitRow[]; need: string[] } | null {
  if (!resumes.length) return null;
  const need = jobSkills(j);
  const all = resumes.map(r => {
    const have = need.filter(k => r.skills.includes(k)), role = roleFit(r, j.cat), pct = need.length ? have.length / need.length : 0;
    return { r, have, missing: need.filter(k => !have.includes(k)), pct, role, score: pct * 100 + role };
  }).sort((a, b) => b.score - a.score);
  return { best: all[0], all, need };
}
