import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { migrateProposedJobCatalog } from "./catalog-migration";
import { getDatabase, localModeAllowed } from "./db";
import { applications, audits, jobs, sheetDeliveries } from "./schema";
import type { Application, ApplicationStatus, Job } from "./types";
import { getJobFairRole } from "../data/job-fair";

let seedPromise: Promise<void> | undefined;
async function ensureSeeded() {
  if (!seedPromise)
    seedPromise = (async () => {
      if (
        !localModeAllowed() &&
        process.env.SEED_PROPOSED_JOBS !== "true" &&
        process.env.SEED_EXAMPLE_JOBS !== "true"
      )
        return;
      const db = await getDatabase();
      await migrateProposedJobCatalog(db);
    })().catch((error) => {
      seedPromise = undefined;
      throw error;
    });
  await seedPromise;
}
export async function getJobs(
  options: { includeUnpublished?: boolean } = {},
): Promise<Job[]> {
  await ensureSeeded();
  const db = await getDatabase();
  const result = await db
    .select()
    .from(jobs)
    .where(
      options.includeUnpublished ? undefined : eq(jobs.status, "published"),
    );
  return result
    .map((row) => row.data)
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}
export async function getJobBySlug(slug: string): Promise<Job | undefined> {
  await ensureSeeded();
  const [row] = await (
    await getDatabase()
  )
    .select()
    .from(jobs)
    .where(and(eq(jobs.slug, slug), eq(jobs.status, "published")))
    .limit(1);
  return row?.data;
}
export async function getJobById(id: string): Promise<Job | undefined> {
  await ensureSeeded();
  const [row] = await (
    await getDatabase()
  )
    .select()
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1);
  return row?.data;
}
export async function saveJob(
  input: Job,
  actorId: string,
  isNew = false,
): Promise<Job> {
  await ensureSeeded();
  const db = await getDatabase();
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, input.id));
    if (!isNew && !previous) throw new Error("NOT_FOUND");
    if (isNew)
      await tx
        .insert(jobs)
        .values({
          id: input.id,
          slug: input.slug,
          status: input.status,
          data: input,
        });
    else
      await tx
        .update(jobs)
        .set({ slug: input.slug, status: input.status, data: input })
        .where(eq(jobs.id, input.id));
    await tx
      .insert(audits)
      .values({
        id: randomUUID(),
        actorId,
        action: isNew ? "job.created" : "job.updated",
        targetId: input.id,
        details: { before: previous?.data ?? null, after: input },
      });
    return input;
  });
}
export async function findApplicationByKey(key: string) {
  const [row] = await (
    await getDatabase()
  )
    .select()
    .from(applications)
    .where(eq(applications.idempotencyKey, key))
    .limit(1);
  return row;
}
export async function createApplication(
  application: Application,
  key: string,
  requestHash: string,
) {
  const db = await getDatabase();
  return db.transaction(async (tx) => {
    // Closing a vacancy and accepting a new application must not race each other.
    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, application.jobId))
      .for("share");
    if (!job || job.status !== "published") throw new Error("JOB_NOT_OPEN");
    if (application.preferredEmployer && !getJobFairRole(job.data)?.employers.some((employer) => employer.name === application.preferredEmployer))
      throw new Error("INVALID_EMPLOYER");
    if ((application.driverLicenseDetails || application.documents?.some((document) => document.category === "driver-license")) && !getJobFairRole(job.data)?.drivingLicenseIsPlus)
      throw new Error("INVALID_DRIVER_LICENSE");
    const currentApplication = {
      ...application,
      jobTitle: job.data.title,
      isExample: job.data.isExample,
    };
    const [row] = await tx
      .insert(applications)
      .values({
        id: application.id,
        jobId: application.jobId,
        idempotencyKey: key,
        requestHash,
        data: currentApplication,
      })
      .onConflictDoNothing({ target: applications.idempotencyKey })
      .returning();
    if (row) {
      // The delivery intent commits with the application, even if Google is unavailable.
      await tx.insert(sheetDeliveries).values({ applicationId: row.id });
      return { application: row.data, created: true, requestHash };
    }
    const [existing] = await tx
      .select()
      .from(applications)
      .where(eq(applications.idempotencyKey, key))
      .limit(1);
    if (!existing) throw new Error("Application could not be persisted.");
    return {
      application: existing.data,
      created: false,
      requestHash: existing.requestHash,
    };
  });
}
export async function getApplications(): Promise<Application[]> {
  return (
    await (
      await getDatabase()
    )
      .select()
      .from(applications)
      .orderBy(desc(applications.createdAt))
  ).map((row) => row.data);
}
export async function getApplicationById(
  id: string,
): Promise<Application | undefined> {
  const [row] = await (
    await getDatabase()
  )
    .select()
    .from(applications)
    .where(eq(applications.id, id))
    .limit(1);
  return row?.data;
}
export async function updateApplicationStatus(
  id: string,
  status: ApplicationStatus,
  actorId: string,
) {
  const db = await getDatabase();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(applications)
      .where(eq(applications.id, id))
      .for("update");
    if (!row) return undefined;
    const application = { ...row.data, status };
    await tx
      .update(applications)
      .set({ data: application })
      .where(eq(applications.id, id));
    await tx
      .insert(audits)
      .values({
        id: randomUUID(),
        actorId,
        action: "application.status",
        targetId: id,
        details: { from: row.data.status, to: status },
      });
    return application;
  });
}
export async function auditResumeAccess(actorId: string, targetId: string, documentId?: string) {
  await (
    await getDatabase()
  )
    .insert(audits)
    .values({
      id: randomUUID(),
      actorId,
      action: documentId ? "document.downloaded" : "resume.downloaded",
      targetId,
      details: documentId ? { documentId } : {},
    });
}
