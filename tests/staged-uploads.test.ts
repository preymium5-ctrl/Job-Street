import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as submit } from "../app/api/applications/route";
import { POST as upload } from "../app/api/applications/uploads/route";
import { proposedJobs } from "../data/jobs";
import { additionalApplicationJobs } from "../data/application-jobs";
import { formatApplicantAddress } from "../lib/applicant-address";
import { prepareApplicationUpload, stageApplicationUpload, type PreparedApplicationUpload } from "../lib/application-upload-client";
import { initializeStagedUpload, restoreStagedFormData, STAGED_UPLOAD_CHUNK_BYTES, StagedUploadError, uploadStagedChunk, type StagedUploadStart } from "../lib/staged-uploads";
import type { SheetsPayload } from "../lib/sheets-transport";

const MiB = 1024 * 1024;
const origin = "https://staging.example.test";
const webhook = "https://script.google.com/macros/s/synthetic-staging-receiver/exec";
const secret = "synthetic-private-staging-secret-at-least-32-characters";
const job = proposedJobs.find(({ slug }) => slug === "fabricator")!;
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const manifests = new Map<string, Record<string, unknown>>();
const parts = new Map<string, Map<number, string>>();
const receipts = new Map<string, string>();
const delivered: SheetsPayload[] = [];
const operations: Record<string, unknown>[] = [];
const browserRequests: Record<string, unknown>[] = [];
let corruptRead = false;
let rejectRead: string | undefined;
let stageRedirect: string | undefined;
let interruptBrowserChunk: number | undefined;
let loseNextStartReply = false;
let loseNextReceiverInitReply = false;

function values() {
  const address = { street: "17 Synthetic Street", city: "Manila", province: "Metro Manila", postalCode: "0017" };
  return {
    applicationFormVersion: 2, destinationCountry: "Croatia", termsAccepted: true,
    jobId: job.id, fullName: "Synthetic StageCheck", email: "synthetic-stage@example.test", phone: "+639171234567",
    country: "Philippines", discoverySource: "Instagram", consent: true,
    applicantDetails: { firstName: "Synthetic", lastName: "StageCheck", gender: "Male", nationality: "Filipino",
      ...address, currentAddress: formatApplicantAddress(address), dateOfBirth: "1990-01-01", placeOfBirth: "Manila",
      secondaryPosition: "No other position", englishProficiency: "Yes" },
  };
}

function pdf(size = 80) {
  const bytes = Buffer.alloc(size, 32);
  bytes.write("%PDF-1.4\nSynthetic staged transport test\n");
  bytes.write("\n%%EOF\n", size - 7);
  return bytes;
}

function form(options: { size?: number; passport?: boolean; passportSize?: number; key?: string; payload?: unknown; invalidPdf?: boolean } = {}) {
  const key = options.key ?? randomUUID();
  const body = new FormData();
  body.set("idempotencyKey", key);
  body.set("payload", JSON.stringify(options.payload ?? values()));
  body.set("resume", new File([options.invalidPdf ? Buffer.alloc(options.size ?? 80, 63) : pdf(options.size ?? 5 * MiB)], "synthetic-cv.pdf", { type: "application/pdf" }));
  if (options.passport !== false) body.set("document:passport", new File([pdf(options.passportSize)], "synthetic-passport.pdf", { type: "application/pdf" }));
  return { body, key };
}

function jsonRequest(body: unknown, path = "/api/applications/uploads", requestOrigin: string | null = origin) {
  return new NextRequest(`${origin}${path}`, { method: "POST", headers: {
    "content-type": "application/json", ...(requestOrigin ? { origin: requestOrigin } : {}),
  }, body: JSON.stringify(body) });
}

