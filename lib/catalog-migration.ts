import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { proposedJobs, proposalV1Jobs, previousRecruitmentJobs, previousCombinedFinishingJob } from "../data/jobs";
import { additionalApplicationJobs } from "../data/application-jobs";
import { getJobFairRole, jobFair } from "../data/job-fair";
import { maximumAgeRequirement, minimumExperienceRequirement } from "../data/employment";
import type { Database } from "./db";
import { audits, jobs, settings } from "./schema";
import type { Job } from "./types";

export const proposalCatalogVersion = "proposed-net-jobs-v1";
export const jobFairCatalogVersion = "job-fair-pdf-2026-09-29-v2";
export const filipinoWorkerImageVersion = "filipino-worker-images-2026-10-16-v1";
export const streetWorkerImageVersion = "street-worker-images-2026-10-17-v2";
export const hiringContentVersion = "croatia-philippines-hiring-2026-10-16-v1";
export const minimumExperienceVersion = "minimum-experience-three-years-2026-10-16-v1";
export const hiringWorkerCountsVersion = "employer-worker-counts-2026-10-16-v1";
export const maximumAgeRequirementVersion = "maximum-age-requirement-2026-10-16-v1";
export const finishingJobsVersion = "separate-grinder-cleaner-2026-10-20-v1";
export const additionalApplicationJobsVersion = "additional-application-jobs-2026-10-20-v1";
export const additionalJobListingsVersion = "additional-job-listings-2026-10-21-v1";
export const legacyExampleJobIds = [
  "example-warehouse-01",
  "example-bus-02",
  "example-auto-03",
  "example-carpenter-04",
  "example-construction-05",
  "example-production-06",
  "example-housekeeper-07",
  "example-butcher-08",
  "example-electrician-09",
  "example-welder-10",
  "example-bakery-11",
  "example-truck-12",
] as const;

