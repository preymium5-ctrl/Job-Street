import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { publishedCatalogJobs } from "../data/catalog";
import { jobOrderJobs, jobOrderReleases, printingPressOperatorJob, trailerTruckDriverAgeRequirement, trailerTruckDriverJob } from "../data/job-orders";
import { jobOrderRolesVersion, migrateJobOrderRoles, trailerTruckDriverCzechVersion } from "../lib/catalog-migration";
import { closeDatabase, getDatabase } from "../lib/db";
import { jobs, settings } from "../lib/schema";
import { jobSchema } from "../lib/validation";

const originalEnv = { ...process.env };
let directory: string;
let scenario = 0;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "chapter-job-order-roles-"));
  Object.assign(process.env, { NODE_ENV: "test", CHAPTER_LOCAL_MODE: "true" });
  delete process.env.DATABASE_URL;
});
beforeEach(async () => {
  await closeDatabase();
  process.env.DATA_DIR = path.join(directory, String(++scenario));
});
after(async () => {
  await closeDatabase();
  if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) ||
      !path.basename(directory).startsWith("chapter-job-order-roles-"))
    throw new Error("Unexpected job order test cleanup path.");
  await rm(directory, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

test("the printing press operator job order is published with the supplied salary and positions", () => {
  const job = printingPressOperatorJob;
  assert.equal(jobSchema.safeParse(job).success, true);
  assert.equal(job.salary, "€850–€1,000");
  assert.equal(job.salaryStatus, "proposed-net");
  assert.equal(job.openings, 100);
  assert.equal(job.location, "Croatia");
  assert.equal(publishedCatalogJobs.filter(({ slug }) => slug === job.slug).length, 1);
});

test("job order roles are added once and never replace a staff record", async () => {
  const db = await getDatabase();
  const staff = { ...printingPressOperatorJob, title: "Staff title", salary: "€1,111" };
  await db.insert(jobs).values({ id: staff.id, slug: staff.slug, status: staff.status, data: staff });
  await migrateJobOrderRoles(db);
  const rows = await db.select().from(jobs);
  assert.equal(rows.find(({ id }) => id === staff.id)?.data.title, "Staff title");
  const keys = (await db.select().from(settings)).map(({ key }) => key);
  assert.ok(keys.includes(jobOrderRolesVersion));
  for (const { version } of jobOrderReleases) assert.ok(keys.includes(version));
});

test("job order roles are inserted into an existing catalog", async () => {
  const db = await getDatabase();
  await migrateJobOrderRoles(db);
  await migrateJobOrderRoles(db);
  const rows = await db.select().from(jobs);
  assert.deepEqual(rows.map(({ id }) => id).sort(), jobOrderJobs.map(({ id }) => id).sort());
  assert.equal(rows.find(({ id }) => id === printingPressOperatorJob.id)?.data.salary, "€850–€1,000");
  assert.equal(rows.find(({ id }) => id === trailerTruckDriverJob.id)?.data.salary, "€2,000");
});

test("the trailer truck driver job order is published with the supplied salary and experience", () => {
  const job = trailerTruckDriverJob;
  assert.equal(jobSchema.safeParse(job).success, true);
  assert.equal(job.salary, "€2,000");
  assert.equal(job.salaryStatus, "proposed-net");
  assert.equal(job.experience, "5–10 years as a trailer truck driver");
  assert.equal(job.location, "Czech Republic");
  assert.equal(trailerTruckDriverAgeRequirement, "Applicants must be 50 years old or below.");
  assert.equal(job.requirements[0], trailerTruckDriverAgeRequirement);
  assert.ok(!/croatia/i.test([job.description, ...job.requirements].join(" ")));
  assert.equal(publishedCatalogJobs.filter(({ slug }) => slug === job.slug).length, 1);
});

test("a later job order release reaches a database where earlier releases already ran", async () => {
  const db = await getDatabase();
  await db.insert(jobs).values({ id: printingPressOperatorJob.id, slug: printingPressOperatorJob.slug, status: "published", data: printingPressOperatorJob });
  await db.insert(settings).values({ key: jobOrderReleases[0].version, value: new Date().toISOString() });
  await migrateJobOrderRoles(db);
  const rows = await db.select().from(jobs);
  assert.deepEqual(rows.map(({ id }) => id).sort(), [printingPressOperatorJob.id, trailerTruckDriverJob.id].sort());
});

test("a stored Croatia trailer truck driver record moves to the Czech Republic once, keeping staff location edits", async () => {
  const db = await getDatabase();
  const stored = { ...trailerTruckDriverJob, location: "Croatia", requirements: trailerTruckDriverJob.requirements.slice(1), salary: "€2,000" };
  await db.insert(jobs).values({ id: stored.id, slug: stored.slug, status: "published", data: stored });
  await migrateJobOrderRoles(db);
  const [moved] = (await db.select().from(jobs)).filter(({ id }) => id === stored.id);
  assert.equal(moved.data.location, "Czech Republic");
  assert.equal(moved.data.requirements[0], trailerTruckDriverAgeRequirement);
  assert.ok((await db.select().from(settings)).some(({ key }) => key === trailerTruckDriverCzechVersion));
});

test("the Czech Republic move leaves a staff-chosen trailer truck driver location alone", async () => {
  const db = await getDatabase();
  const staff = { ...trailerTruckDriverJob, location: "Slovenia" };
  await db.insert(jobs).values({ id: staff.id, slug: staff.slug, status: "published", data: staff });
  await migrateJobOrderRoles(db);
  const [row] = (await db.select().from(jobs)).filter(({ id }) => id === staff.id);
  assert.equal(row.data.location, "Slovenia");
});
