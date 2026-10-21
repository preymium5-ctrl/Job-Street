import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../lib/db";
import { createApplication, getJobs } from "../lib/repository";
import { sheetDeliveries } from "../lib/schema";
import { drainSheetsQueue, sheetsQueueStatus } from "../lib/sheets-queue";
import { buildSheetsPayload, sendApplicationToSheets, sheetsConfiguration, SheetsDeliveryError, type SheetsPayload } from "../lib/sheets-transport";
import { applicationSchema } from "../lib/validation";
import { discoverySources, type Application, type Job } from "../lib/types";
import { getJobFairRole } from "../data/job-fair";
import { type SupportingDocumentCategory } from "../lib/document-uploads";
import { NextRequest } from "next/server";
import { POST as submit } from "../app/api/applications/route";
import { GET as integrationStatus, POST as integrationRetry } from "../app/api/admin/integrations/google-sheets/route";

const originalEnv = { ...process.env };
let temporaryDirectory = "";
let job: Job;
const resume = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "chapter-sheets-test-"));
  Object.assign(process.env, { NODE_ENV: "test", DATA_DIR: temporaryDirectory, CHAPTER_LOCAL_MODE: "true", APP_ORIGIN: "http://localhost:3000" });
  for (const key of ["DATABASE_URL", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "GOOGLE_SHEETS_WEBHOOK_URL", "GOOGLE_SHEETS_WEBHOOK_SECRET"])
    delete process.env[key];
  job = (await getJobs())[0];
});
after(async () => {
  await closeDatabase();
  if (!path.resolve(temporaryDirectory).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(temporaryDirectory).startsWith("chapter-sheets-test-"))
    throw new Error("Unexpected test cleanup path.");
  await rm(temporaryDirectory, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
function applicant(): Application {
  const id = randomUUID();
  return {
    id, reference: `CH-TEST-${id}`, jobId: job.id, jobTitle: job.title,
    fullName: "Integration Test Applicant", email: `${id}@example.test`, phone: "+63 917 123 4567", country: "Philippines",
    recentJobTitle: "Fabricator", experienceYears: 3, skills: "Workshop fabrication", education: "High school", summary: "", coverLetter: "", consent: true,
    nc2Certificate: "NC2 Fabricator", documentReadiness: { nc2: "ready", diploma: "ready", nbi: "in-progress", form18a: "not-yet" },
    preferredEmployer: "", status: "New", submittedAt: new Date().toISOString(), resumeName: "resume.pdf", resumeMime: "application/pdf", resumeKey: `resumes/${randomUUID()}.pdf`, isExample: false,
  };
}
function referenceApplicant(): Application {
  return {
    ...applicant(), applicationFormVersion: 2, destinationCountry: "Romania", termsAccepted: true,
    fullName: "Integration Applicant", discoverySource: "TikTok", recentJobTitle: "", skills: "", experienceYears: 0,
    applicantDetails: {
      firstName: "Integration", lastName: "Applicant", gender: "Female", nationality: "Filipino",
      currentAddress: "10 Example Street, Makati, Metro Manila, 1200", street: "10 Example Street", city: "Makati", province: "Metro Manila", postalCode: "1200",
      dateOfBirth: "1990-01-01", placeOfBirth: "Manila", englishProficiency: "Yes", telegram: "+63 917 000 0000",
      fatherName: "Example Father", motherName: "Example Mother", secondaryPosition: "Other", otherPosition: "Cabinet maker",
    },
  };
}
async function record() {
  const application = applicant();
  await createApplication(application, randomUUID(), "test-request-hash");
  return application;
}
async function delivery(id: string) {
  return (await (await getDatabase()).select().from(sheetDeliveries).where(eq(sheetDeliveries.applicationId, id)))[0];
}

async function withWebhook(run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  const secret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  process.env.GOOGLE_SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/test-discovery/exec";
  process.env.GOOGLE_SHEETS_WEBHOOK_SECRET = "test-discovery-signature-secret-".repeat(3);
  try { await run(); }
  finally {
    globalThis.fetch = originalFetch;
    if (url === undefined) delete process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    else process.env.GOOGLE_SHEETS_WEBHOOK_URL = url;
    if (secret === undefined) delete process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
    else process.env.GOOGLE_SHEETS_WEBHOOK_SECRET = secret;
  }
}

test("document readiness validates certificate details and retains legacy form compatibility", () => {
  const full = applicant();
  const { id: _id, reference: _reference, jobTitle: _title, status: _status, submittedAt: _date, resumeName: _name, resumeMime: _mime, resumeKey: _key, isExample: _example, ...input } = full;
  void _id; void _reference; void _title; void _status; void _date; void _name; void _mime; void _key; void _example;
  assert.equal(applicationSchema.safeParse(input).success, true);
  assert.equal(applicationSchema.safeParse({ ...input, nc2Certificate: "" }).success, false);
  assert.equal(applicationSchema.safeParse({ ...input, documentReadiness: { ...input.documentReadiness, nbi: "uploaded" } }).success, false);
  assert.equal(applicationSchema.safeParse({ ...input, documentReadiness: undefined, nc2Certificate: undefined, preferredEmployer: undefined }).success, true);
});

test("legacy applications export complete document readiness and empty certificate fields", () => {
  const legacy = { ...applicant(), documentReadiness: undefined, nc2Certificate: undefined, preferredEmployer: undefined };
  const payload = buildSheetsPayload(legacy, resume, job);
  assert.deepEqual(payload.application.documentReadiness, { nc2: "not-yet", diploma: "not-yet", nbi: "not-yet", form18a: "not-yet" });
  assert.equal(payload.application.nc2Certificate, "");
  assert.equal(payload.application.preferredEmployer, "");
  assert.equal(payload.application.discoverySource, undefined);
});

test("Sheets payload preserves each discovery answer independently of receiver compatibility", () => {
  for (const discoverySource of ["" as const, ...discoverySources]) {
    const payload = buildSheetsPayload({ ...applicant(), discoverySource }, resume, job);
    assert.equal(payload.application.discoverySource, discoverySource);
  }
});

test("full reference profile and all nine uploads export without leaking internal or unknown fields", () => {
  const application = {
    ...referenceApplicant(),
    unexpectedFutureAnswer: "Keep future fields private too",
  };
  const categories: SupportingDocumentCategory[] = ["diploma", "nc2", "nbi", "form18a", "other", "driver-license", "passport", "residence-id", "employment-certificate"];
  const documents = categories.map((category) => ({ id: randomUUID(), category, name: `${category}.pdf`, mime: "application/pdf", base64: resume.toString("base64") }));
  const payload = buildSheetsPayload(application, resume, job, documents);
  assert.equal(payload.version, 3);
  assert.deepEqual(payload.documents, documents);
  assert.equal(Object.hasOwn(payload.application, "applicantDetails"), false);
  assert.equal(Object.hasOwn(payload.application, "unexpectedFutureAnswer"), false);
  assert.equal(Object.hasOwn(payload.application, "resumeKey"), false);
  assert.equal(payload.application.discoverySource, "TikTok");
  assert.equal(payload.application.applicationSource, "Jobstreet Croatia");
  assert.equal(payload.application.applicationFormVersion, "jobstreet-croatia-v2");
  assert.deepEqual(payload.application.profile, {
    firstName: "Integration", lastName: "Applicant", gender: "Female", nationality: "Filipino",
    address: "10 Example Street, Makati, Metro Manila, 1200", street: "10 Example Street", city: "Makati", province: "Metro Manila", postalCode: "1200",
    dateOfBirth: "1990-01-01", placeOfBirth: "Manila", destinationCountry: "Romania", currentWorkCountry: "Philippines",
    secondaryJobTitle: "Other", otherJobTitle: "Cabinet maker", englishProficiency: "Yes", telegram: "+63 917 000 0000",
    fatherName: "Example Father", motherName: "Example Mother", termsAccepted: true,
  });
  assert.ok(!JSON.stringify(payload).includes(application.resumeKey));
  assert.ok(!JSON.stringify(payload).includes(application.unexpectedFutureAnswer));
  assert.ok(!JSON.stringify(payload).includes("test-discovery-signature-secret"));
});

test("reference form uses typed profile columns while legacy strings identify questions not collected", () => {
  const application = referenceApplicant();
  const payload = buildSheetsPayload(application, resume, job);
  for (const field of ["destinationCountry", "termsAccepted"]) assert.equal(Object.hasOwn(payload.application, field), false);
  assert.equal(payload.application.profile?.destinationCountry, application.destinationCountry);
  assert.equal(payload.application.profile?.termsAccepted, true);
  assert.equal(payload.application.recentJobTitle, "Not collected by this form");
  assert.equal(payload.application.skills, "Not collected by this form");
  assert.equal(payload.application.experienceYears, 0);
  assert.equal(application.recentJobTitle, ""); assert.equal(application.skills, "");
  const withAnswers = buildSheetsPayload({ ...application, recentJobTitle: "Earlier applicant answer", skills: "Earlier applicant skills" }, resume, job);
  assert.equal(withAnswers.application.recentJobTitle, "Earlier applicant answer");
  assert.equal(withAnswers.application.skills, "Earlier applicant skills");
});

test("reference profile keeps optional unanswered fields absent and does not change stored answers", () => {
  const application = referenceApplicant();
  delete application.applicantDetails!.nationality;
  delete application.applicantDetails!.telegram;
  const payload = buildSheetsPayload(application, resume, job);
  assert.equal(payload.application.summary, "");
  assert.equal(payload.application.country, application.country);
  assert.equal(payload.application.profile?.destinationCountry, "Romania");
  assert.equal(Object.hasOwn(payload.application.profile!, "nationality"), false);
  assert.equal(Object.hasOwn(payload.application.profile!, "telegram"), false);
  assert.equal(application.summary, "");
  assert.equal(application.coverLetter, "");
  assert.deepEqual(buildSheetsPayload(application, resume, job), payload);

  const answered = { ...application, summary: "Applicant summary", coverLetter: "Applicant cover letter" };
  const withAnswers = buildSheetsPayload(answered, resume, job);
  assert.equal(withAnswers.application.summary, "Applicant summary");
  assert.equal(withAnswers.application.coverLetter, answered.coverLetter);
  assert.equal(answered.summary, "Applicant summary");

  const legacy = { ...answered, applicationFormVersion: undefined };
  const legacyPayload = buildSheetsPayload(legacy, resume, job);
  assert.equal(legacyPayload.application.summary, legacy.summary);
  assert.equal(legacyPayload.application.coverLetter, legacy.coverLetter);
  assert.equal(legacyPayload.application.profile, undefined);
});

test("full profile never truncates saturated applicant text or silently drops incomplete profiles", () => {
  const application = { ...referenceApplicant(), summary: "s".repeat(4000), coverLetter: "c".repeat(6000) };
  const payload = buildSheetsPayload(application, resume, job);
  assert.equal(payload.application.summary, application.summary);
  assert.equal(payload.application.coverLetter, application.coverLetter);
  assert.equal(payload.application.profile?.telegram, application.applicantDetails!.telegram);
  assert.throws(() => buildSheetsPayload({ ...application, applicantDetails: undefined }, resume, job),
    (error: unknown) => error instanceof SheetsDeliveryError && error.code === "INVALID_APPLICATION_PROFILE");
  assert.throws(() => buildSheetsPayload({ ...application, applicantDetails: { ...application.applicantDetails!, gender: "Prefer not to say" } }, resume, job),
    (error: unknown) => error instanceof SheetsDeliveryError && error.code === "INVALID_APPLICATION_PROFILE");
});

test("compatible receiver schemas send every profile answer and upload through the staged 36-column upgrade", async () => {
  for (const [schemaVersion, columns] of [[6, 35], [6, 36], [6, 54], [7, 36]]) await withWebhook(async () => {
    const application = referenceApplicant();
    const documents = (["passport", "residence-id", "employment-certificate"] as const)
      .map((category) => ({ id: randomUUID(), category, name: `${category}.pdf`, mime: "application/pdf", base64: resume.toString("base64") }));
    const payload = buildSheetsPayload(application, resume, job, documents);
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      if (init?.method === "GET") {
        assert.equal(init.body, undefined);
        assert.equal(init.headers, undefined);
        return Response.json({ ok: true, service: "chapter-applications", version: 1, schemaVersion, columns });
      }
      assert.equal(calls, 2);
      const envelope = JSON.parse(String(init?.body));
      assert.equal(envelope.signature, createHmac("sha256", process.env.GOOGLE_SHEETS_WEBHOOK_SECRET!).update(`${envelope.timestamp}.${envelope.payload}`).digest("hex"));
      const sent = JSON.parse(envelope.payload);
      assert.deepEqual(sent, payload);
      assert.equal(sent.application.profile!.telegram, application.applicantDetails!.telegram);
      return Response.json({ ok: true, applicationId: application.id, reference: application.reference, row: 2, duplicate: false, privateToken: "do-not-retain" });
    };
    assert.deepEqual(await sendApplicationToSheets(payload), { ok: true, applicationId: application.id, reference: application.reference, row: 2, duplicate: false });
    assert.equal(calls, 2);
  });
});

test("full applications wait for compatible receiver instead of reporting partial delivery", async () => {
  for (const health of [
    { ok: true, service: "chapter-applications", version: 1, schemaVersion: 4, columns: 30 },
    { ok: true, service: "chapter-applications", version: 1, schemaVersion: 6, columns: 30 },
    { ok: true, service: "unrelated", version: 1, schemaVersion: 6, columns: 35 },
    { ok: false },
  ]) await withWebhook(async () => {
    const payload = buildSheetsPayload(referenceApplicant(), resume, job);
    let posts = 0;
    globalThis.fetch = async (_url, init) => {
      if (init?.method === "POST") posts++;
      return Response.json(health);
    };
    await assert.rejects(sendApplicationToSheets(payload), (error: unknown) => error instanceof SheetsDeliveryError && error.code === "UNSUPPORTED_RECEIVER");
    assert.equal(posts, 0);
    assert.ok(payload.application.profile?.telegram);
  });
});

test("receiver rate limits and idempotency conflicts surface bounded codes without remote details", async () => {
  for (const code of ["SUBMISSION_RATE_LIMIT", "DUPLICATE_CONFLICT"] as const) await withWebhook(async () => {
    const payload = buildSheetsPayload(applicant(), resume, job);
    globalThis.fetch = async () => Response.json({ ok: false, code, privateToken: "secret-not-for-logs", applicant: "private-answer" });
    await assert.rejects(sendApplicationToSheets(payload), (error: unknown) => {
      assert.ok(error instanceof SheetsDeliveryError);
      assert.equal(error.code, code);
      assert.equal(error.message, code);
      assert.ok(!JSON.stringify(error).includes("secret-not-for-logs"));
      assert.ok(!JSON.stringify(error).includes("private-answer"));
      return true;
    });
  });
});

test("schema 4 health enables source delivery through safe body-free Google redirects", async () => {
  await withWebhook(async () => {
    const application = { ...applicant(), discoverySource: "Google search" as const };
    const payload = buildSheetsPayload(application, resume, job);
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      if (calls <= 2) {
        assert.equal(init?.method, "GET");
        assert.equal(init?.body, undefined);
        assert.equal(init?.headers, undefined);
        if (calls === 1) {
          assert.equal(String(url), process.env.GOOGLE_SHEETS_WEBHOOK_URL);
          return new Response(null, { status: 302, headers: { location: "https://script.googleusercontent.com/macros/echo?user_content_key=health" } });
        }
        assert.equal(new URL(String(url)).hostname, "script.googleusercontent.com");
        return Response.json({ ok: true, service: "chapter-applications", version: 1, schemaVersion: 4, columns: 30 });
      }
      assert.equal(String(url), process.env.GOOGLE_SHEETS_WEBHOOK_URL);
      assert.equal(init?.method, "POST");
      const envelope = JSON.parse(String(init?.body));
      assert.equal(envelope.signature, createHmac("sha256", process.env.GOOGLE_SHEETS_WEBHOOK_SECRET!).update(`${envelope.timestamp}.${envelope.payload}`).digest("hex"));
      assert.equal(JSON.parse(envelope.payload).application.discoverySource, "Google search");
      return Response.json({ ok: true, applicationId: application.id, reference: application.reference, row: 2, duplicate: false });
    };
    assert.equal((await sendApplicationToSheets(payload)).row, 2);
    assert.equal(calls, 3);
    assert.equal(payload.application.discoverySource, "Google search");
  });
});

test("old, unavailable or untrusted receiver health omits only the outbound source and continues delivery", async () => {
  const healthResponses = [
    () => Response.json({ ok: true, service: "chapter-applications", version: 1, schemaVersion: 3, columns: 29 }),
    () => Response.json({ ok: true, service: "chapter-applications", version: 1, schemaVersion: 4, columns: 29 }),
    () => Response.json({ ok: true, service: "unrelated", version: 1, schemaVersion: 4, columns: 30 }),
    () => new Response(null, { status: 302, headers: { location: "https://hostile.example/steal" } }),
    () => new Response("x".repeat(16 * 1024 + 1)),
    () => { throw new DOMException("Health timed out", "TimeoutError"); },
  ];
  for (const healthResponse of healthResponses) {
    await withWebhook(async () => {
      const application = { ...applicant(), discoverySource: "Facebook" as const };
      const payload = buildSheetsPayload(application, resume, job);
      let calls = 0;
      globalThis.fetch = async (url, init) => {
        calls++;
        assert.equal(String(url), process.env.GOOGLE_SHEETS_WEBHOOK_URL);
        if (init?.method === "GET") {
          assert.equal(init.body, undefined);
          return healthResponse();
        }
        assert.equal(init?.method, "POST");
        const sent = JSON.parse(JSON.parse(String(init?.body)).payload);
        assert.equal(Object.hasOwn(sent.application, "discoverySource"), false);
        const { discoverySource: _source, ...previousFields } = payload.application;
        void _source;
        assert.deepEqual(sent.application, previousFields);
        return Response.json({ ok: true, applicationId: application.id, reference: application.reference, row: 2, duplicate: false });
      };
      assert.equal((await sendApplicationToSheets(payload)).row, 2);
      assert.equal(calls, 2);
      assert.equal(application.discoverySource, "Facebook");
      assert.equal(payload.application.discoverySource, "Facebook");
    });
  }
});

test("blank and legacy sources require no capability request and no extra strict application key", async () => {
  for (const discoverySource of [undefined, "" as const]) {
    await withWebhook(async () => {
      const application = { ...applicant(), discoverySource };
      const payload = buildSheetsPayload(application, resume, job);
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        assert.equal(init?.method, "POST");
        assert.equal(Object.hasOwn(JSON.parse(JSON.parse(String(init?.body)).payload).application, "discoverySource"), false);
        return Response.json({ ok: true, applicationId: application.id, reference: application.reference, row: 2, duplicate: false });
      };
      assert.equal((await sendApplicationToSheets(payload)).row, 2);
      assert.equal(calls, 1);
    });
  }
});