/** Apply the operator's catalog replacement once without deleting historical records. */
export async function migrateProposedJobCatalog(db: Database) {
  await db.transaction(async (tx) => {
    if (process.env.DATABASE_URL)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(621349133)`);
    const [seeded] = await tx
      .select()
      .from(settings)
      .where(eq(settings.key, proposalCatalogVersion));
    if (seeded) return;

    const retiredIds: string[] = [];
    for (const id of legacyExampleJobIds) {
      const [previous] = await tx.select().from(jobs).where(eq(jobs.id, id));
      if (!previous) continue;
      // Keep the primary key so applications and audits retain their linkage.
      // Archived slugs also release "welder" for the new proposed role.
      const slug = `legacy-${id}`;
      const data = { ...previous.data, slug, status: "closed" as const };
      await tx
        .update(jobs)
        .set({ slug, status: "closed", data })
        .where(eq(jobs.id, id));
      retiredIds.push(id);
    }

    // A custom staff record with a requested slug must never be overwritten.
    // Unique-key conflicts roll back the entire replacement for staff review.
    for (const job of proposedJobs)
      await tx.insert(jobs).values({
        id: job.id,
        slug: job.slug,
        status: job.status,
        data: job,
      });
    await tx.insert(settings).values({
      key: proposalCatalogVersion,
      value: new Date().toISOString(),
    });
    await tx.insert(audits).values({
      id: randomUUID(),
      actorId: "system:catalog-migration",
      action: "catalog.replaced",
      targetId: proposalCatalogVersion,
      details: {
        retiredIds,
        addedIds: proposedJobs.map((job) => job.id),
        proposedWorkers: proposedJobs.reduce((total, job) => total + (job.openings ?? 0), 0),
      },
    });
  });
  await migrateJobFairCatalog(db);
  await migrateFilipinoWorkerImages(db);
  await migrateStreetWorkerImages(db);
  await migrateHiringContent(db);
  await migrateMinimumExperience(db);
  await migrateHiringWorkerCounts(db);
  await migrateMaximumAgeRequirement(db);
  await migrateFinishingJobs(db);
  await migrateAdditionalApplicationJobs(db);
  await migrateAdditionalJobListings(db);
}

/** Split the finishing listing while keeping the original ID, staff edits and applicant history. */
export async function migrateFinishingJobs(db: Database) {
  await db.transaction(async (tx) => {
    if (process.env.DATABASE_URL) await tx.execute(sql`SELECT pg_advisory_xact_lock(621349133)`);
    const [applied] = await tx.select().from(settings).where(eq(settings.key, finishingJobsVersion));
    if (applied) return;
    const grinder = proposedJobs.find((job) => job.id === previousCombinedFinishingJob.id)!;
    const cleaner = proposedJobs.find((job) => job.slug === "cleaner")!;
    const updatedIds: string[] = [];
    const [row] = await tx.select().from(jobs).where(eq(jobs.id, grinder.id)).for("update");
    if (row && row.slug === grinder.slug) {
      const data = { ...row.data };
      for (const field of ["title", "summary", "description", "imageAlt", "responsibilities"] as const)
        if (JSON.stringify(data[field]) === JSON.stringify(previousCombinedFinishingJob[field]))
          Object.assign(data, { [field]: grinder[field] });
      if (JSON.stringify(data) !== JSON.stringify(row.data)) {
        await tx.update(jobs).set({ data }).where(eq(jobs.id, row.id));
        updatedIds.push(row.id);
      }
    }
    const [existingCleaner] = await tx.select().from(jobs).where(eq(jobs.id, cleaner.id));
    if (!existingCleaner)
      await tx.insert(jobs).values({ id: cleaner.id, slug: cleaner.slug, status: cleaner.status, data: cleaner });
    await tx.insert(settings).values({ key: finishingJobsVersion, value: new Date().toISOString() });
    await tx.insert(audits).values({
      id: randomUUID(), actorId: "system:catalog-migration", action: "catalog.finishing-jobs-separated",
      targetId: finishingJobsVersion, details: { updatedIds, addedIds: existingCleaner ? [] : [cleaner.id] },
    });
  });
}

/** Persist additional roles for server-side application validation without replacing staff records. */
export async function migrateAdditionalApplicationJobs(db: Database) {
  await db.transaction(async (tx) => {
    if (process.env.DATABASE_URL) await tx.execute(sql`SELECT pg_advisory_xact_lock(621349133)`);
    const [applied] = await tx.select().from(settings).where(eq(settings.key, additionalApplicationJobsVersion));
    if (applied) return;
    const addedIds: string[] = [];
    for (const job of additionalApplicationJobs) {
      const [existing] = await tx.select().from(jobs).where(eq(jobs.id, job.id));
      if (existing) continue;
      // A conflicting staff slug rolls back instead of silently replacing their listing.
      await tx.insert(jobs).values({ id: job.id, slug: job.slug, status: job.status, data: job });
      addedIds.push(job.id);
    }
    await tx.insert(settings).values({ key: additionalApplicationJobsVersion, value: new Date().toISOString() });
    await tx.insert(audits).values({
      id: randomUUID(), actorId: "system:catalog-migration", action: "catalog.application-jobs-added",
      targetId: additionalApplicationJobsVersion, details: { addedIds },
    });
  });
}

/** Enrich the original form choices while retaining staff edits and applicant links. */
export async function migrateAdditionalJobListings(db: Database) {
  await db.transaction(async (tx) => {
    if (process.env.DATABASE_URL) await tx.execute(sql`SELECT pg_advisory_xact_lock(621349133)`);
    const [applied] = await tx.select().from(settings).where(eq(settings.key, additionalJobListingsVersion));
    if (applied) return;
    const updatedIds: string[] = [];
    for (const replacement of additionalApplicationJobs) {
      const [row] = await tx.select().from(jobs).where(eq(jobs.id, replacement.id)).for("update");
      if (!row || row.slug !== replacement.slug) continue;
      const baseline: Partial<Job> = {
        category: "Other jobs we're offering",
        location: "Selected application destination",
        employmentType: "To be confirmed",
        summary: `Submit an application for the ${replacement.title} position.`,
        description: "Share your relevant work experience and supporting documents through the application form.",
        responsibilities: ["Position responsibilities will be confirmed during recruitment."],
        requirements: ["Relevant work experience in the selected position."],
        benefits: [],
        experience: "Relevant work experience",
        image: "/images/filipino-intro.webp",
        imageAlt: "Jobs Street Croatia application",
        postedAt: "2026-10-20T00:00:00.000Z",
      };
      const data = { ...row.data };
      for (const field of Object.keys(baseline) as (keyof Job)[])
        if (JSON.stringify(data[field]) === JSON.stringify(baseline[field]))
          Object.assign(data, { [field]: replacement[field] });
      if (!data.salary) {
        data.salary = replacement.salary;
        data.salaryStatus = replacement.salaryStatus;
      }
      if (data.openings === undefined && data.openingsRange === undefined)
        data.openingsRange = replacement.openingsRange;
      if (JSON.stringify(data) === JSON.stringify(row.data)) continue;
      await tx.update(jobs).set({ data }).where(eq(jobs.id, row.id));
      updatedIds.push(row.id);
    }
    await tx.insert(settings).values({ key: additionalJobListingsVersion, value: new Date().toISOString() });
    await tx.insert(audits).values({
      id: randomUUID(), actorId: "system:catalog-migration", action: "catalog.additional-job-listings-enriched",
      targetId: additionalJobListingsVersion, details: { updatedIds },
    });
  });
}

/** Replace only known catalog photos; preserve staff uploads and every non-image field. */
export async function migrateStreetWorkerImages(db: Database) {
  await db.transaction(async (tx) => {
    if (process.env.DATABASE_URL)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(621349133)`);
    const [applied] = await tx.select().from(settings).where(eq(settings.key, streetWorkerImageVersion));
    if (applied) return;
    const updatedIds: string[] = [];
    for (const replacement of proposedJobs) {
      const [row] = await tx.select().from(jobs).where(eq(jobs.id, replacement.id)).for("update");
      const originalImages = [
        `/images/jobs/filipino/${replacement.slug}.webp`,
        `/images/jobs/proposed/${replacement.slug}.webp`,
      ];
      if (!row || row.slug !== replacement.slug || !originalImages.includes(row.data.image)) continue;
      await tx.update(jobs).set({ data: {
        ...row.data, image: replacement.image, imageAlt: replacement.imageAlt,
      } }).where(eq(jobs.id, row.id));
      updatedIds.push(row.id);
    }
    await tx.insert(settings).values({ key: streetWorkerImageVersion, value: new Date().toISOString() });
    await tx.insert(audits).values({
      id: randomUUID(), actorId: "system:catalog-migration", action: "catalog.street-images-refreshed",
      targetId: streetWorkerImageVersion,
      details: { updatedIds, fields: ["image", "imageAlt"] },
    });
  });
}