function startInput(prepared: PreparedApplicationUpload): StagedUploadStart {
  return {
    payload: JSON.parse(String(prepared.form.get("payload"))), submissionKey: prepared.key,
    upload: { sha256: prepared.sha256 || createHash("sha256").update(prepared.bytes).digest("hex"),
      totalBytes: prepared.bytes.length, chunkCount: Math.ceil(prepared.bytes.length / STAGED_UPLOAD_CHUNK_BYTES), contentType: prepared.contentType },
    files: Array.from(prepared.form.entries()).flatMap(([field, item]) => item instanceof File
      ? [{ field, name: item.name, size: item.size, type: item.type }] : []),
  };
}

async function reserve(prepared: PreparedApplicationUpload, override: Partial<StagedUploadStart> = {}) {
  const reservation = await initializeStagedUpload({ ...startInput(prepared), ...override }, "198.51.100.4");
  for (let index = 0; index < reservation.chunkCount; index++) {
    const bytes = prepared.bytes.subarray(index * STAGED_UPLOAD_CHUNK_BYTES, (index + 1) * STAGED_UPLOAD_CHUNK_BYTES);
    await uploadStagedChunk(reservation.ticket, index, Buffer.from(bytes).toString("base64"));
  }
  return reservation;
}

async function finish(prepared: PreparedApplicationUpload) {
  const request = await stageApplicationUpload(prepared, () => {});
  assert.equal(request.staged, true);
  assert.equal(request.contentType, "application/json");
  return submit(new NextRequest(`${origin}/api/applications`, { method: "POST",
    headers: { origin, "content-type": request.contentType! }, body: request.body as string }));
}

before(() => {
  Object.assign(process.env, { NODE_ENV: "production", CHAPTER_LOCAL_MODE: "false", APP_ORIGIN: origin,
    APPLICATION_STORAGE: "google-sheets", GOOGLE_SHEETS_WEBHOOK_URL: webhook, GOOGLE_SHEETS_WEBHOOK_SECRET: secret });
  for (const key of ["DATABASE_URL", "SESSION_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD", "S3_BUCKET", "S3_REGION", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "VERCEL", "TRUST_PROXY"])
    delete process.env[key];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/applications/uploads") {
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
      assert.ok(Buffer.byteLength(String(init?.body)) < 3 * MiB, "Every browser chunk request stays below the hosting request limit");
      const body = JSON.parse(String(init?.body));
      browserRequests.push(body);
      if (body.action === "chunk" && body.index === interruptBrowserChunk) {
        interruptBrowserChunk = undefined;
        throw new TypeError("Injected browser connection loss");
      }
      const response = await upload(jsonRequest(body));
      if (body.action === "start" && loseNextStartReply) {
        loseNextStartReply = false;
        throw new TypeError("Injected lost browser start response");
      }
      return response;
    }
    assert.equal(url, webhook, "Private staging and final delivery only target the configured receiver");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "manual");
    if (init?.method === "GET") return Response.json({ ok: true, service: "chapter-applications", version: 1,
      schemaVersion: 7, columns: 36, supportedColumns: [36, 35, 54] });
    const envelope = JSON.parse(String(init?.body));
    assert.equal(envelope.signature, createHmac("sha256", secret).update(`${envelope.timestamp}.${envelope.payload}`).digest("hex"));
    const payload = JSON.parse(envelope.payload);
    if (payload.operation) {
      operations.push(payload);
      if (stageRedirect) return new Response(null, { status: 302, headers: { location: stageRedirect } });
      if (payload.operation === "upload-stage-init") {
        const previous = manifests.get(payload.manifest.id);
        if (previous) assert.deepEqual(payload.manifest, previous, "Receiver init retries reuse the exact immutable manifest");
        else {
          manifests.set(payload.manifest.id, payload.manifest);
          parts.set(payload.manifest.id, new Map());
        }
        if (loseNextReceiverInitReply) {
          loseNextReceiverInitReply = false;
          throw new TypeError("Injected lost receiver init acknowledgement");
        }
        return Response.json({ ok: true, sessionId: payload.manifest.id });
      }
      if (payload.operation === "upload-stage-write") {
        const existing = parts.get(payload.sessionId)!.get(payload.index);
        if (existing && existing !== payload.base64) return Response.json({ ok: false, code: "UPLOAD_STAGE_CONFLICT" });
        parts.get(payload.sessionId)!.set(payload.index, payload.base64);
        return Response.json({ ok: true, sessionId: payload.sessionId, index: payload.index, size: Buffer.from(payload.base64, "base64").length });
      }
      if (payload.operation === "upload-stage-read") {
        if (rejectRead) return Response.json({ ok: false, code: rejectRead });
        let base64 = parts.get(payload.sessionId)?.get(payload.index);
        if (!base64) return Response.json({ ok: false, code: "UPLOAD_STAGE_NOT_FOUND" });
        if (corruptRead && payload.index === 0) {
          const bytes = Buffer.from(base64, "base64"); bytes[0] ^= 1; base64 = bytes.toString("base64");
        }
        return Response.json({ ok: true, sessionId: payload.sessionId, index: payload.index, base64 });
      }
      throw new Error("Unexpected staging operation");
    }
    delivered.push(payload);
    const previous = receipts.get(payload.application.id);
    if (previous && previous !== payload.application.reference) return Response.json({ ok: false, code: "DUPLICATE_CONFLICT" });
    receipts.set(payload.application.id, payload.application.reference);
    return Response.json({ ok: true, applicationId: payload.application.id, reference: payload.application.reference, row: 2, duplicate: previous !== undefined });
  };
});