test("new applications atomically queue exactly once and remain queued without configuration", async () => {
  const application = applicant();
  const key = randomUUID();
  const created = await createApplication(application, key, "same");
  const duplicate = await createApplication({ ...application, id: randomUUID() }, key, "same");
  assert.equal(created.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.application.id, application.id);
  assert.equal((await delivery(application.id)).state, "pending");
  assert.equal(await delivery(application.id).then((row) => row.attempts), 0);
  assert.deepEqual(await drainSheetsQueue({ applicationId: application.id }), { delivered: 0, deferred: 0, configured: false });
  assert.equal((await delivery(application.id)).attempts, 0);
  assert.equal((await sheetsQueueStatus()).configuration, "not-configured");
});

test("delivery survives an ambiguous remote failure, restarts and deduplicates row and private CV", async () => {
  const application = await record();
  let now = new Date();
  let remoteCalls = 0;
  const remoteRows = new Map<string, number>();
  const privateFiles = new Set<string>();
  const transport = async (payload: SheetsPayload) => {
    remoteCalls++;
    const duplicate = remoteRows.has(payload.application.id);
    if (!duplicate) {
      privateFiles.add(payload.application.id);
      remoteRows.set(payload.application.id, 2);
    }
    if (remoteCalls === 1) throw new Error("Response lost after Google persisted data");
    return { ok: true as const, applicationId: payload.application.id, reference: payload.application.reference, row: remoteRows.get(payload.application.id)!, duplicate };
  };
  const options = { applicationId: application.id, limit: 1 };
  const dependencies = { transport, readResume: async () => resume, now: () => now };
  assert.equal((await drainSheetsQueue(options, dependencies)).deferred, 1);
  const failed = await delivery(application.id);
  assert.equal(failed.state, "pending");
  assert.equal(failed.lastError, "WEBHOOK_UNAVAILABLE");
  assert.equal(failed.attempts, 1);
  assert.ok(failed.nextAttemptAt > now);
  await closeDatabase();
  assert.equal((await delivery(application.id)).state, "pending");
  assert.equal((await drainSheetsQueue(options, dependencies)).delivered, 0);
  now = new Date(now.getTime() + 31_000);
  assert.equal((await drainSheetsQueue(options, dependencies)).delivered, 1);
  assert.equal((await delivery(application.id)).state, "synced");
  assert.equal((await delivery(application.id)).sheetRow, 2);
  assert.equal((await drainSheetsQueue(options, dependencies)).delivered, 0);
  assert.equal(remoteCalls, 2);
  assert.equal(remoteRows.size, 1);
  assert.equal(privateFiles.size, 1);
});