/** Add the recruitment requirement without altering staff content or historical applicant records. */
export async function migrateMaximumAgeRequirement(db: Database) {
  await db.transaction(async (tx) => {
    if (process.env.DATABASE_URL) await tx.execute(sql`SELECT pg_advisory_xact_lock(621349133)`);
    const [applied] = await tx.select().from(settings).where(eq(settings.key, maximumAgeRequirementVersion));
    if (applied) return;
    const updatedIds: string[] = [];
    for (const replacement of proposedJobs) {
      const [row] = await tx.select().from(jobs).where(eq(jobs.id, replacement.id)).for("update");
      if (!row || row.slug !== replacement.slug || row.data.requirements.includes(maximumAgeRequirement)) continue;
      await tx.update(jobs).set({ data: { ...row.data, requirements: [maximumAgeRequirement, ...row.data.requirements] } }).where(eq(jobs.id, row.id));
      updatedIds.push(row.id);
    }
    await tx.insert(settings).values({ key: maximumAgeRequirementVersion, value: new Date().toISOString() });
    await tx.insert(audits).values({ id: randomUUID(), actorId: "system:catalog-migration", action: "catalog.age-requirement-added", targetId: maximumAgeRequirementVersion, details: { updatedIds, fields: ["requirements"] } });
  });
}

