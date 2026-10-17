import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { proposedJobs, proposalV1Jobs, previousRecruitmentJobs } from "../data/jobs";
import { maximumAgeRequirement, maximumApplicantAge, minimumExperienceRequirement, recruitmentBenefits } from "../data/employment";
import { fairDocuments, getJobFairRole, jobFair, nc2ElectricalNote } from "../data/job-fair";
import { hiringAllocations, hiringWorkerTotal } from "../data/hiring-allocations";
import {
  legacyExampleJobIds,
  migrateProposedJobCatalog,
  proposalCatalogVersion,
  migrateJobFairCatalog,
  jobFairCatalogVersion,
  migrateFilipinoWorkerImages,
  filipinoWorkerImageVersion,
  migrateStreetWorkerImages,
  streetWorkerImageVersion,
  migrateHiringContent,
  hiringContentVersion,
  migrateMinimumExperience,
  minimumExperienceVersion,
  migrateHiringWorkerCounts,
  hiringWorkerCountsVersion,
  migrateMaximumAgeRequirement,
  maximumAgeRequirementVersion,
} from "../lib/catalog-migration";
import { closeDatabase, getDatabase } from "../lib/db";
import { applications, audits, jobs, settings } from "../lib/schema";
import type { Application, Job } from "../lib/types";
import { jobSchema } from "../lib/validation";

let temporaryDirectory: string;
const originalEnv = { ...process.env };
before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "chapter-catalog-test-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: temporaryDirectory,
    CHAPTER_LOCAL_MODE: "true",
  });
  delete process.env.DATABASE_URL;
});