beforeEach(() => {
  manifests.clear(); parts.clear(); receipts.clear(); delivered.length = 0; operations.length = 0; browserRequests.length = 0;
  corruptRead = false; rejectRead = undefined; stageRedirect = undefined; interruptBrowserChunk = undefined;
  loseNextStartReply = false; loseNextReceiverInitReply = false;
});

after(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

test("a full 5 MiB CV and passport travel in 2 MiB browser chunks and reach Google with the original profile and private files", async () => {
  const { body, key } = form();
  const prepared = await prepareApplicationUpload(body, key);
  const response = await finish(prepared);
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const receipt = await response.json();
  assert.deepEqual(Object.keys(receipt).sort(), ["jobTitle", "reference"]);
  assert.equal(receipt.jobTitle, job.title);
  assert.equal(delivered.length, 1);
  assert.equal(Buffer.from(delivered[0].resume.base64, "base64").length, 5 * MiB);
  assert.equal(delivered[0].documents?.length, 1);
  assert.equal(delivered[0].documents?.[0].category, "passport");
  assert.equal(delivered[0].application.applicationFormVersion, "jobstreet-croatia-v2");
  assert.equal(delivered[0].application.profile?.firstName, "Synthetic");
  assert.equal(delivered[0].application.discoverySource, "Instagram");
  assert.equal(delivered[0].application.id, `gs-${key}`);
  assert.equal(browserRequests.filter(({ action }) => action === "chunk").length, 3);
  assert.equal(parts.size, 1, "Parts remain reusable until expiry if the final acknowledgement is lost");
  const retry = await finish(prepared);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), receipt);
  assert.equal(receipts.size, 1);
  assert.equal(browserRequests.filter(({ action }) => action === "start").length, 1);
  assert.equal(browserRequests.filter(({ action }) => action === "chunk").length, 3);
});

test("a browser connection loss resumes only unacknowledged chunks with the same ticket and multipart bytes", async () => {
  const { body, key } = form();
  const prepared = await prepareApplicationUpload(body, key);
  const original = prepared.bytes.slice();
  interruptBrowserChunk = 1;
  await assert.rejects(stageApplicationUpload(prepared, () => {}), /connection|uploading/i);
  assert.deepEqual([...prepared.uploadedChunks], [0]);
  const ticket = prepared.ticket;
  assert.ok(ticket);
  const response = await finish(prepared);
  assert.equal(response.status, 201);
  assert.equal(prepared.ticket, ticket);
  assert.deepEqual(prepared.bytes, original);
  assert.deepEqual(browserRequests.map(({ action, index }) => action === "start" ? "start" : index), ["start", 0, 1, 1, 2]);
});

