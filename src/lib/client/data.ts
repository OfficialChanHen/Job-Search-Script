"use client";
import type { JobData } from "@/lib/data/types";

const FILES = ["jobs", "preps", "companies", "topics", "vocab", "meta"] as const;
let pending: Promise<JobData> | null = null;

/** Job data built by the daily scrape (public/data/*.json). Fetched once per tab. */
export function loadJobData(): Promise<JobData> {
  return (pending ??= Promise.all(FILES.map(f => fetch(`/data/${f}.json`).then(r => {
    if (!r.ok) throw new Error(`Couldn't load ${f}.json (${r.status})`);
    return r.json();
  }))).then(([jobs, preps, companies, topics, vocab, meta]) => ({ jobs, preps, companies, topics, vocab, meta })));
}