/** Apply the owner's new counts only to matching catalog roles; retain all other fields and applicant history. */
export async function migrateHiringWorkerCounts(db: Database) {
  await db.transaction(async (tx) => {
    if (process.env.DATABASE_URL) await tx.execute(sql`SELECT pg_advisory_xact_lock(621349133)`);
    const [applied] = await tx.select().from(settings).where(eq(settings.key, hiringWorkerCountsVersion));
    if (applied) return;
    const updatedIds: string[] = [];
    for (const replacement of proposedJobs) {
      const [row] = await tx.select().from(jobs).where(eq(jobs.id, replacement.id)).for("update");
      if (!row || row.slug !== replacement.slug || row.data.openings === replacement.openings) continue;
      await tx.update(jobs).set({ data: { ...row.data, openings: replacement.openings } }).where(eq(jobs.id, row.id));
      updatedIds.push(row.id);
    }
    await tx.insert(settings).values({ key: hiringWorkerCountsVersion, value: new Date().toISOString() });
    await tx.insert(audits).values({ id: randomUUID(), actorId: "system:catalog-migration", action: "catalog.worker-counts-updated", targetId: hiringWorkerCountsVersion, details: { updatedIds, fields: ["openings"] } });
  });
}

export async function migrateMinimumExperience(db: Database) {
  await db.transaction(async (tx) => {
    if (process.env.DATABASE_URL) await tx.execute(sql`SELECT pg_advisory_xact_lock(621349133)`);
    const [applied] = await tx.select().from(settings).where(eq(settings.key, minimumExperienceVersion));
    if (applied) return;
    const updatedIds: string[] = [];
    for (const replacement of proposedJobs) {
      const [row] = await tx.select().from(jobs).where(eq(jobs.id, replacement.id)).for("update");
      if (!row || row.slug !== replacement.slug) continue;
      const baseline = proposalV1Jobs.find((job) => job.id === row.id)!;
      const data = { ...row.data, requirements: [...new Set([minimumExperienceRequirement, ...row.data.requirements])] };
      if (baseline && data.experience === baseline.experience) data.experience = replacement.experience;
      if (JSON.stringify(data) === JSON.stringify(row.data)) continue;
      await tx.update(jobs).set({ data }).where(eq(jobs.id, row.id));
      updatedIds.push(row.id);
    }
    await tx.insert(settings).values({ key: minimumExperienceVersion, value: new Date().toISOString() });
    await tx.insert(audits).values({ id: randomUUID(), actorId: "system:catalog-migration", action: "catalog.minimum-experience-updated", targetId: minimumExperienceVersion, details: { updatedIds } });
  });
}