test("a lost browser start response reserves no Google quota or files before a stable ticket reaches the browser", async () => {
  const { body, key } = form();
  const prepared = await prepareApplicationUpload(body, key);
  const original = prepared.bytes.slice();
  loseNextStartReply = true;
  await assert.rejects(stageApplicationUpload(prepared, () => {}), /connection|uploading/i);
  assert.equal(operations.length, 0);
  assert.equal(manifests.size, 0);
  assert.equal(parts.size, 0);
  assert.equal(prepared.ticket, undefined);
  const response = await finish(prepared);
  assert.equal(response.status, 201);
  assert.equal(manifests.size, 1);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].application.id, `gs-${key}`);
  assert.equal(delivered[0].application.profile?.firstName, values().applicantDetails.firstName);
  assert.deepEqual(prepared.bytes, original);
  const starts = browserRequests.filter(({ action }) => action === "start");
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[0], starts[1]);
});

test("a lost first-chunk receiver init acknowledgement retries the same ticket and manifest without another session or file set", async () => {
  const { body, key } = form();
  const prepared = await prepareApplicationUpload(body, key);
  loseNextReceiverInitReply = true;
  await assert.rejects(stageApplicationUpload(prepared, () => {}));
  const ticket = prepared.ticket;
  assert.ok(ticket, "The browser has its retry ticket before the first receiver reservation");
  assert.equal(manifests.size, 1);
  assert.equal([...parts.values()][0].size, 0);
  assert.equal(prepared.uploadedChunks.size, 0);
  const response = await finish(prepared);
  assert.equal(response.status, 201);
  const receipt = await response.json();
  assert.equal(prepared.ticket, ticket);
  assert.equal(manifests.size, 1);
  assert.equal([...parts.values()][0].size, 3);
  const initializations = operations.filter(({ operation }) => operation === "upload-stage-init");
  assert.equal(initializations.length, 2);
  assert.deepEqual(initializations[0], initializations[1]);
  assert.equal(operations.filter(({ operation }) => operation === "upload-stage-write").length, 3);
  assert.equal(delivered[0].application.id, `gs-${key}`);
  assert.equal(delivered[0].application.profile?.firstName, values().applicantDetails.firstName);
  const retry = await finish(prepared);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), receipt);
  assert.equal(receipts.size, 1);
});

test("a supporting passport may also be exactly 5 MiB and reaches its own Google document column", async () => {
  const { body, key } = form({ size: 80, passportSize: 5 * MiB });
  const prepared = await prepareApplicationUpload(body, key);
  const response = await finish(prepared);
  assert.equal(response.status, 201);
  const document = delivered[0].documents?.find(({ category }) => category === "passport");
  assert.ok(document);
  assert.equal(Buffer.from(document.base64, "base64").length, 5 * MiB);
  assert.equal(document.id, `gs-${key}-passport`);
});

test("an expired interrupted upload clears cached state and starts a fresh stage with unchanged application bytes", async (t) => {
  const { body, key } = form();
  const prepared = await prepareApplicationUpload(body, key);
  const original = prepared.bytes.slice();
  interruptBrowserChunk = 1;
  await assert.rejects(stageApplicationUpload(prepared, () => {}));
  const originalTicket = prepared.ticket!;
  const decoded = JSON.parse(Buffer.from(originalTicket.split(".")[0], "base64url").toString("utf8"));
  t.mock.method(Date, "now", () => decoded.manifest.expiresAt + 1);
  await assert.rejects(stageApplicationUpload(prepared, () => {}), { code: "UPLOAD_STAGE_EXPIRED" });
  assert.equal(prepared.ticket, undefined);
  assert.equal(prepared.uploadId, undefined);
  assert.equal(prepared.uploadedChunks.size, 0);
  const response = await finish(prepared);
  assert.equal(response.status, 201);
  assert.notEqual(prepared.ticket, originalTicket);
  assert.deepEqual(prepared.bytes, original);
  assert.equal(browserRequests.filter(({ action }) => action === "start").length, 2);
  assert.equal(receipts.size, 1);
});