after(async () => {
  await closeDatabase();
  const safeRoot = path.resolve(tmpdir()) + path.sep;
  if (!path.resolve(temporaryDirectory).startsWith(safeRoot) ||
      !path.basename(temporaryDirectory).startsWith("chapter-catalog-test-"))
    throw new Error("Unexpected catalog test cleanup path.");
  await rm(temporaryDirectory, { recursive: true, force: true });
  for (const key of Object.keys(process.env))
    if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

test("the archived 17 operator proposals retain original worker counts and salary ranges", () => {
  assert.deepEqual(
    proposalV1Jobs.map(({ title, openings, salary }) => [title, openings, salary]),
    [
      ["Fabricator", 68, "€850–€1,100"],
      ["TIG / REL Welder", 10, "€1,000–€1,300"],
      ["Pipe Fitter", 15, "€950–€1,250"],
      ["M/G Winding Insulator", 5, "€800–€950"],
      ["M/G Winding Production Worker", 5, "€800–€950"],
      ["M/G Winding Processing Worker", 5, "€850–€1,000"],
      ["Sheet Metal / Tinsmith Processor", 5, "€850–€1,050"],
      ["M/G Assembly Fitter", 10, "€900–€1,150"],
      ["MIG MAG / TIG / REL Welder", 20, "€950–€1,300"],
      ["Electrical Installer", 35, "€900–€1,200"],
      ["Electrical Assembler", 25, "€850–€1,100"],
      ["Welder", 10, "€900–€1,200"],
      ["MIG MAG / TIG Welder", 5, "€950–€1,250"],
      ["CNC Operator", 7, "€900–€1,150"],
      ["Industrial Spray Painter", 13, "€850–€1,050"],
      ["Robotic Welding Machine Operator", 4, "€950–€1,250"],
      ["Grinder and Cleaner", 6, "€800–€950"],
    ],
  );
  assert.equal(proposalV1Jobs.reduce((sum, job) => sum + (job.openings ?? 0), 0), 248);
  assert.equal(new Set(proposedJobs.map((job) => job.image)).size, 17);
  assert.equal(new Set(proposedJobs.map((job) => job.slug)).size, 17);
  for (const job of proposedJobs) {
    assert.equal(jobSchema.safeParse(job).success, true, job.title);
    assert.equal(job.salaryStatus, "proposed-net");
    assert.equal(job.isExample, false);
    assert.equal(job.location, "Croatia");
    assert.equal(job.employmentType, "Terms to be confirmed");
    assert.deepEqual(job.benefits, recruitmentBenefits);
    assert.equal(maximumApplicantAge, 45);
    assert.equal(job.requirements.filter((item) => item === maximumAgeRequirement).length, 1);
  }
});

test("current employer counts vary strictly between 100 and 1200 and reconcile with every job total", () => {
  assert.equal(Object.keys(hiringAllocations).length, proposedJobs.length);
  const counts: number[] = [];
  for (const job of proposedJobs) {
    const role = getJobFairRole(job)!;
    assert.deepEqual(role.employers.map((employer) => employer.name).sort(), Object.keys(hiringAllocations[job.slug]).sort());
    for (const employer of role.employers) {
      assert.ok(Number.isInteger(employer.workers) && employer.workers > 100 && employer.workers < 1200, `${job.slug}: ${employer.name}`);
      counts.push(employer.workers);
    }
    assert.equal(role.employers.reduce((total, employer) => total + employer.workers, 0), job.openings);
    assert.equal(hiringWorkerTotal(job.slug), job.openings);
    assert.ok(job.openings! > 100 && job.openings! < 1200);
    assert.equal(job.salary, proposalV1Jobs.find((original) => original.id === job.id)!.salary);
  }
  assert.ok(new Set(counts).size > 10);
  assert.deepEqual(getJobFairRole(proposedJobs[0])!.employers.map((employer) => employer.workers), [175, 225, 300, 450]);
  assert.equal(proposedJobs[0].openings, 1150);
  assert.equal(proposedJobs.reduce((total, job) => total + job.openings!, 0), 11100);
  assert.equal(hiringWorkerTotal("unrelated-staff-job"), undefined);
});

test("the dated fair allocations reconcile six employers and exactly 248 workers across the 17 roles", () => {
  assert.equal(jobFair.sourceDate, "2026-09-29");
  assert.equal(jobFair.testingDateLabel, "16–20 November 2026");
  assert.equal(jobFair.interviewDateLabel, "26 October – 14 November 2026");
  assert.equal(jobFair.venue, "Testing centre to be confirmed");
  assert.deepEqual(jobFair.organizers, ["BEI Manpower"]);
  assert.deepEqual(jobFair.employers.map(({ name, workers }) => [name, workers]), [
    ["Končar MK", 5], ["Đuro Đaković Montaža", 25], ["Končar GIM", 35],
    ["Vertiv", 75], ["Novi Ferromont d.o.o.", 30], ["Ferokotao d.o.o.", 78],
  ]);
  assert.equal(jobFair.employers.reduce((total, employer) => total + employer.workers, 0), 248);
  for (const employer of jobFair.employers)
    assert.equal(employer.roles.reduce((total, role) => total + role.workers, 0), employer.workers, employer.name);
  for (const job of proposedJobs) {
    const role = getJobFairRole(job)!;
    assert.ok(role, job.slug);
    assert.equal(role.drivingLicenseIsPlus, true, `Page 5 says all positions: ${job.slug}`);
    assert.equal(role.employers.reduce((total, employer) => total + employer.workers, 0), job.openings, job.title);
    assert.ok(role.testing.length > 0);
    assert.match(job.description, /hiring skilled Filipino workers/);
    assert.ok(!job.description.toLowerCase().includes("not a confirmed employer offer"));
    assert.equal(getJobFairRole({ ...job, id: "unrelated-staff-job" }), undefined);
    assert.equal(getJobFairRole({ ...job, slug: "staff-renamed-role" }), undefined);
  }
});

test("certificate and trade-test guidance follows the source without inventing missing categories", () => {
  const role = (slug: string) => getJobFairRole(proposedJobs.find((job) => job.slug === slug)!)!;
  assert.deepEqual(fairDocuments, ["Valid NC2 certificate", "High school diploma", "NBI clearance with apostille", "Form 18a"]);
  for (const slug of ["fabricator", "cnc-operator", "industrial-spray-painter", "grinder-and-cleaner"])
    assert.equal(role(slug).nc2, "NC2 Fabricator");
  for (const slug of ["tig-rel-welder", "mig-mag-tig-rel-welder", "welder", "mig-mag-tig-welder"])
    assert.equal(role(slug).nc2, "NC2 Welding");
  for (const slug of ["electrical-installer", "electrical-assembler", "mg-assembly-fitter"])
    assert.equal(role(slug).nc2, "NC2 Electrical");
  for (const slug of ["mg-winding-insulator", "mg-winding-production-worker", "mg-winding-processing-worker"])
    assert.equal(role(slug).nc2, "NC2 Fabricator or Electrical");
  for (const slug of ["pipe-fitter", "sheet-metal-tinsmith-processor", "robotic-welding-machine-operator"])
    assert.equal(role(slug).nc2, "Valid NC2 certificate; category to be confirmed");
  assert.match(nc2ElectricalNote, /lineman/);
  assert.match(role("electrical-installer").focus!, /industrial electricians/);
  assert.match(role("electrical-assembler").focus!, /data-centre experience alone/);
  const tig = role("tig-rel-welder").testing.join(" ");
  assert.match(tig, /fixture/);
  assert.match(tig, /SMAW \(REL\)/);
  assert.match(tig, /Ø139\.7 × 12 mm/);
  assert.match(tig, /1–2 REL passes/);
  assert.match(tig, /Visual inspection \(VT\)/);
  assert.match(tig, /radiographic testing \(RT\) is not required/);
  assert.deepEqual(role("pipe-fitter").testing, ["Written exam for Đuro Đaković Montaža pipe fitters."]);
});

test("catalog migration preserves applications and custom jobs, resolves old slugs, and runs once", async () => {
  let db = await getDatabase();
  const oldSlugs = [
    "warehouse-worker", "bus-driver", "auto-mechanic", "carpenter",
    "construction-worker", "production-line-worker", "hotel-housekeeper", "butcher",
    "electrician", "welder", "bakery-worker", "truck-mechanic",
  ];
  const legacyJobs: Job[] = legacyExampleJobIds.map((id, index) => ({
    ...proposedJobs[0], id, slug: oldSlugs[index], isExample: true,
    salary: undefined, salaryStatus: undefined, openings: undefined,
    title: `Legacy ${oldSlugs[index]}`,
  }));
  const customJob: Job = { ...proposedJobs[0], id: "staff-custom", slug: "staff-custom", title: "Staff custom role" };
  const collision: Job = { ...customJob, id: "staff-collision", slug: "fabricator" };
  for (const job of [...legacyJobs, customJob, collision])
    await db.insert(jobs).values({ id: job.id, slug: job.slug, status: job.status, data: job });
  await db.insert(settings).values({ key: "example-jobs-v1", value: "already seeded" });
  const historical: Application = {
    id: "historical-application", reference: "CH-HISTORY", jobId: "example-welder-10",
    jobTitle: "Legacy welder", status: "Under Review", submittedAt: "2026-10-14T00:00:00.000Z",
    fullName: "Synthetic History", email: "history@example.test", phone: "+639171234567",
    country: "Philippines", recentJobTitle: "Welder", experienceYears: 2,
    skills: "Welding", education: "", summary: "", coverLetter: "", consent: true,
    resumeName: "synthetic.pdf", resumeKey: "resumes/synthetic-history.pdf", resumeMime: "application/pdf", isExample: true,
  };
  await db.insert(applications).values({ id: historical.id, jobId: historical.jobId, idempotencyKey: "historical-key", requestHash: "historical-hash", data: historical });
  await db.insert(audits).values({ id: "historical-audit", actorId: "historical-staff", action: "application.status", targetId: historical.id, details: { preserved: true } });

  await assert.rejects(migrateProposedJobCatalog(db));
  assert.equal((await db.select().from(jobs).where(eq(jobs.id, "example-welder-10")))[0].status, "published");
  assert.equal((await db.select().from(settings).where(eq(settings.key, proposalCatalogVersion))).length, 0);
  // Remove only this deliberately conflicting record in the isolated test database.
  await db.delete(jobs).where(eq(jobs.id, collision.id));
  await migrateProposedJobCatalog(db);

  const migrated = await db.select().from(jobs);
  assert.equal(migrated.filter((row) => row.status === "published").length, 18);
  for (const id of legacyExampleJobIds) {
    const archived = migrated.find((row) => row.id === id)!;
    assert.equal(archived.status, "closed");
    assert.equal(archived.slug, `legacy-${id}`);
    assert.equal(archived.data.status, "closed");
  }
  assert.equal(migrated.find((row) => row.slug === "welder")?.id, proposedJobs.find((job) => job.slug === "welder")?.id);
  assert.deepEqual(migrated.find((row) => row.id === customJob.id)?.data, customJob);
  assert.deepEqual((await db.select().from(applications).where(eq(applications.id, historical.id)))[0].data, historical);
  assert.equal((await db.select().from(audits).where(eq(audits.id, "historical-audit"))).length, 1);

  const edited = { ...proposedJobs[0], title: "Staff-reviewed fabricator", salary: "€900–€1,100" };
  await db.update(jobs).set({ data: edited }).where(eq(jobs.id, edited.id));
  await closeDatabase();
  db = await getDatabase();
  await migrateProposedJobCatalog(db);
  assert.deepEqual((await db.select().from(jobs).where(eq(jobs.id, edited.id)))[0].data, edited);
  assert.equal((await db.select().from(audits).where(eq(audits.action, "catalog.replaced"))).length, 1);
});

test("fair enrichment only replaces original seed content and preserves staff edits, closed jobs and applications", async () => {
  const db = await getDatabase();
  // Recreate a pre-enrichment catalog only inside this test's temporary database.
  await db.delete(settings).where(eq(settings.key, jobFairCatalogVersion));
  await db.delete(audits).where(eq(audits.targetId, jobFairCatalogVersion));
  for (const job of proposalV1Jobs)
    await db.update(jobs).set({ slug: job.slug, status: job.status, data: job }).where(eq(jobs.id, job.id));
  const protectedJob: Job = {
    ...proposalV1Jobs[0], title: "Reviewed title", salary: "€999–€1,111", status: "closed",
    image: "/images/staff-photo.webp", imageAlt: "Staff-approved image", summary: "Staff summary",
    location: "Staff-reviewed location", employmentType: "Staff-reviewed contract", openings: 12,
  };
  await db.update(jobs).set({ status: protectedJob.status, data: protectedJob }).where(eq(jobs.id, protectedJob.id));
  const editedDescription = { ...proposalV1Jobs[1], description: "Staff-authored role description." };
  await db.update(jobs).set({ data: editedDescription }).where(eq(jobs.id, editedDescription.id));
  const editedRequirements = { ...proposalV1Jobs[2], requirements: ["Staff-reviewed requirement."] };
  await db.update(jobs).set({ data: editedRequirements }).where(eq(jobs.id, editedRequirements.id));
  const renamed = { ...proposalV1Jobs[3], slug: "staff-renamed-winding-insulator" };
  await db.update(jobs).set({ slug: renamed.slug, data: renamed }).where(eq(jobs.id, renamed.id));
  const [existingApplication] = await db.select().from(applications).where(eq(applications.id, "historical-application"));
  const linkedApplication: Application = { ...existingApplication.data, id: "existing-fabricator-app", jobId: protectedJob.id, jobTitle: protectedJob.title, reference: "CH-FAIR-HISTORY" };
  await db.insert(applications).values({ id: linkedApplication.id, jobId: linkedApplication.jobId, idempotencyKey: "fair-history", requestHash: "fair-history", data: linkedApplication });
  const beforeCount = (await db.select().from(jobs)).length;
  const [customBefore] = await db.select().from(jobs).where(eq(jobs.id, "staff-custom"));

  await migrateJobFairCatalog(db);
  const result = await db.select().from(jobs);
  assert.equal(result.length, beforeCount);
  const protectedRow = result.find((row) => row.id === protectedJob.id)!;
  assert.equal(protectedRow.status, "closed");
  assert.deepEqual(protectedRow.data, {
    ...protectedJob, description: proposedJobs[0].description, requirements: proposedJobs[0].requirements,
  });
  assert.deepEqual(result.find((row) => row.id === editedDescription.id)?.data, {
    ...editedDescription, requirements: proposedJobs[1].requirements,
  });
  assert.deepEqual(result.find((row) => row.id === editedRequirements.id)?.data, {
    ...editedRequirements, description: proposedJobs[2].description,
  });
  assert.deepEqual(result.find((row) => row.id === renamed.id)?.data, renamed);
  assert.deepEqual(result.find((row) => row.id === "staff-custom"), customBefore);
  assert.deepEqual((await db.select().from(applications).where(eq(applications.id, linkedApplication.id)))[0].data, linkedApplication);

  const laterEdit = { ...protectedRow.data, description: "Updated by staff after enrichment." };
  await db.update(jobs).set({ data: laterEdit }).where(eq(jobs.id, protectedJob.id));
  await migrateJobFairCatalog(db);
  assert.deepEqual((await db.select().from(jobs).where(eq(jobs.id, protectedJob.id)))[0].data, laterEdit);
  assert.equal((await db.select().from(settings).where(eq(settings.key, jobFairCatalogVersion))).length, 1);
  assert.equal((await db.select().from(audits).where(eq(audits.targetId, jobFairCatalogVersion))).length, 1);
});

test("Filipino imagery refresh preserves staff photos, closed roles, custom jobs and linked applications", async () => {
  const db = await getDatabase();
  await db.delete(settings).where(eq(settings.key, filipinoWorkerImageVersion));
  await db.delete(audits).where(eq(audits.targetId, filipinoWorkerImageVersion));
  for (const baseline of proposalV1Jobs) {
    const replacement = proposedJobs.find((job) => job.id === baseline.id)!;
    const previous = { ...replacement, image: baseline.image, imageAlt: baseline.imageAlt };
    await db.update(jobs).set({ slug: previous.slug, status: previous.status, data: previous }).where(eq(jobs.id, previous.id));
  }
  const closed = { ...proposalV1Jobs[0], title: "Reviewed fabricator", status: "closed" as const, salary: "€999–€1,111" };
  const staffPhoto = { ...proposalV1Jobs[1], image: "/images/staff-approved.webp", imageAlt: "Staff approved photo" };
  const renamed = { ...proposalV1Jobs[2], slug: "staff-renamed-pipe-role" };
  for (const job of [closed, staffPhoto, renamed])
    await db.update(jobs).set({ slug: job.slug, status: job.status, data: job }).where(eq(jobs.id, job.id));
  const custom = { ...proposalV1Jobs[3], id: "image-refresh-custom", slug: "image-refresh-custom" };
  await db.insert(jobs).values({ id: custom.id, slug: custom.slug, status: custom.status, data: custom });
  const applicationsBefore = await db.select().from(applications);

  await migrateFilipinoWorkerImages(db);
  const result = await db.select().from(jobs);
  const closedRow = result.find((row) => row.id === closed.id)!;
  assert.equal(closedRow.status, "closed");
  assert.deepEqual(closedRow.data, { ...closed, image: proposedJobs[0].image, imageAlt: proposedJobs[0].imageAlt });
  assert.deepEqual(result.find((row) => row.id === staffPhoto.id)?.data, staffPhoto);
  assert.deepEqual(result.find((row) => row.id === renamed.id)?.data, renamed);
  assert.deepEqual(result.find((row) => row.id === custom.id)?.data, custom);
  assert.deepEqual(await db.select().from(applications), applicationsBefore);
  const normal = proposedJobs[4];
  assert.equal(result.find((row) => row.id === normal.id)?.data.image, normal.image);
  assert.match(normal.image, /\/street-v2\//);
  assert.match(normal.imageAlt, /Filipino/);

  const reviewedAfterRefresh = { ...closedRow.data, image: "/images/new-staff-photo.webp" };
  await db.update(jobs).set({ data: reviewedAfterRefresh }).where(eq(jobs.id, closed.id));
  await migrateFilipinoWorkerImages(db);
  assert.deepEqual((await db.select().from(jobs).where(eq(jobs.id, closed.id)))[0].data, reviewedAfterRefresh);
  assert.equal((await db.select().from(audits).where(eq(audits.targetId, filipinoWorkerImageVersion))).length, 1);
});

test("Street imagery upgrades both known image generations without changing staff uploads or applicant history", async () => {
  const db = await getDatabase();
  await db.delete(settings).where(eq(settings.key, streetWorkerImageVersion));
  await db.delete(audits).where(eq(audits.targetId, streetWorkerImageVersion));
  const originalRows = await db.select().from(jobs);
  const applicationsBefore = await db.select().from(applications);
  const originalCatalogPhoto: Job = {
    ...proposedJobs[0], image: `/images/jobs/proposed/${proposedJobs[0].slug}.webp`,
    imageAlt: "Original proposal illustration", title: "Staff reviewed fabricator",
    status: "closed", salary: "€1,234", imagePosition: "72% 30%", summary: "Keep the staff summary",
  };
  const filipinoCatalogPhoto: Job = {
    ...proposedJobs[1], image: `/images/jobs/filipino/${proposedJobs[1].slug}.webp`,
    imageAlt: "Earlier Filipino worker illustration", requirements: ["Staff requirement"],
  };
  const staffUpload: Job = {
    ...proposedJobs[2], image: "/api/images/12345678-1234-1234-1234-123456789abc.jpg", imageAlt: "Staff uploaded photograph",
  };
  const staffLocalPhoto: Job = {
    ...proposedJobs[3], image: "/images/staff-reviewed.webp", imageAlt: "Staff local photograph",
  };
  const renamed: Job = {
    ...proposedJobs[4], slug: "staff-renamed-street-role",
    image: `/images/jobs/filipino/${proposedJobs[4].slug}.webp`,
  };
  const custom: Job = {
    ...proposedJobs[5], id: "street-image-custom", slug: "street-image-custom",
    image: `/images/jobs/filipino/${proposedJobs[5].slug}.webp`,
  };
  try {
    for (const job of [originalCatalogPhoto, filipinoCatalogPhoto, staffUpload, staffLocalPhoto, renamed])
      await db.update(jobs).set({ slug: job.slug, status: job.status, data: job }).where(eq(jobs.id, job.id));
    await db.insert(jobs).values({ id: custom.id, slug: custom.slug, status: custom.status, data: custom });
    await migrateStreetWorkerImages(db);
    const result = await db.select().from(jobs);
    for (const original of [originalCatalogPhoto, filipinoCatalogPhoto]) {
      const replacement = proposedJobs.find((job) => job.id === original.id)!;
      const row = result.find((item) => item.id === original.id)!;
      assert.equal(row.status, original.status);
      assert.deepEqual(row.data, { ...original, image: replacement.image, imageAlt: replacement.imageAlt });
    }
    for (const preserved of [staffUpload, staffLocalPhoto, renamed, custom])
      assert.deepEqual(result.find((row) => row.id === preserved.id)?.data, preserved);
    assert.deepEqual(await db.select().from(applications), applicationsBefore);
    assert.equal((await db.select().from(settings).where(eq(settings.key, streetWorkerImageVersion))).length, 1);
    const [audit] = await db.select().from(audits).where(eq(audits.targetId, streetWorkerImageVersion));
    assert.deepEqual(audit.details, {
      updatedIds: [originalCatalogPhoto.id, filipinoCatalogPhoto.id], fields: ["image", "imageAlt"],
    });

    const laterStaffEdit = { ...originalCatalogPhoto, image: "/images/staff-after-street-refresh.webp" };
    await db.update(jobs).set({ data: laterStaffEdit }).where(eq(jobs.id, laterStaffEdit.id));
    await migrateStreetWorkerImages(db);
    assert.deepEqual((await db.select().from(jobs).where(eq(jobs.id, laterStaffEdit.id)))[0].data, laterStaffEdit);
    assert.equal((await db.select().from(audits).where(eq(audits.targetId, streetWorkerImageVersion))).length, 1);
  } finally {
    await db.delete(jobs).where(eq(jobs.id, custom.id));
    for (const row of originalRows)
      await db.update(jobs).set({ slug: row.slug, status: row.status, data: row.data }).where(eq(jobs.id, row.id));
  }
});

test("hiring copy migration removes original event copy without changing staff terms or application records", async () => {
  const db = await getDatabase();
  await db.delete(settings).where(eq(settings.key, hiringContentVersion));
  await db.delete(audits).where(eq(audits.targetId, hiringContentVersion));
  const original = { ...previousRecruitmentJobs[0], title: "Staff reviewed title", status: "closed" as const,
    salary: "€1,234", image: "/images/staff-photo.webp", benefits: ["Staff meal allowance"] };
  const edited = { ...previousRecruitmentJobs[1], description: "Staff-written overview", requirements: ["Staff requirement"], location: "Split, Croatia" };
  const renamed = { ...previousRecruitmentJobs[2], slug: "staff-renamed-hiring-role" };
  for (const job of [original, edited, renamed])
    await db.update(jobs).set({ slug: job.slug, status: job.status, data: job }).where(eq(jobs.id, job.id));
  const beforeApplications = await db.select().from(applications);
  const [customBefore] = await db.select().from(jobs).where(eq(jobs.id, "staff-custom"));
  await migrateHiringContent(db);
  const result = await db.select().from(jobs);
  const refreshed = result.find((row) => row.id === original.id)!;
  assert.equal(refreshed.status, "closed");
  assert.deepEqual(refreshed.data, { ...original, description: proposedJobs[0].description,
    requirements: proposedJobs[0].requirements, location: "Croatia", benefits: [...proposedJobs[0].benefits, "Staff meal allowance"] });
  assert.deepEqual(result.find((row) => row.id === edited.id)?.data, { ...edited, benefits: proposedJobs[1].benefits });
  assert.deepEqual(result.find((row) => row.id === renamed.id)?.data, renamed);
  assert.deepEqual(result.find((row) => row.id === "staff-custom"), customBefore);
  assert.deepEqual(await db.select().from(applications), beforeApplications);
  for (const job of proposedJobs) {
    assert.doesNotMatch([job.description, ...job.requirements].join(" "), /job fair|proposed net/i);
    assert.ok(job.benefits.includes("Free accommodation."));
    assert.ok(job.benefits.some((item) => /30%.*holiday and Sunday/.test(item)));
  }
  await db.update(jobs).set({ data: { ...refreshed.data, description: "Later staff edit" } }).where(eq(jobs.id, original.id));
  await migrateHiringContent(db);
  assert.equal((await db.select().from(jobs).where(eq(jobs.id, original.id)))[0].data.description, "Later staff edit");
  assert.equal((await db.select().from(audits).where(eq(audits.targetId, hiringContentVersion))).length, 1);
});

test("minimum experience migration preserves staff requirements, higher thresholds and historical applicants", async () => {
  const db = await getDatabase();
  await db.delete(settings).where(eq(settings.key, minimumExperienceVersion));
  await db.delete(audits).where(eq(audits.targetId, minimumExperienceVersion));
  const original = { ...proposedJobs[0], title: "Reviewed experience role", status: "closed" as const,
    experience: proposalV1Jobs[0].experience, image: "/images/staff-experience-photo.webp",
    requirements: ["Staff-approved trade qualification"] };
  const higher = { ...proposedJobs[1], experience: "Minimum 5 years of relevant experience", requirements: ["Staff welding assessment"] };
  for (const job of [original, higher])
    await db.update(jobs).set({ slug: job.slug, status: job.status, data: job }).where(eq(jobs.id, job.id));
  const beforeApplications = await db.select().from(applications);
  await migrateMinimumExperience(db);
  const [updated] = await db.select().from(jobs).where(eq(jobs.id, original.id));
  assert.deepEqual(updated.data, { ...original, experience: proposedJobs[0].experience, requirements: [minimumExperienceRequirement, ...original.requirements] });
  assert.equal(updated.status, "closed");
  const [higherAfter] = await db.select().from(jobs).where(eq(jobs.id, higher.id));
  assert.equal(higherAfter.data.experience, higher.experience);
  assert.deepEqual(higherAfter.data.requirements, [minimumExperienceRequirement, ...higher.requirements]);
  assert.deepEqual(await db.select().from(applications), beforeApplications);
  await migrateMinimumExperience(db);
  assert.equal((await db.select().from(audits).where(eq(audits.targetId, minimumExperienceVersion))).length, 1);
});

test("worker count migration updates only matching role totals and preserves staff content and applicant history", async () => {
  const db = await getDatabase();
  await db.delete(settings).where(eq(settings.key, hiringWorkerCountsVersion));
  await db.delete(audits).where(eq(audits.targetId, hiringWorkerCountsVersion));
  const original: Job = { ...proposalV1Jobs[0], title: "Staff-reviewed fabricator", salary: "€999–€1,111", status: "closed", image: "/images/staff-photo.webp" };
  const renamed = { ...proposalV1Jobs[1], slug: "staff-renamed-counts-role" };
  const custom = { ...proposalV1Jobs[2], id: "worker-counts-custom", slug: "worker-counts-custom", openings: 77 };
  for (const job of [original, renamed])
    await db.update(jobs).set({ slug: job.slug, status: job.status, data: job }).where(eq(jobs.id, job.id));
  await db.insert(jobs).values({ id: custom.id, slug: custom.slug, status: custom.status, data: custom });
  const beforeApplications = await db.select().from(applications);
  const beforeCount = (await db.select().from(jobs)).length;
  await migrateHiringWorkerCounts(db);
  const result = await db.select().from(jobs);
  const updated = result.find((row) => row.id === original.id)!;
  assert.equal(result.length, beforeCount);
  assert.equal(updated.status, "closed");
  assert.deepEqual(updated.data, { ...original, openings: 1150 });
  assert.deepEqual(result.find((row) => row.id === renamed.id)?.data, renamed);
  assert.deepEqual(result.find((row) => row.id === custom.id)?.data, custom);
  assert.deepEqual(await db.select().from(applications), beforeApplications);
  const laterEdit = { ...updated.data, openings: 1100 };
  await db.update(jobs).set({ data: laterEdit }).where(eq(jobs.id, original.id));
  await migrateHiringWorkerCounts(db);
  assert.deepEqual((await db.select().from(jobs).where(eq(jobs.id, original.id)))[0].data, laterEdit);
  assert.equal((await db.select().from(audits).where(eq(audits.targetId, hiringWorkerCountsVersion))).length, 1);
});

test("age requirement migration preserves job details and historical applications and runs once", async () => {
  const db = await getDatabase();
  await db.delete(settings).where(eq(settings.key, maximumAgeRequirementVersion));
  await db.delete(audits).where(eq(audits.targetId, maximumAgeRequirementVersion));
  const original: Job = { ...proposedJobs[0], title: "Staff-reviewed role", status: "closed", salary: "€999", requirements: ["Staff-approved certification"] };
  const renamed = { ...proposedJobs[1], slug: "staff-renamed-age-role", requirements: ["Staff requirement"] };
  const custom = { ...proposedJobs[2], id: "age-requirement-custom", slug: "age-requirement-custom", requirements: ["Custom requirement"] };
  for (const job of [original, renamed])
    await db.update(jobs).set({ slug: job.slug, status: job.status, data: job }).where(eq(jobs.id, job.id));
  await db.insert(jobs).values({ id: custom.id, slug: custom.slug, status: custom.status, data: custom });
  const beforeApplications = await db.select().from(applications);
  const beforeCount = (await db.select().from(jobs)).length;
  await migrateMaximumAgeRequirement(db);
  const result = await db.select().from(jobs);
  assert.equal(result.length, beforeCount);
  const updated = result.find((row) => row.id === original.id)!;
  assert.equal(updated.status, "closed");
  assert.deepEqual(updated.data, { ...original, requirements: [maximumAgeRequirement, ...original.requirements] });
  assert.deepEqual(result.find((row) => row.id === renamed.id)?.data, renamed);
  assert.deepEqual(result.find((row) => row.id === custom.id)?.data, custom);
  assert.deepEqual(await db.select().from(applications), beforeApplications);
  await migrateMaximumAgeRequirement(db);
  assert.deepEqual((await db.select().from(jobs).where(eq(jobs.id, original.id)))[0].data, updated.data);
  assert.equal((await db.select().from(audits).where(eq(audits.targetId, maximumAgeRequirementVersion))).length, 1);
});