test("leased delivery permits one worker and invalid acknowledgements remain queued", async () => {
  const application = await record();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const claimed = new Promise<void>((resolve) => { started = resolve; });
  const dependencies = { readResume: async () => resume, transport: async (payload: SheetsPayload) => {
    started();
    await gate;
    return { ok: true as const, applicationId: payload.application.id, reference: "wrong-reference", row: 2, duplicate: false };
  } };
  const first = drainSheetsQueue({ applicationId: application.id, limit: 1 }, dependencies);
  await claimed;
  assert.equal((await drainSheetsQueue({ applicationId: application.id, limit: 1 }, dependencies)).delivered, 0);
  release();
  assert.equal((await first).deferred, 1);
  const row = await delivery(application.id);
  assert.equal(row.attempts, 1);
  assert.equal(row.lastError, "INVALID_ACKNOWLEDGEMENT");
});

test("webhook signing, destination restrictions, private data boundary and exact Google acknowledgement", async () => {
  assert.equal(sheetsConfiguration({ GOOGLE_SHEETS_WEBHOOK_URL: "https://hostile.example/exec", GOOGLE_SHEETS_WEBHOOK_SECRET: "s".repeat(48) }).valid, false);
  assert.equal(sheetsConfiguration({ GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/example/exec?redirect=other", GOOGLE_SHEETS_WEBHOOK_SECRET: "s".repeat(48) }).valid, false);
  assert.equal(sheetsConfiguration({ GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/example/exec", GOOGLE_SHEETS_WEBHOOK_SECRET: "short" }).valid, false);
  process.env.GOOGLE_SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/test-deployment/exec";
  process.env.GOOGLE_SHEETS_WEBHOOK_SECRET = "test-signature-secret-".repeat(3);
  const application = applicant();
  const payload = buildSheetsPayload(application, resume, job);
  assert.equal("resumeKey" in payload.application, false);
  assert.deepEqual(payload.application.employers, getJobFairRole(job)?.employers.map(({ name, workers }) => ({ name, workers })) || []);
  assert.equal(payload.resume.base64, resume.toString("base64"));
  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      if (calls === 1) {
        assert.equal(String(url), process.env.GOOGLE_SHEETS_WEBHOOK_URL);
        assert.equal(init?.method, "POST");
        const outer = JSON.parse(String(init?.body));
        assert.equal(outer.signature, createHmac("sha256", process.env.GOOGLE_SHEETS_WEBHOOK_SECRET!).update(`${outer.timestamp}.${outer.payload}`).digest("hex"));
        assert.deepEqual(JSON.parse(outer.payload), payload);
        return new Response(null, { status: 302, headers: { location: "https://script.googleusercontent.com/macros/echo?user_content_key=test" } });
      }
      assert.equal(init?.method, "GET");
      assert.equal(init?.body, undefined);
      return Response.json({ ok: true, applicationId: application.id, reference: application.reference, row: 2, duplicate: false });
    };
    assert.equal((await sendApplicationToSheets(payload)).row, 2);
    assert.equal(calls, 2);
    globalThis.fetch = async () => Response.json({ ok: true, applicationId: application.id, reference: "incorrect", row: 2, duplicate: false });
    await assert.rejects(sendApplicationToSheets(payload), (error: unknown) => error instanceof SheetsDeliveryError && error.code === "INVALID_ACKNOWLEDGEMENT");
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "https://hostile.example/steal" } });
    await assert.rejects(sendApplicationToSheets(payload), (error: unknown) => error instanceof SheetsDeliveryError && error.code === "WEBHOOK_REJECTED");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    delete process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  }
});

test("application API validates role-specific employers before accepting uploaded CVs", async () => {
  const application = applicant();
  const { id: _id, reference: _reference, jobTitle: _title, status: _status, submittedAt: _date, resumeName: _name, resumeMime: _mime, resumeKey: _key, isExample: _example, ...input } = application;
  void _id; void _reference; void _title; void _status; void _date; void _name; void _mime; void _key; void _example;
  const form = new FormData();
  form.set("payload", JSON.stringify({ ...input, preferredEmployer: "Unlisted Employer" }));
  form.set("idempotencyKey", randomUUID());
  form.set("resume", new File([resume], "resume.pdf", { type: "application/pdf" }));
  const response = await submit(new NextRequest("http://localhost:3000/api/applications", { method: "POST", headers: { origin: "http://localhost:3000" }, body: form }));
  assert.equal(response.status, 422);
  assert.ok((await response.json()).fieldErrors.preferredEmployer);
});

test("integration status and retry cannot be accessed without staff authentication or from another origin", async () => {
  const url = "http://localhost:3000/api/admin/integrations/google-sheets";
  assert.equal((await integrationStatus(new NextRequest(url))).status, 401);
  assert.equal((await integrationRetry(new NextRequest(url, { method: "POST", headers: { origin: "http://localhost:3000" } }))).status, 401);
  assert.equal((await integrationRetry(new NextRequest(url, { method: "POST", headers: { origin: "https://other.example" } }))).status, 403);
});