test("invalid current-form details, missing required uploads, oversized files and excessive envelopes are rejected before receiver access", async () => {
  const { body, key } = form();
  const prepared = await prepareApplicationUpload(body, key);
  const valid = startInput(prepared);
  const cases: StagedUploadStart[] = [
    { ...valid, payload: { ...values(), applicantDetails: undefined } },
    { ...valid, payload: { ...values(), termsAccepted: false } },
    { ...valid, payload: { ...values(), jobId: "not-published-position" } },
    { ...valid, files: valid.files.filter(({ field }) => field !== "document:passport") },
    { ...valid, files: valid.files.map((file) => file.field === "resume" ? { ...file, size: 5 * MiB + 1 } : file) },
    { ...valid, files: valid.files.map((file) => file.field === "document:passport" ? { ...file, size: 5 * MiB + 1 } : file) },
    { ...valid, upload: { ...valid.upload, totalBytes: 16 * MiB + 1, chunkCount: 9 } },
    { ...valid, files: [...valid.files, { field: "document:other", name: "unlisted.pdf", type: "application/pdf", size: 80 }] },
  ];
  for (const input of cases) {
    const response = await upload(jsonRequest({ action: "start", ...input }));
    assert.ok([409, 422].includes(response.status), JSON.stringify(await response.clone().json()));
  }
  assert.equal(operations.length, 0);
  assert.equal(delivered.length, 0);
});

test("conditional passport, residence and driver requirements are checked before staging", async () => {
  const { body, key } = form();
  const prepared = await prepareApplicationUpload(body, key);
  const input = startInput(prepared);
  const abroad = { ...values(), country: "United Arab Emirates" };
  await assert.rejects(initializeStagedUpload({ ...input, payload: abroad }), (error: unknown) => {
    assert.ok(error instanceof StagedUploadError);
    assert.ok(error.fieldErrors?.["document:residence-id"]);
    return true;
  });
  const driver = [...proposedJobs, ...additionalApplicationJobs].find(({ title }) => /\bdriver\b/i.test(title));
  assert.ok(driver);
  await assert.rejects(initializeStagedUpload({ ...input, payload: { ...values(), jobId: driver.id } }), (error: unknown) => {
    assert.ok(error instanceof StagedUploadError);
    assert.ok(error.fieldErrors?.["document:driver-license"]);
    return true;
  });
  assert.equal(operations.length, 0);
});

test("the final API revalidates actual files and required documents even when start metadata advertises valid attachments", async () => {
  for (const scenario of ["missing-passport", "oversized-file", "invalid-pdf"] as const) {
    const { body, key } = form({ passport: scenario !== "missing-passport", size: scenario === "oversized-file" ? 5 * MiB + 1 : 5 * MiB, invalidPdf: scenario === "invalid-pdf" });
    const prepared = await prepareApplicationUpload(body, key);
    const input = startInput(prepared);
    input.files = input.files.map((file) => ({ ...file, size: Math.min(file.size, 5 * MiB) }));
    if (scenario === "missing-passport") input.files.push({ field: "document:passport", name: "advertised-passport.pdf", type: "application/pdf", size: 80 });
    const reservation = await reserve(prepared, input);
    const response = await submit(jsonRequest({ stagedUploadTicket: reservation.ticket }, "/api/applications"));
    assert.equal(response.status, 422, `${scenario}: ${JSON.stringify(await response.clone().json())}`);
    assert.equal(delivered.length, 0);
  }
});

test("modified multipart chunks cannot reach the application receiver", async () => {
  const { body, key } = form();
  const prepared = await prepareApplicationUpload(body, key);
  const { ticket } = await reserve(prepared);
  corruptRead = true;
  const response = await submit(jsonRequest({ stagedUploadTicket: ticket }, "/api/applications"));
  assert.equal(response.status, 409);
  assert.equal(delivered.length, 0);
});

