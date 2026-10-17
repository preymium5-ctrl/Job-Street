import { cache } from "react";
import { proposedJobs } from "../data/jobs";
import { getJobBySlug, getJobs } from "./repository";

/** The public fair guide can run without a database; applicant/staff data never uses this fallback. */
export function usesPublishedCatalog(env: Record<string, string | undefined> = process.env) {
  return !env.DATABASE_URL && env.NODE_ENV === "production" && env.CHAPTER_LOCAL_MODE !== "true";
}

export const getPublicJobs = cache(async () => {
  if (!usesPublishedCatalog()) return getJobs();
  return proposedJobs.filter((job) => job.status === "published" && !job.isExample);
});

export const getPublicJobBySlug = cache(async (slug: string) => {
  if (!usesPublishedCatalog()) return getJobBySlug(slug);
  return (await getPublicJobs()).find((job) => job.slug === slug);
});
