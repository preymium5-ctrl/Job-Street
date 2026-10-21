import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as submit } from "../app/api/applications/route";
import { proposedJobs } from "../data/jobs";
import { additionalApplicationJobs } from "../data/application-jobs";
import { getDatabase, localModeAllowed } from "../lib/db";
import { requireStorageConfiguration } from "../lib/storage";
import { referenceApplicationUploads, type SupportingDocumentCategory } from "../lib/document-uploads";
import type { SheetsPayload } from "../lib/sheets-transport";
import { formatApplicantAddress } from "../lib/applicant-address";
import { usesGoogleApplicationStorage } from "../lib/google-application-storage";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const origin = "https://application.example.test";
const webhook = "https://script.google.com/macros/s/synthetic-receiver/exec";
const secret = "synthetic-test-secret-with-at-least-32-characters";
const pdf = Buffer.from("%PDF-1.4\nSynthetic application document\n%%EOF\n");
const officialJob = proposedJobs.find(({ slug }) => slug === "fabricator")!;
const additionalJob = additionalApplicationJobs.find(({ title }) => !/driver/i.test(title))!;
const driverJob = [...proposedJobs, ...additionalApplicationJobs].find(({ title }) => /\bdriver\b/i.test(title))!;
const received: SheetsPayload[] = [];
const records = new Map<string, string>();
let receiver: (payload: SheetsPayload) => Response | Promise<Response>;

function values(jobId = officialJob.id) {
  const address = { street: "17 Sample Street", city: "Manila", province: "Metro Manila", postalCode: "0017" };
  return {
    applicationFormVersion: 2, destinationCountry: "North Macedonia", termsAccepted: true,
    jobId, fullName: "Synthetic Applicant", email: "synthetic@example.test", phone: "+639171234567",
    country: "Philippines", discoverySource: "Facebook", consent: true,
    applicantDetails: {
      firstName: "Synthetic", lastName: "Applicant", gender: "Female", telegram: "@synthetic",
      ...address, currentAddress: formatApplicantAddress(address), dateOfBirth: "1994-02-28", placeOfBirth: "Manila",
      fatherName: "Synthetic Father", motherName: "Synthetic Mother", secondaryPosition: "Welder",
      otherPosition: "Cleaner", englishProficiency: "Yes",
    },
  };
}

function documentBytes(category: string) {
  return Buffer.from(`%PDF-1.4\nSynthetic ${category} document\n%%EOF\n`);
}

function request(options: {
  payload?: unknown; key?: string; categories?: SupportingDocumentCategory[]; resume?: File;
  documentOverrides?: Partial<Record<SupportingDocumentCategory, File>>; requestOrigin?: string | null;
} = {}) {
  const form = new FormData();
  form.set("idempotencyKey", options.key || randomUUID());
  form.set("payload", JSON.stringify(options.payload ?? values()));
  form.set("resume", options.resume || new File([pdf], "resume.pdf", { type: "application/pdf" }));
  for (const category of options.categories ?? ["passport"]) {
    form.set(`document:${category}`, options.documentOverrides?.[category] || new File(
      [documentBytes(category)], `${category}.pdf`, { type: "application/pdf" },
    ));
  }
  return new NextRequest(`${origin}/api/applications`, {
    method: "POST", body: form,
    headers: options.requestOrigin === null ? {} : { origin: options.requestOrigin ?? origin },
  });
}

function acknowledge(payload: SheetsPayload) {
  const previous = records.get(payload.application.id);
  if (previous && previous !== payload.application.reference)
    return Response.json({ ok: false, code: "DUPLICATE_CONFLICT" });
  records.set(payload.application.id, payload.application.reference);
  return Response.json({
    ok: true, applicationId: payload.application.id, reference: payload.application.reference,
    row: 2, duplicate: previous !== undefined,
  });
}

