import assert from "node:assert/strict";
import { test } from "node:test";
import { proposedJobs } from "../data/jobs";
import { additionalApplicationJobs } from "../data/application-jobs";
import { formatOpeningRange, getJobOpeningRange, getTotalOpeningRange } from "../lib/job-openings";
import { jobSchema } from "../lib/validation";

test("directory totals include every new role's slot range and retain existing exact counts", () => {
  const total = getTotalOpeningRange([...proposedJobs, ...additionalApplicationJobs]);
  assert.deepEqual(total, { min: 35350, max: 127500 });
  assert.equal(formatOpeningRange(total!), "35,350–127,500");
  assert.equal(formatOpeningRange(getJobOpeningRange(additionalApplicationJobs[0])!), "250–1,200");
  assert.deepEqual(getJobOpeningRange({ openings: 1150 }), { min: 1150, max: 1150 });
  assert.equal(getJobOpeningRange({}), null);
});

test("job validation preserves slot ranges and rejects reversed or conflicting counts", () => {
  const role = additionalApplicationJobs[0];
  assert.deepEqual(jobSchema.parse(role).openingsRange, { min: 250, max: 1200 });
  for (const openingsRange of [{ min: 1200, max: 250 }, { min: 0, max: 1200 }, { min: 250.5, max: 1200 }])
    assert.equal(jobSchema.safeParse({ ...role, openingsRange }).success, false);
  assert.equal(jobSchema.safeParse({ ...role, openings: 500 }).success, false);
});