test("restoration binds application profile, complete envelope hash and idempotency key to the signed ticket", async () => {
  for (const scenario of ["payload", "sha256", "key"] as const) {
    const { body, key } = form();
    const prepared = await prepareApplicationUpload(body, key);
    const input = startInput(prepared);
    if (scenario === "payload") input.payload = { ...values(), discoverySource: "Facebook" };
    if (scenario === "sha256") input.upload.sha256 = "0".repeat(64);
    if (scenario === "key") input.submissionKey = randomUUID();
    const { ticket } = await reserve(prepared, input);
    await assert.rejects(restoreStagedFormData(ticket), { code: "UPLOAD_STAGE_CONFLICT" });
    assert.equal(delivered.length, 0);
  }
});

test("ticket tampering and expiry are rejected without reading private staged data", async (t) => {
  const { body, key } = form();
  const prepared = await prepareApplicationUpload(body, key);
  const { ticket } = await reserve(prepared);
  const count = operations.length;
  const [encoded, signature] = ticket.split(".");
  const tampered = `${encoded}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  await assert.rejects(restoreStagedFormData(tampered), { code: "UPLOAD_STAGE_INVALID" });
  assert.equal(operations.length, count);
  const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  t.mock.method(Date, "now", () => decoded.manifest.expiresAt + 1);
  await assert.rejects(restoreStagedFormData(ticket), { code: "UPLOAD_STAGE_EXPIRED" });
  assert.equal(operations.length, count);
});

test("upload and final routes require the configured origin and bounded JSON requests", async () => {
  for (const requestOrigin of [null, "https://untrusted.example.test"]) {
    assert.equal((await upload(jsonRequest({ action: "start" }, undefined, requestOrigin))).status, 403);
    assert.equal((await submit(jsonRequest({ stagedUploadTicket: "not-a-ticket" }, "/api/applications", requestOrigin))).status, 403);
  }
  const tooLarge = jsonRequest({ action: "chunk", padding: "x".repeat(3 * MiB) });
  assert.equal((await upload(tooLarge)).status, 413);
  const extra = await submit(jsonRequest({ stagedUploadTicket: "not-a-ticket", extra: true }, "/api/applications"));
  assert.ok([400, 422].includes(extra.status));
  assert.equal(operations.length, 0);
});

test("browser tickets and errors contain no webhook credentials or raw email and client address", async () => {
  const { body, key } = form();
  const prepared = await prepareApplicationUpload(body, key);
  const result = await initializeStagedUpload(startInput(prepared), "198.51.100.4");
  const publicBody = JSON.stringify(result);
  const decoded = Buffer.from(result.ticket.split(".")[0], "base64url").toString("utf8");
  for (const sensitive of [secret, webhook, values().email, "198.51.100.4", values().fullName]) {
    assert.equal(publicBody.includes(sensitive), false);
    assert.equal(decoded.includes(sensitive), false);
  }
  assert.equal(operations.length, 0, "Minting a browser ticket performs no Google reservation");
  const manifest = JSON.parse(decoded).manifest;
  assert.match(String(manifest.emailKey), /^[a-f0-9]{64}$/);
  assert.notEqual(manifest.emailKey, createHash("sha256").update(values().email).digest("hex"));
  stageRedirect = "https://untrusted.example.test/collect";
  const failed = await upload(jsonRequest({ action: "chunk", ticket: result.ticket, index: 0,
    base64: Buffer.from(prepared.bytes.subarray(0, STAGED_UPLOAD_CHUNK_BYTES)).toString("base64") }));
  assert.equal(failed.status, 503);
  const error = JSON.stringify(await failed.json());
  assert.equal(error.includes(secret), false);
  assert.equal(error.includes(webhook), false);
  assert.equal(error.includes("untrusted.example"), false);
});
