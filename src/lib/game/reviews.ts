import type { Progress } from "./progress";
import { localDay } from "./time";

/** Solved problems come back after 3, 7, 14, 30 and 60 days, then every 90 days for good. */
export const REVIEW_GAPS = [3, 7, 14, 30, 60];
export const KEEP_UP_DAYS = 90;
export const nextGap = (done: number) => done < REVIEW_GAPS.length ? REVIEW_GAPS[done] : KEEP_UP_DAYS;

export interface DueReview { n: number; stage: number; due: string }
export function dueReviews(p: Progress, now: Date = new Date()): DueReview[] {
  const t = localDay(now);
  return Object.entries(p.rev)
    // a review the old 3-step schedule called finished (due: null) picks up again now
    .filter(([n, r]) => p.solved[n] && (r.due ?? t) <= t)
    .map(([n, r]) => ({ n: +n, stage: r.s, due: r.due ?? t }));
}
