import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { closeDatabase, getDatabase } from "../lib/db";
import { getApplications, getJobs, saveJob } from "../lib/repository";
import { administrators, audits } from "../lib/schema";
import { hashPassword } from "../lib/auth";
import { readObject, validateSupportingDocument } from "../lib/storage";
import { drainSheetsQueue } from "../lib/sheets-queue";
import { POST as submit } from "../app/api/applications/route";
import { POST as signIn } from "../app/api/admin/session/route";
import { GET as download } from "../app/api/admin/applications/[id]/documents/[documentId]/route";

const original = { ...process.env };
const origin = "http://localhost:3000";
const pdf = Buffer.from("%PDF-1.4\nSynthetic supporting document\n%%EOF\n");
let directory = "";
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "chapter-documents-test-"));
  Object.assign(process.env, { NODE_ENV: "test", DATA_DIR: directory, CHAPTER_LOCAL_MODE: "true", APP_ORIGIN: origin, SESSION_SECRET: "documents-test-secret-".repeat(4) });
  for (const key of ["DATABASE_URL", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "GOOGLE_SHEETS_WEBHOOK_URL", "GOOGLE_SHEETS_WEBHOOK_SECRET"]) delete process.env[key];
});
after(async () => {
  await closeDatabase();
  if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(directory).startsWith("chapter-documents-test-")) throw new Error("Unexpected test directory");
  await rm(directory, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
});

test("supporting uploads validate real bytes and sanitize scans", async () => {
  assert.equal((await validateSupportingDocument(new File([pdf], "diploma.pdf"))).mime, "application/pdf");
  await assert.rejects(validateSupportingDocument(new File([Buffer.from("not a scan")], "diploma.png")));
  await assert.rejects(validateSupportingDocument(new File([Buffer.alloc(3 * 1024 * 1024 + 1)], "diploma.pdf")));
  await assert.rejects(validateSupportingDocument(new File([pdf], "diploma.exe")));
  const png = await sharp({ create: { width: 100, height: 80, channels: 3, background: "white" } }).png().toBuffer();
  const image = await validateSupportingDocument(new File([new Uint8Array(png)], "school.png"));
  assert.equal(image.mime, "image/jpeg"); assert.equal(image.name, "school.jpg");
  assert.equal((await sharp(image.bytes).metadata()).format, "jpeg");
});

test("applications retain diploma and other files, reject changed retries, authorize downloads and queue private Google delivery", async () => {
  const job = (await getJobs())[0];
  const input = { jobId: job.id, fullName: "Document Test Applicant", email: "documents@example.test", phone: "+639171234567", country: "Philippines", recentJobTitle: "Fabricator", experienceYears: 3, skills: "Fabrication", education: "School diploma", summary: "", coverLetter: "", driverLicenseDetails: "Non-professional license, Philippines", consent: true };
  const key = randomUUID();
  function request(changed = false, duplicate = false) {
    const form = new FormData(); form.set("payload", JSON.stringify(input)); form.set("idempotencyKey", key); form.set("resume", new File([pdf], "cv.pdf"));
    form.append("document:diploma", new File([pdf], "diploma.pdf"));
    form.append("document:other", new File([pdf], "training.pdf"));
    form.append("document:driver-license", new File([changed ? Buffer.from("%PDF-1.4\nchanged\n%%EOF") : pdf], "driver-license.pdf"));
    if (duplicate) form.append("document:other", new File([pdf], "extra.pdf"));
    return new NextRequest(`${origin}/api/applications`, { method: "POST", headers: { origin }, body: form });
  }
  assert.equal((await submit(request(false, true))).status, 422);
  assert.equal((await getApplications()).length, 0);
  const accepted = await submit(request()); assert.equal(accepted.status, 201);
  const receipt = await accepted.json();
  assert.equal((await submit(request())).status, 200);
  assert.equal((await submit(request(true))).status, 409);
  const records = await getApplications(); assert.equal(records.length, 1);
  const application = records[0]; assert.equal(application.reference, receipt.reference);
  assert.equal(application.documents?.length, 3);
  assert.equal(application.driverLicenseDetails, input.driverLicenseDetails);
  const diploma = application.documents![0]; assert.equal(diploma.category, "diploma");
  assert.deepEqual(await readObject(diploma.key), pdf);
  const url = `${origin}/api/admin/applications/${application.id}/documents/${diploma.id}`;
  const params = { params: Promise.resolve({ id: application.id, documentId: diploma.id }) };
  assert.equal((await download(new NextRequest(url), params)).status, 401);
  const password = "private document test password";
  await (await getDatabase()).insert(administrators).values({ id: randomUUID(), email: "documents.staff@example.test", passwordHash: await hashPassword(password) });
  const login = await signIn(new NextRequest(`${origin}/api/admin/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: "documents.staff@example.test", password }) }));
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const response = await download(new NextRequest(url, { headers: { cookie } }), params);
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  const license = application.documents!.find((document) => document.category === "driver-license")!;
  const licenseParams = { params: Promise.resolve({ id: application.id, documentId: license.id }) };
  assert.equal((await download(new NextRequest(url), licenseParams)).status, 401);
  const licenseDownload = await download(new NextRequest(url, { headers: { cookie } }), licenseParams);
  assert.equal(licenseDownload.status, 200);
  assert.deepEqual(Buffer.from(await licenseDownload.arrayBuffer()), pdf);
  assert.equal((await download(new NextRequest(url, { headers: { cookie } }), { params: Promise.resolve({ id: application.id, documentId: randomUUID() }) })).status, 404);
  assert.ok((await (await getDatabase()).select().from(audits)).some((row) => row.action === "document.downloaded" && row.details.documentId === diploma.id));
  const delivered = await drainSheetsQueue({ applicationId: application.id }, { transport: async (payload) => {
    assert.equal(payload.version, 2); assert.equal(payload.documents?.length, 3);
    assert.equal(payload.application.driverLicenseDetails, input.driverLicenseDetails);
    assert.ok(payload.documents?.some((document) => document.category === "driver-license"));
    assert.equal("documents" in payload.application, false);
    assert.ok(!JSON.stringify(payload).includes(diploma.key));
    assert.equal(payload.documents![0].base64, pdf.toString("base64"));
    return { ok: true, applicationId: application.id, reference: application.reference, row: 2, duplicate: false };
  } });
  assert.equal(delivered.delivered, 1);
});

test("driver license collection is restricted to the PDF roles, including attachment-only requests", async () => {
  const originalJob = (await getJobs())[0];
  const id = randomUUID();
  await saveJob({ ...originalJob, id, slug: `custom-${id}`, title: "Custom vacancy" }, "test-staff", true);
  const count = (await getApplications()).length;
  for (const attachment of [false, true]) {
    const form = new FormData();
    form.set("payload", JSON.stringify({ jobId: id, fullName: "License Scope Test", email: "license-scope@example.test", phone: "+639171234567", country: "Philippines", recentJobTitle: "Fabricator", experienceYears: 3, skills: "Fabrication", consent: true, ...(!attachment ? { driverLicenseDetails: "License, Philippines" } : {}) }));
    form.set("resume", new File([pdf], "cv.pdf")); form.set("idempotencyKey", randomUUID());
    if (attachment) form.set("document:driver-license", new File([pdf], "license.pdf"));
    const response = await submit(new NextRequest(`${origin}/api/applications`, { method: "POST", headers: { origin }, body: form }));
    assert.equal(response.status, 422);
    assert.match((await response.json()).fieldErrors.driverLicenseDetails, /this position/);
  }
  assert.equal((await getApplications()).length, count);
});