/** Update original recruitment copy and benefits while retaining staff edits and applications. */
export async function migrateHiringContent(db: Database) {
  await db.transaction(async (tx) => {
    if (process.env.DATABASE_URL)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(621349133)`);
    const [applied] = await tx.select().from(settings).where(eq(settings.key, hiringContentVersion));
    if (applied) return;
    const updatedIds: string[] = [];
    for (const replacement of proposedJobs) {
      const [row] = await tx.select().from(jobs).where(eq(jobs.id, replacement.id)).for("update");
      if (!row || row.slug !== replacement.slug) continue;
      const baselines = [...proposalV1Jobs, ...previousRecruitmentJobs].filter((job) => job.id === row.id);
      const data = { ...row.data };
      if (baselines.some((job) => job.description === data.description)) data.description = replacement.description;
      if (baselines.some((job) => JSON.stringify(job.requirements) === JSON.stringify(data.requirements))) data.requirements = replacement.requirements;
      if (baselines.some((job) => job.location === data.location)) data.location = replacement.location;
      data.benefits = [...new Set([...replacement.benefits, ...data.benefits])];
      if (JSON.stringify(data) === JSON.stringify(row.data)) continue;
      await tx.update(jobs).set({ data }).where(eq(jobs.id, row.id));
      updatedIds.push(row.id);
    }
    await tx.insert(settings).values({ key: hiringContentVersion, value: new Date().toISOString() });
    await tx.insert(audits).values({
      id: randomUUID(), actorId: "system:catalog-migration", action: "catalog.hiring-content-refreshed",
      targetId: hiringContentVersion, details: { updatedIds, fields: ["description", "requirements", "location", "benefits"] },
    });
  });
}

/** Refresh original role imagery without changing staff photos or recruitment data. */
export async function migrateFilipinoWorkerImages(db: Database) {
  await db.transaction(async (tx) => {
    if (process.env.DATABASE_URL)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(621349133)`);
    const [applied] = await tx.select().from(settings).where(eq(settings.key, filipinoWorkerImageVersion));
    if (applied) return;
    const updatedIds: string[] = [];
    for (const replacement of proposedJobs) {
      const [row] = await tx.select().from(jobs).where(eq(jobs.id, replacement.id)).for("update");
      const originalImage = `/images/jobs/proposed/${replacement.slug}.webp`;
      if (!row || row.slug !== replacement.slug || row.data.image !== originalImage) continue;
      await tx.update(jobs).set({ data: {
        ...row.data, image: replacement.image, imageAlt: replacement.imageAlt,
      } }).where(eq(jobs.id, row.id));
      updatedIds.push(row.id);
    }
    await tx.insert(settings).values({ key: filipinoWorkerImageVersion, value: new Date().toISOString() });
    await tx.insert(audits).values({
      id: randomUUID(), actorId: "system:catalog-migration", action: "catalog.images-refreshed",
      targetId: filipinoWorkerImageVersion,
      details: { updatedIds, fields: ["image", "imageAlt"] },
    });
  });
}

/** Enrich only untouched seed fields; keep staff edits and all historical links. */
export async function migrateJobFairCatalog(db: Database) {
  await db.transaction(async (tx) => {
    if (process.env.DATABASE_URL)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(621349133)`);
    const [applied] = await tx.select().from(settings).where(eq(settings.key, jobFairCatalogVersion));
    if (applied) return;
    const updatedIds: string[] = [];
    for (const baseline of proposalV1Jobs) {
      const replacement = proposedJobs.find((job) => job.id === baseline.id)!;
      const [row] = await tx.select().from(jobs).where(eq(jobs.id, baseline.id)).for("update");
      if (!row || row.slug !== baseline.slug || !getJobFairRole(row.data)) continue;
      const data = { ...row.data };
      let changed = false;
      if (row.data.description === baseline.description) {
        data.description = replacement.description;
        changed = true;
      }
      if (JSON.stringify(row.data.requirements) === JSON.stringify(baseline.requirements)) {
        data.requirements = replacement.requirements;
        changed = true;
      }
      if (changed) {
        await tx.update(jobs).set({ data }).where(eq(jobs.id, row.id));
        updatedIds.push(row.id);
      }
    }
    await tx.insert(settings).values({ key: jobFairCatalogVersion, value: new Date().toISOString() });
    await tx.insert(audits).values({
      id: randomUUID(), actorId: "system:catalog-migration", action: "catalog.enriched",
      targetId: jobFairCatalogVersion,
      details: { sourceDate: jobFair.sourceDate, updatedIds, fields: ["description", "requirements"] },
    });
  });
}
