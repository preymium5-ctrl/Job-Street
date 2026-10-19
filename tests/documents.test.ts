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
import { readObject, validateResume, validateSupportingDocument } from "../lib/storage";
import { drainSheetsQueue } from "../lib/sheets-queue";
import type { ApplicationDocument } from "../lib/types";
import { MAX_REFERENCE_FILE_BYTES, MAX_REFERENCE_UPLOAD_BYTES, referenceApplicationUploads } from "../lib/document-uploads";
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

test("applications privately retain optional identity and work documents while legacy Google exports keep supported files", async () => {
  const job = (await getJobs())[0];
  const input = { jobId: job.id, fullName: "Document Test Applicant", email: "documents@example.test", phone: "+639171234567", country: "Philippines", recentJobTitle: "Fabricator", experienceYears: 3, skills: "Fabrication", education: "School diploma", summary: "", coverLetter: "", driverLicenseDetails: "Non-professional license, Philippines", consent: true };
  const key = randomUUID();
  function request(changed?: "driver-license" | "passport", duplicate = false) {
    const form = new FormData(); form.set("payload", JSON.stringify(input)); form.set("idempotencyKey", key); form.set("resume", new File([pdf], "cv.pdf"));
    form.append("document:diploma", new File([pdf], "diploma.pdf"));
    form.append("document:other", new File([pdf], "training.pdf"));
    form.append("document:driver-license", new File([changed === "driver-license" ? Buffer.from("%PDF-1.4\nchanged\n%%EOF") : pdf], "driver-license.pdf"));
    form.append("document:passport", new File([changed === "passport" ? Buffer.from("%PDF-1.4\nchanged\n%%EOF") : pdf], "passport.pdf"));
    form.append("document:residence-id", new File([pdf], "residence-front-and-back.pdf"));
    form.append("document:employment-certificate", new File([pdf], "employment-certificate.pdf"));
    if (duplicate) form.append("document:passport", new File([pdf], "extra-passport.pdf"));
    return new NextRequest(`${origin}/api/applications`, { method: "POST", headers: { origin }, body: form });
  }
  assert.equal((await submit(request(undefined, true))).status, 422);
  assert.equal((await getApplications()).length, 0);
  const accepted = await submit(request()); assert.equal(accepted.status, 201);
  const receipt = await accepted.json();
  assert.equal((await submit(request())).status, 200);
  assert.equal((await submit(request("driver-license"))).status, 409);
  assert.equal((await submit(request("passport"))).status, 409);
  const records = await getApplications(); assert.equal(records.length, 1);
  const application = records[0]; assert.equal(application.reference, receipt.reference);
  assert.equal(application.documents?.length, 6);
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
  for (const category of ["passport", "residence-id", "employment-certificate"] as const) {
    const document: ApplicationDocument | undefined = application.documents!.find((item) => item.category === category);
    assert.ok(document, `${category} is retained in the application`);
    assert.deepEqual(await readObject(document.key), pdf);
    const documentUrl: string = `${origin}/api/admin/applications/${application.id}/documents/${document.id}`;
    const documentParams: { params: Promise<{ id: string; documentId: string }> } = { params: Promise.resolve({ id: application.id, documentId: document.id }) };
    assert.equal((await download(new NextRequest(documentUrl), documentParams)).status, 401);
    const privateDownload = await download(new NextRequest(documentUrl, { headers: { cookie } }), documentParams);
    assert.equal(privateDownload.status, 200);
    assert.match(privateDownload.headers.get("cache-control")!, /no-store/);
    assert.deepEqual(Buffer.from(await privateDownload.arrayBuffer()), pdf);
  }
  assert.equal((await download(new NextRequest(url, { headers: { cookie } }), { params: Promise.resolve({ id: application.id, documentId: randomUUID() }) })).status, 404);
  assert.ok((await (await getDatabase()).select().from(audits)).some((row) => row.action === "document.downloaded" && row.details.documentId === diploma.id));
  const delivered = await drainSheetsQueue({ applicationId: application.id }, { transport: async (payload) => {
    assert.equal(payload.version, 2); assert.equal(payload.documents?.length, 3);
    assert.equal(payload.application.driverLicenseDetails, input.driverLicenseDetails);
    assert.ok(payload.documents?.some((document) => document.category === "driver-license"));
    assert.ok(payload.documents?.every((document) => !["passport", "residence-id", "employment-certificate"].includes(document.category)));
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

test("reference form requires three private uploads, enforces its smaller limits and preserves exact retries", async () => {
  const job = (await getJobs())[0];
  const input = {
    applicationFormVersion: 2, destinationCountry: "Croatia", termsAccepted: true,
    jobId: job.id, fullName: "Modern Applicant", email: "modern-documents@example.test", phone: "+639171234567", country: "Philippines", consent: true,
    applicantDetails: { firstName: "Modern", lastName: "Applicant", gender: "Male", nationality: "Filipino",
      street: "123 Test Street", city: "Test City", province: "Test Province", postalCode: "1234",
      currentAddress: "123 Test Street, Test City, Test Province, 1234", dateOfBirth: "1992-02-29", placeOfBirth: "Test city", secondaryPosition: "No other position", englishProficiency: "No" },
  };
  const key = randomUUID();
  function request(files: Record<string, Buffer | undefined> = {}, requestKey = key, duplicatePassport = false, jobId = job.id) {
    const form = new FormData();
    form.set("payload", JSON.stringify({ ...input, jobId }));
    form.set("idempotencyKey", requestKey);
    const uploads = { resume: pdf, "document:passport": pdf, "document:residence-id": pdf, ...files };
    for (const [field, bytes] of Object.entries(uploads)) if (bytes !== undefined) form.append(field, new File([new Uint8Array(bytes)], `${field.replace(":", "-")}.pdf`));
    if (duplicatePassport) form.append("document:passport", new File([pdf], "second-passport.pdf"));
    return new NextRequest(`${origin}/api/applications`, { method: "POST", headers: { origin }, body: form });
  }
  function sizedPdf(size: number) {
    const bytes = Buffer.alloc(size, " "); bytes.write("%PDF-1.4\n"); bytes.write("\n%%EOF\n", size - 8); return bytes;
  }
  assert.equal(MAX_REFERENCE_UPLOAD_BYTES, 4 * 1024 * 1024);
  assert.deepEqual(referenceApplicationUploads.filter(({ required }) => required).map(({ id }) => id), ["resume", "passport", "residence-id"]);
  const beforeCount = (await getApplications()).length;
  for (const field of ["resume", "document:passport", "document:residence-id"]) {
    const response = await submit(request({ [field]: undefined }));
    assert.equal(response.status, 422);
    assert.ok((await response.json()).fieldErrors[field]);
  }
  const oversized = sizedPdf(MAX_REFERENCE_FILE_BYTES + 1);
  assert.equal((await validateResume(new File([new Uint8Array(oversized)], "legacy-cv.pdf"))).bytes.length, oversized.length);
  for (const field of ["resume", "document:passport"]) {
    const response = await submit(request({ [field]: oversized }));
    assert.equal(response.status, 422);
    assert.match((await response.json()).fieldErrors[field], /3 MB/);
  }
  const totalLimit = await submit(request({ resume: sizedPdf(2 * 1024 * 1024), "document:passport": sizedPdf(2 * 1024 * 1024) }));
  assert.equal(totalLimit.status, 422);
  assert.match((await totalLimit.json()).fieldErrors.documents, /4 MB/);
  const other = await submit(request({ "document:other": pdf }));
  assert.equal(other.status, 422);
  assert.match((await other.json()).fieldErrors.documents, /not collected/);
  const duplicate = await submit(request({}, key, true));
  assert.equal(duplicate.status, 422);
  assert.match((await duplicate.json()).fieldErrors["document:passport"], /one file/);
  assert.equal((await getApplications()).length, beforeCount);

  const accepted = await submit(request()); assert.equal(accepted.status, 201);
  const receipt = await accepted.json();
  assert.equal((await submit(request())).status, 200);
  assert.equal((await submit(request({ "document:passport": Buffer.from("%PDF-1.4\nchanged passport\n%%EOF\n") }))).status, 409);
  const application = (await getApplications()).find((record) => record.reference === receipt.reference)!;
  assert.equal(application.applicationFormVersion, 2);
  assert.equal(application.recentJobTitle, ""); assert.equal(application.skills, ""); assert.equal(application.experienceYears, 0);
  assert.deepEqual(application.documents?.map(({ category }) => category), ["passport", "residence-id"]);
  for (const document of application.documents || []) {
    assert.deepEqual(await readObject(document.key), pdf);
    const url = `${origin}/api/admin/applications/${application.id}/documents/${document.id}`;
    assert.equal((await download(new NextRequest(url), { params: Promise.resolve({ id: application.id, documentId: document.id }) })).status, 401);
  }
  const delivered = await drainSheetsQueue({ applicationId: application.id }, { transport: async (payload) => {
    assert.equal(payload.version, 1); assert.equal(payload.documents, undefined);
    for (const field of ["applicationFormVersion", "destinationCountry", "termsAccepted", "applicantDetails"]) assert.equal(Object.hasOwn(payload.application, field), false);
    assert.equal(payload.application.recentJobTitle, "Not collected by this form");
    assert.equal(payload.application.skills, "Not collected by this form");
    return { ok: true, applicationId: application.id, reference: application.reference, row: 3, duplicate: false };
  } });
  assert.equal(delivered.delivered, 1);

  const customId = randomUUID();
  await saveJob({ ...job, id: customId, slug: `modern-custom-${customId}`, title: "Modern custom role" }, "test-staff", true);
  const optionalLicense = await submit(request({ "document:driver-license": pdf }, randomUUID(), false, customId));
  assert.equal(optionalLicense.status, 201);
});