before(() => {
  Object.assign(process.env, {
    NODE_ENV: "production", CHAPTER_LOCAL_MODE: "false", APP_ORIGIN: origin,
    APPLICATION_STORAGE: "google-sheets", GOOGLE_SHEETS_WEBHOOK_URL: webhook, GOOGLE_SHEETS_WEBHOOK_SECRET: secret,
  });
  for (const key of ["DATA_DIR", "DATABASE_URL", "SESSION_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD", "S3_BUCKET", "S3_REGION", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"])
    delete process.env[key];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), webhook);
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.cache, "no-store");
    if (init?.method === "GET") return Response.json({
      ok: true, service: "chapter-applications", version: 1, schemaVersion: 7, columns: 36, supportedColumns: [36, 35, 54],
    });
    assert.equal(init?.method, "POST");
    const envelope = JSON.parse(String(init?.body)) as { timestamp: number; payload: string; signature: string };
    assert.ok(Number.isSafeInteger(envelope.timestamp));
    assert.equal(envelope.signature, createHmac("sha256", secret).update(`${envelope.timestamp}.${envelope.payload}`).digest("hex"));
    const payload = JSON.parse(envelope.payload) as SheetsPayload;
    received.push(payload);
    return receiver(payload);
  };
});

beforeEach(() => { received.length = 0; records.clear(); receiver = acknowledge; });

after(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

test("explicit Google mode accepts production submissions without database, object storage or staff settings", async () => {
  assert.equal(usesGoogleApplicationStorage(), true);
  assert.equal(localModeAllowed(), false);
  assert.equal(process.env.DATA_DIR, undefined);
  assert.equal(process.env.SESSION_SECRET, undefined);
  await assert.rejects(getDatabase(), /Production requires DATABASE_URL/);
  assert.throws(requireStorageConfiguration, /Production private storage is not configured/);
  const response = await submit(request());
  assert.equal(response.status, 201);
  assert.equal((await response.json()).reference, received[0].application.reference);
  assert.equal(received.length, 1);
});

test("structured application answers and all eight supported form documents reach the authenticated receiver", async () => {
  const input = values();
  const key = randomUUID();
  const categories = referenceApplicationUploads.flatMap(({ id }) => id === "resume" ? [] : [id]);
  const response = await submit(request({ payload: input, key, categories }));
  assert.equal(response.status, 201);
  const receipt = await response.json();
  assert.deepEqual(Object.keys(receipt).sort(), ["jobTitle", "reference"]);
  assert.equal(receipt.jobTitle, officialJob.title);
  const payload = received[0];
  assert.equal(payload.version, 3);
  assert.equal(payload.application.id, `gs-${key}`);
  assert.match(receipt.reference, /^CH-[A-F0-9]{24}$/);
  assert.equal(payload.application.applicationSource, "Jobs in Croatia");
  assert.equal(payload.application.applicationFormVersion, "jobstreet-croatia-v2");
  const details = input.applicantDetails;
  const profile = payload.application.profile!;
  for (const field of ["firstName", "lastName", "gender", "street", "city", "province", "postalCode", "dateOfBirth", "placeOfBirth", "fatherName", "motherName", "englishProficiency", "telegram"] as const)
    assert.equal(profile[field], details[field], field);
  assert.equal(profile.address, details.currentAddress);
  assert.equal(profile.destinationCountry, input.destinationCountry);
  assert.equal(profile.currentWorkCountry, input.country);
  assert.equal(profile.termsAccepted, true);
  assert.equal(profile.secondaryJobTitle, details.secondaryPosition);
  assert.equal(profile.otherJobTitle, details.otherPosition);
  assert.equal(payload.application.discoverySource, input.discoverySource);
  assert.equal(payload.application.phone, input.phone);
  assert.equal(payload.application.email, input.email);
  assert.equal(payload.application.consent, true);
  assert.deepEqual(payload.resume, { name: "resume.pdf", mime: "application/pdf", base64: pdf.toString("base64") });
  assert.deepEqual(payload.documents?.map(({ category }) => category).sort(), [...categories].sort());
  for (const document of payload.documents || []) {
    assert.equal(document.id, `gs-${key}-${document.category}`);
    assert.equal(document.base64, documentBytes(document.category).toString("base64"));
  }
  for (const privateField of ["resumeKey", "resumeName", "resumeMime", "isExample", "documents"])
    assert.equal(Object.hasOwn(payload.application, privateField), false, privateField);
});

test("published additional jobs are accepted through the compiled catalog", async () => {
  const response = await submit(request({ payload: values(additionalJob.id) }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).jobTitle, additionalJob.title);
  assert.equal(received[0].application.jobId, additionalJob.id);
});

test("exact retries recover their receipt and document IDs; changed answers or bytes conflict", async () => {
  const key = randomUUID();
  const first = await submit(request({ key }));
  assert.equal(first.status, 201);
  const receipt = await first.json();
  const retry = await submit(request({ key }));
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), receipt);
  assert.equal(received[1].application.id, received[0].application.id);
  assert.deepEqual(received[1].documents, received[0].documents);
  const changed = values(); changed.applicantDetails.telegram = "@changed";
  const changedAnswer = await submit(request({ key, payload: changed }));
  assert.equal(changedAnswer.status, 409);
  assert.equal(Object.hasOwn(await changedAnswer.json(), "reference"), false);
  assert.notEqual(received[2].application.reference, received[0].application.reference);
  const changedFile = await submit(request({ key, documentOverrides: {
    passport: new File([Buffer.from("%PDF-1.4\nChanged passport\n%%EOF\n")], "passport.pdf"),
  } }));
  assert.equal(changedFile.status, 409);
  assert.notEqual(received[3].application.reference, received[0].application.reference);
  assert.notEqual(received[3].application.reference, received[2].application.reference);
});

