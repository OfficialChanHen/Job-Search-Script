/* 🎒 Apply kit: knockout checks from the posting, which resume to send, and short
   "why us" drafts to rewrite in your own words. You press submit. */
import type { Job } from "@/lib/data/types";
import { fitFor, jobSkills } from "./resumes";
import type { ResumeEntry } from "@/lib/game/progress";

export const STD_FIELDS: [string, string, string][] = [
  ["grad", "Graduation date", "05/2025"],
  ["degree", "Degree", "B.S. Computer Science & Data Science, UW–Madison"],
  ["gpa", "GPA", ""],
  ["auth", "Authorized to work in the US?", ""],
  ["spons", "Need visa sponsorship?", ""],
  ["reloc", "Willing to relocate?", ""],
  ["start", "Earliest start date", ""],
  ["pay", "Salary expectation", ""],
  ["links", "LinkedIn / GitHub / site", ""],
];

// game-dev roles: the title or stack says so, or it's a known studio ("Scientific Games" isn't one)
const GAME_ROLE = /\b(game|games|gameplay|gaming)\b|\bunity\b|\bunreal\b/i;
const GAME_STUDIO = /^(riot|blizzard|epic games|valve|bungie|bethesda|activision|ubisoft|electronic arts|ea|nintendo|sony interactive|playstation|xbox|roblox|zynga|niantic|hi-rez|insomniac|naughty dog|respawn|bioware|2k|take-two|rockstar|supercell|scopely|jam city|wizards of the coast)\b/i;
export const isGame = (j: Job) => GAME_ROLE.test(j.title + " " + (j.sm?.stack || []).join(" ")) || GAME_STUDIO.test((j.company || "").trim());
// skills Chan can honestly claim, for the "strongest at" line when no resume is loaded
const MY_SKILLS = new Set(["React", "React Native", "TypeScript", "Next.js", "Tailwind CSS", "JavaScript", "Python", "SQL",
  "PostgreSQL", "Figma", "Java", "C", "C#", "Unity", "pandas", "Supabase", "Git", "REST APIs", "HTML/CSS", "Expo"]);

export type Ko = ["bad" | "warn" | "ok", string];
export function knockouts(j: Job, grad: string): Ko[] {
  const out: Ko[] = [], fl = j.fl || [];
  const bad = (t: string) => out.push(["bad", t]), warn = (t: string) => out.push(["warn", t]), ok = (t: string) => out.push(["ok", t]);
  const y = parseInt(j.exp, 10);
  if (!isNaN(y) && y >= 2) bad(`Asks for ${y}+ years of experience.`);
  else if (!isNaN(y)) ok(`Experience asked: ${j.exp}.`);
  const g = fl.find(f => f.startsWith("grad "));
  const mine = (grad.match(/20\d\d/) || [])[0];
  if (g) {
    const yrs = g.slice(5).split("/");
    if (mine && !yrs.includes(mine)) bad(`Mentions graduating in ${yrs.join(" or ")}. Your graduation date is ${grad}. Read that line closely: if it's a requirement, the form will screen you out.`);
    else warn(`Mentions graduating in ${yrs.join(" or ")}. Check the exact window.`);
  } else if (j.gradWindow) warn("New-grad title. Check the graduation window in the posting.");
  if (fl.includes("enrolled")) bad("Wants a current student. If you're not enrolled, answer that question honestly; it's usually a knockout.");
  if (fl.includes("clearance")) warn("Mentions a security clearance.");
  if (fl.includes("citizen")) warn("Requires US citizenship.");
  if (fl.includes("grad degree")) warn("Asks for a master's or PhD.");
  if (fl.includes("cover letter")) warn("Mentions a cover letter. Use the drafts below as a start.");
  if (j.closed) bad("No longer on the company's job board.");
  if (j.reposts >= 3) warn(`Posted ${j.reposts} times. Could be an evergreen listing, so a referral helps more than usual.`);
  if (j.stale) warn("Found 30+ days ago and can't be re-checked. It may be filled.");
  if (j.jobType && j.jobType !== "Full-time") warn(`Listed as ${j.jobType}.`);
  if (!j.fl) warn("The full posting hasn't been checked for knockouts yet. Read the requirements yourself.");
  else if (!out.some(([k]) => k !== "ok")) ok("No knockouts found in the posting.");
  return out;
}

const FOCUS: Record<string, string> = {
  frontend: "frontend work in React and TypeScript", mobile: "building mobile apps",
  data_analyst: "turning data into answers with Python and SQL", data_eng: "working with data pipelines and SQL",
  analyst: "turning data into answers with Python and SQL", ml_ai: "working close to AI models",
  ai_training: "working close to AI models", devops: "keeping software running and shipping it",
  qa: "testing and catching bugs before users do",
};
// [short name for "why us", a sentence for "about you"]
function bestProject(j: Job): [string, string] {
  if (isGame(j)) return ["TANKS!, a Unity game I made in C#", "I also make games in Unity. My latest is TANKS!, a local multiplayer tank game written in C#."];
  if (/data|analyst/.test(j.cat)) return ["a Python backtester I wrote for stock strategies", "On my own I wrote a Python backtester for testing stock trading strategies."];
  if (/ml_ai|ai_training/.test(j.cat)) return ["my work reviewing AI-written code at DataAnnotation", "Right now I review AI-written code at DataAnnotation."];
  return ["Hourelle, a group scheduling app I built and run", "I also built and run hourelle.com, a group scheduling app on Next.js and Supabase."];
}
export function kitDrafts(j: Job, resumes: ResumeEntry[]) {
  const focus = isGame(j) ? "building things players actually touch" : FOCUS[j.cat] || "building real features end to end";
  const f = fitFor(j, resumes);
  const have = (f?.best ? f.best.have : jobSkills(j).filter(k => MY_SKILLS.has(k))).slice(0, 2);
  const [proj, projLine] = bestProject(j);
  return {
    why: `I want to work at ${j.company} because [one specific reason in your own words: something they make that you use, a feature you like, or someone there you talked to]. ` +
         `This role stood out because it's ${focus}, which is what I've been doing with ${proj}.`,
    you: `I graduated from UW–Madison in Computer Science and Data Science and worked as a software engineer at Nodeoven. ${projLine}` +
         (have.length ? ` The parts of this job I'd be strongest at use ${have.join(" and ")}.` : ""),
  };
}
const TELLS = /\b(leverag\w*|utiliz\w*|spearhead\w*|robust|seamless\w*|passionate|thrilled|excited to|delv\w*|cutting-edge|innovative|dynamic|synerg\w*|fast-paced|results-driven|align(s|ed)? with my|resonat\w*)\b|—/gi;
/** Flags words that make an answer read as generated. */
export function tellNote(text: string): { note: string; warn: boolean } {
  const hits = [...new Set((text.match(TELLS) || []).map(s => s.toLowerCase()))];
  if (hits.length) return { note: `Sounds generated: ${hits.join(", ")}`, warn: true };
  if (/\[[^\]]+\]/.test(text)) return { note: "Fill in the [bracketed] part", warn: true };
  return { note: "Reads fine", warn: false };
}
