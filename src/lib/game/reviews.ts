import type { Progress } from "./progress";
import { localDay } from "./time";

/** Solved problems come back after 3, 7 and 14 days. */
export const REVIEW_GAPS = [3, 7, 14];

export interface DueReview { n: number; stage: number; due: string }
export function dueReviews(p: Progress, now: Date = new Date()): DueReview[] {
  const t = localDay(now);
  return Object.entries(p.rev)
    .filter(([n, r]) => p.solved[n] && r.due && r.due <= t)
    .map(([n, r]) => ({ n: +n, stage: r.s, due: r.due! }));
}
