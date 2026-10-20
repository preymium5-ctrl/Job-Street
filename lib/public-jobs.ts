import { cache } from "react";
import { proposedJobs } from "../data/jobs";
import { additionalApplicationJobs, isAdditionalApplicationJob } from "../data/application-jobs";
import { jobFair } from "../data/job-fair";
import { getJobBySlug, getJobs } from "./repository";
import { workerImageSrc } from "./worker-images";
import type { Job } from "./types";

const companyNames = [...jobFair.employers.map(({ name }) => name), ...jobFair.organizers];

/** Historical records can retain company details; public copy follows the current site policy. */
export function publicJobContent(job: Job): Job {
  const clean = (value: string) => companyNames.reduce((text, name) => text.replaceAll(name, "The recruitment team"), value);
  return {
    ...job,
    title: clean(job.title), summary: clean(job.summary), description: clean(job.description),
    imageAlt: clean(job.imageAlt), requirements: job.requirements.map(clean),
    responsibilities: job.responsibilities.map(clean), benefits: job.benefits.map(clean),
    image: workerImageSrc(job.image),
  };
}

/** The public fair guide can run without a database; applicant/staff data never uses this fallback. */
export function usesPublishedCatalog(env: Record<string, string | undefined> = process.env) {
  return !env.DATABASE_URL && env.NODE_ENV === "production" && env.CHAPTER_LOCAL_MODE !== "true";
}

export const getPublicJobs = cache(async () => {
  const jobs = usesPublishedCatalog()
    ? proposedJobs.filter((job) => job.status === "published" && !job.isExample)
    : await getJobs();
  return jobs.filter((job) => !isAdditionalApplicationJob(job)).map(publicJobContent);
});

/** The application chooser includes separately grouped roles imported from the reference form. */
export const getApplicationJobs = cache(async () => {
  const jobs = usesPublishedCatalog() ? [...proposedJobs, ...additionalApplicationJobs] : await getJobs();
  return jobs.filter((job) => job.status === "published").map(publicJobContent);
});

export const getPublicJobBySlug = cache(async (slug: string) => {
  if (!usesPublishedCatalog()) {
    const job = await getJobBySlug(slug);
    return job && !isAdditionalApplicationJob(job) ? publicJobContent(job) : undefined;
  }
  return (await getPublicJobs()).find((job) => job.slug === slug);
});
