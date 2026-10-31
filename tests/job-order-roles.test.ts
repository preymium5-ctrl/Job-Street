import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { publishedCatalogJobs } from "../data/catalog";
import { jobOrderJobs, printingPressOperatorJob } from "../data/job-orders";
import { jobOrderRolesVersion, migrateJobOrderRoles } from "../lib/catalog-migration";
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
  const [row] = await db.select().from(jobs);
  assert.equal(row.data.title, "Staff title");
  assert.ok((await db.select().from(settings)).some(({ key }) => key === jobOrderRolesVersion));
});

test("job order roles are inserted into an existing catalog", async () => {
  const db = await getDatabase();
  await migrateJobOrderRoles(db);
  await migrateJobOrderRoles(db);
  const rows = await db.select().from(jobs);
  assert.deepEqual(rows.map(({ id }) => id).sort(), jobOrderJobs.map(({ id }) => id).sort());
  assert.equal(rows[0].data.salary, "€850–€1,000");
});
