// Shapes of the JSON files build_dashboard.py writes to public/data/.

export type WorkMode = "onsite" | "hybrid" | "remote";

export interface JobSummary {
  sum?: string;          // one-paragraph summary of the posting
  do?: string[];         // what you'd do
  need?: string[];       // what they want
  pay?: string;
  stack?: string[];      // skills the posting names
}

export interface Drive {
  mi: number; cost: number; min: number;
  pay?: number; eff?: number; ok?: boolean;
}

export interface Job {
  id: string;
  date: string;          // day first scraped (YYYY-MM-DD)
  posted?: string;
  type: string;          // "parttime" for local part-time, else role type
  source: string;
  title: string;
  company: string;
  location: string;
  url: string;
  direct?: string;       // the posting on the company's own site
  score: number;
  chips: string[];
  junior: boolean;
  remote: boolean;
  mode: WorkMode | "";
  jobType: string;       // Full-time, Contract…
  cat: string;
  catLabel: string;
  swe: boolean;
  exp: string;
  gradWindow: boolean;
  prep: number;          // index into preps.json
  drive?: Drive;
  closed: boolean;
  reposts: number;
  stale: boolean;
  ck?: string;           // company key into companies.json
  sm?: JobSummary;
  fl?: string[];         // knockout flags found in the posting
}

export type Problem = [number, string, string];   // [number, name, url]

export interface Prep {
  coding: boolean;
  focus: string;
  problems: Problem[];
  text: string;          // one Google Sheet cell
}

export interface Company { s?: string; src?: string; u?: string }

export interface Topic { label: string; problems: Problem[] }

export interface Meta { generated: string; latest: string }

export interface JobData {
  jobs: Job[];
  preps: Prep[];
  companies: Record<string, Company>;
  topics: Record<string, Topic>;
  vocab: [string, string, string][];
  meta: Meta;
}
