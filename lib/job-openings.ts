import type { Job } from "./types";

type JobOpenings = Pick<Job, "openings" | "openingsRange">;
type OpeningRange = { min: number; max: number };

export function getJobOpeningRange(job: JobOpenings): OpeningRange | null {
  if (job.openingsRange) return job.openingsRange;
  if (typeof job.openings === "number") return { min: job.openings, max: job.openings };
  return null;
}

export function getTotalOpeningRange(jobs: JobOpenings[]): OpeningRange | null {
  const ranges = jobs.map(getJobOpeningRange).filter((range) => range !== null);
  if (!ranges.length) return null;
  return ranges.reduce((total, range) => ({ min: total.min + range.min, max: total.max + range.max }), { min: 0, max: 0 });
}

export function formatOpeningRange(range: OpeningRange): string {
  const minimum = range.min.toLocaleString("en-US");
  return range.min === range.max ? minimum : `${minimum}–${range.max.toLocaleString("en-US")}`;
}
