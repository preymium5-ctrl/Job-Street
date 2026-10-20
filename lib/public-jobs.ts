import { cache } from "react";
import { proposedJobs } from "../data/jobs";
import { getJobBySlug, getJobs } from "./repository";
import { workerImageSrc } from "./worker-images";

/** The public fair guide can run without a database; applicant/staff data never uses this fallback. */
export function usesPublishedCatalog(env: Record<string, string | undefined> = process.env) {
  return !env.DATABASE_URL && env.NODE_ENV === "production" && env.CHAPTER_LOCAL_MODE !== "true";
}

export const getPublicJobs = cache(async () => {
  const jobs = usesPublishedCatalog()
    ? proposedJobs.filter((job) => job.status === "published" && !job.isExample)
    : await getJobs();
  return jobs.map((job) => ({ ...job, image: workerImageSrc(job.image) }));
});

export const getPublicJobBySlug = cache(async (slug: string) => {
  if (!usesPublishedCatalog()) {
    const job = await getJobBySlug(slug);
    return job ? { ...job, image: workerImageSrc(job.image) } : undefined;
  }
  return (await getPublicJobs()).find((job) => job.slug === slug);
});