test("persistent receiver quotas return 429 without a success receipt", async () => {
  receiver = () => Response.json({ ok: false, code: "SUBMISSION_RATE_LIMIT" });
  const response = await submit(request());
  assert.equal(response.status, 429);
  assert.equal(received[0].application.applicationSource, "Jobs in Croatia");
  assert.equal(Object.hasOwn(await response.json(), "reference"), false);
});

test("receiver outages, rejections and unverifiable receipts never produce a success reference", async () => {
  for (const failure of [
    () => { throw new Error("Synthetic network failure"); },
    () => new Response("Unavailable", { status: 503 }),
    () => Response.json({ ok: false, code: "SHEET_WRITE_FAILED" }),
    (payload: SheetsPayload) => Response.json({ ok: true, applicationId: payload.application.id, reference: "WRONG", row: 2, duplicate: false }),
    (payload: SheetsPayload) => Response.json({ ok: true, applicationId: payload.application.id, reference: payload.application.reference, row: 1, duplicate: false }),
  ]) {
    receiver = failure;
    const response = await submit(request());
    assert.equal(response.status, 503);
    assert.equal(Object.hasOwn(await response.json(), "reference"), false);
  }
});

test("required uploads, real file signatures and trusted Origin are checked before transmission", async () => {
  const noPassport = await submit(request({ categories: [] }));
  assert.equal(noPassport.status, 422);
  assert.ok((await noPassport.json()).fieldErrors["document:passport"]);
  const abroad = values(); abroad.country = "Croatia";
  const noResidence = await submit(request({ payload: abroad }));
  assert.equal(noResidence.status, 422);
  assert.ok((await noResidence.json()).fieldErrors["document:residence-id"]);
  const noLicense = await submit(request({ payload: values(driverJob.id) }));
  assert.equal(noLicense.status, 422);
  assert.ok((await noLicense.json()).fieldErrors["document:driver-license"]);
  const invalidResume = await submit(request({ resume: new File(["Not a PDF"], "resume.pdf") }));
  assert.equal(invalidResume.status, 422);
  assert.match((await invalidResume.json()).fieldErrors.resume, /PDF signature/);
  for (const requestOrigin of ["https://unrelated.example", null])
    assert.equal((await submit(request({ requestOrigin }))).status, 403);
  assert.equal(received.length, 0);
});

test("Google storage is opt-in, preserving the default database mode", () => {
  const previous = process.env.APPLICATION_STORAGE;
  delete process.env.APPLICATION_STORAGE;
  assert.equal(usesGoogleApplicationStorage(), false);
  process.env.APPLICATION_STORAGE = previous;
});
