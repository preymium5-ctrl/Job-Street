import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { closeDatabase, getDatabase, localModeAllowed } from "../lib/db";
import {
  createApplication,
  getApplications,
  getJobs,
  saveJob,
} from "../lib/repository";
import { administrators, audits } from "../lib/schema";
import { applicationSchema, fieldErrors } from "../lib/validation";
import { applicantGenders, discoverySources, type ApplicantDetails } from "../lib/types";
import {
  decodeSession,
  hashPassword,
  rateLimit,
  sameOrigin,
  SESSION_COOKIE,
  signSession,
  verifyPassword,
} from "../lib/auth";
import {
  deleteObject,
  readObject,
  requireStorageConfiguration,
  storeImage,
  storeResume,
  UploadError,
  validateResumeBytes,
} from "../lib/storage";
import { POST as submit } from "../app/api/applications/route";
import {
  POST as signIn,
  DELETE as signOut,
} from "../app/api/admin/session/route";
import { GET as listApplications } from "../app/api/admin/applications/route";
import { PATCH as changeStatus } from "../app/api/admin/applications/[id]/route";
import { GET as downloadResume } from "../app/api/admin/applications/[id]/resume/route";
import { GET as publicImage } from "../app/api/images/[key]/route";
import { POST as uploadPhoto } from "../app/api/admin/images/route";
import { POST as createJob } from "../app/api/admin/jobs/route";

let temporaryDirectory: string;
const originalEnv = { ...process.env };
const origin = "http://localhost:3000";
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
before(async () => {
  temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "chapter-backend-test-"),
  );
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: temporaryDirectory,
    APP_ORIGIN: origin,
    CHAPTER_LOCAL_MODE: "true",
    TRUST_PROXY: "false",
    SESSION_SECRET: "test-only-secret-".repeat(4),
  });
  for (const key of [
    "DATABASE_URL",
    "S3_BUCKET",
    "S3_REGION",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "GOOGLE_SHEETS_WEBHOOK_URL",
    "GOOGLE_SHEETS_WEBHOOK_SECRET",
  ])
    delete process.env[key];
});
after(async () => {
  await closeDatabase();
  const safeRoot = path.resolve(tmpdir()) + path.sep;
  if (
    !path.resolve(temporaryDirectory).startsWith(safeRoot) ||
    !path.basename(temporaryDirectory).startsWith("chapter-backend-test-")
  )
    throw new Error("Unexpected test cleanup path.");
  await rm(temporaryDirectory, { recursive: true, force: true });
  for (const key of Object.keys(process.env))
    if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
function applicant(jobId: string) {
  return {
    jobId,
    fullName: "Test Applicant",
    email: "applicant@example.test",
    phone: "+63 917 123 4567",
    country: "Philippines",
    recentJobTitle: "Warehouse Assistant",
    experienceYears: 3,
    skills: "Inventory and packing",
    education: "",
    summary: "",
    coverLetter: "",
    consent: true,
  };
}
function applicantProfile(): ApplicantDetails {
  return {
    firstName: "Test", lastName: "Applicant", nationality: "Filipino",
    currentAddress: "Synthetic test address", dateOfBirth: "1992-02-29", placeOfBirth: "Test city",
    englishProficiency: "No", gender: "Prefer not to say", telegram: "@synthetic_test",
    fatherName: "Test Father", motherName: "Test Mother", secondaryPosition: "Test alternate role", otherPosition: "Test other role",
  };
}
function applicationRequest(
  payload: unknown,
  key = randomUUID(),
  bytes = pdf,
  name = "resume.pdf",
  website = "",
) {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  form.set("resume", new File([bytes], name, { type: "application/pdf" }));
  form.set("idempotencyKey", key);
  form.set("website", website);
  return new NextRequest(`${origin}/api/applications`, {
    method: "POST",
    headers: { origin },
    body: form,
  });
}
function wordArchive(entries: Record<string, string>) {
  const local: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [filename, value] of Object.entries(entries)) {
    const name = Buffer.from(filename);
    const body = Buffer.from(value);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, name);
    offset += header.length + name.length + body.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}
test("server validation rejects invalid contact details and missing consent", () => {
  assert.equal(
    applicationSchema.safeParse({ ...applicant("test"), consent: false })
      .success,
    false,
  );
  assert.equal(
    applicationSchema.safeParse({ ...applicant("test"), phone: "letters" })
      .success,
    false,
  );
  assert.equal(
    applicationSchema.safeParse({ ...applicant("test"), experienceYears: -1 })
      .success,
    false,
  );
  assert.equal(applicationSchema.safeParse(applicant("test")).success, true);
  for (const experienceYears of [0, 1, 2, 2.99])
    assert.equal(applicationSchema.safeParse({ ...applicant("test"), experienceYears }).success, false);
  assert.equal(applicationSchema.safeParse({ ...applicant("test"), experienceYears: 3 }).success, true);
});
test("discovery source accepts listed options, stays optional, and rejects unlisted values", () => {
  const input = applicant("test");
  assert.equal(applicationSchema.safeParse(input).success, true);
  assert.equal(applicationSchema.safeParse({ ...input, discoverySource: "" }).success, true);
  for (const discoverySource of discoverySources) {
    const result = applicationSchema.safeParse({ ...input, discoverySource });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.discoverySource, discoverySource);
  }
  for (const discoverySource of ["Unlisted channel", "facebook", 123, null]) {
    const result = applicationSchema.safeParse({ ...input, discoverySource });
    assert.equal(result.success, false);
    if (!result.success) assert.ok(result.error.issues.some((issue) => issue.path[0] === "discoverySource"));
  }
});

test("optional applicant profiles retain legacy compatibility, normalize names and accept English No without an age filter", () => {
  const input = applicant("test");
  assert.equal(applicationSchema.parse(input).applicantDetails, undefined);
  for (const englishProficiency of ["Yes", "No"] as const) {
    for (const gender of [undefined, "" as const, ...applicantGenders]) {
      const result = applicationSchema.parse({ ...input, fullName: "  Test Applicant  ", applicantDetails: {
        ...applicantProfile(), firstName: " Test ", lastName: " Applicant ", englishProficiency, gender,
      } });
      assert.equal(result.fullName, "Test Applicant");
      assert.equal(result.applicantDetails?.firstName, "Test");
      assert.equal(result.applicantDetails?.lastName, "Applicant");
      assert.equal(result.applicantDetails?.englishProficiency, englishProficiency);
    }
  }
  for (const dateOfBirth of ["1900-01-01", "1992-02-29", new Date().toISOString().slice(0, 10)]) {
    assert.equal(applicationSchema.safeParse({ ...input, applicantDetails: { ...applicantProfile(), dateOfBirth } }).success, true);
  }
  const withBlanks = applicationSchema.parse({ ...input, applicantDetails: {
    ...applicantProfile(), gender: "", telegram: "  ", fatherName: "", motherName: "", secondaryPosition: "", otherPosition: "",
  } });
  assert.equal(withBlanks.applicantDetails?.telegram, "");
  assert.equal(applicationSchema.safeParse({ ...input, fullName: "A B", applicantDetails: { ...applicantProfile(), firstName: "A", lastName: "B" } }).success, true);
});

test("applicant profiles reject invalid calendar dates, missing answers, inconsistent names and unbounded or unexpected fields", () => {
  const input = applicant("test");
  const profile = applicantProfile();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const dateOfBirth of ["2023-02-29", "2024-02-30", "2024-13-01", "2024-1-01", "not-a-date", "", tomorrow]) {
    const result = applicationSchema.safeParse({ ...input, applicantDetails: { ...profile, dateOfBirth } });
    assert.equal(result.success, false);
    if (!result.success) assert.ok(fieldErrors(result.error)["applicantDetails.dateOfBirth"]);
  }
  for (const key of ["firstName", "lastName", "nationality", "currentAddress", "dateOfBirth", "placeOfBirth", "englishProficiency"] as const) {
    const { [key]: _missing, ...incomplete } = profile;
    void _missing;
    const result = applicationSchema.safeParse({ ...input, applicantDetails: incomplete });
    assert.equal(result.success, false);
    if (!result.success) assert.ok(fieldErrors(result.error)[`applicantDetails.${key}`]);
  }
  const boundedFields = { firstName: 60, lastName: 60, nationality: 80, currentAddress: 500, placeOfBirth: 160,
    telegram: 80, fatherName: 120, motherName: 120, secondaryPosition: 160, otherPosition: 160 };
  for (const [key, maximum] of Object.entries(boundedFields)) {
    const changedProfile = { ...profile, [key]: "x".repeat(maximum + 1) };
    assert.equal(applicationSchema.safeParse({ ...input, fullName: `${changedProfile.firstName} ${changedProfile.lastName}`, applicantDetails: changedProfile }).success, false);
  }
  for (const required of ["firstName", "lastName", "nationality", "currentAddress", "placeOfBirth"]) {
    assert.equal(applicationSchema.safeParse({ ...input, applicantDetails: { ...profile, [required]: " " } }).success, false);
  }
  const mismatch = applicationSchema.safeParse({ ...input, fullName: "Different Applicant", applicantDetails: profile });
  assert.equal(mismatch.success, false);
  if (!mismatch.success) assert.ok(fieldErrors(mismatch.error)["applicantDetails.firstName"]);
  const tooLongTogether = applicationSchema.safeParse({ ...input, applicantDetails: { ...profile, firstName: "a".repeat(60), lastName: "b".repeat(60) } });
  assert.equal(tooLongTogether.success, false);
  if (!tooLongTogether.success) assert.match(fieldErrors(tooLongTogether.error)["applicantDetails.firstName"], /120/);
  const longestName = `${"a".repeat(60)} ${"b".repeat(59)}`;
  assert.equal(applicationSchema.safeParse({ ...input, fullName: longestName, applicantDetails: { ...profile, firstName: "a".repeat(60), lastName: "b".repeat(59) } }).success, true);
  for (const applicantDetails of [null, [], { ...profile, englishProficiency: "Maybe" }, { ...profile, gender: "Unlisted" }, { ...profile, unexpected: "extra" }]) {
    assert.equal(applicationSchema.safeParse({ ...input, applicantDetails }).success, false);
  }
});

test("resume validation checks actual bytes, size, archives and filenames", async () => {
  assert.throws(
    () =>
      validateResumeBytes(Buffer.from("a disguised executable"), "resume.pdf"),
    UploadError,
  );
  assert.throws(
    () => validateResumeBytes(Buffer.alloc(5 * 1024 * 1024 + 1), "resume.pdf"),
    UploadError,
  );
  assert.throws(() => validateResumeBytes(pdf, "resume.exe"), UploadError);
  assert.throws(
    () =>
      validateResumeBytes(
        Buffer.from("PK\x03\x04not-a-word-document"),
        "resume.docx",
      ),
    UploadError,
  );
  const word = wordArchive({
    "[Content_Types].xml":
      '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "word/document.xml":
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
  });
  assert.equal(validateResumeBytes(word, "resume.docx").extension, "docx");
  const corrupt = Buffer.from(word);
  corrupt[40] ^= 1;
  assert.throws(() => validateResumeBytes(corrupt, "resume.docx"), UploadError);
  assert.throws(
    () =>
      validateResumeBytes(
        wordArchive({
          "[Content_Types].xml": "macroEnabled",
          "word/document.xml": "<w:document/>",
        }),
        "resume.docx",
      ),
    UploadError,
  );
  const doc = Buffer.alloc(1024);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(doc);
  doc.writeUInt16LE(0xfffe, 28);
  doc.writeUInt16LE(9, 30);
  Buffer.from("WordDocument\0", "utf16le").copy(doc, 512);
  assert.equal(validateResumeBytes(doc, "resume.doc").extension, "doc");
  const resume = validateResumeBytes(pdf, "../../danger\r\n.pdf");
  assert.equal(resume.name, "danger__.pdf");
  const key = await storeResume(resume);
  assert.deepEqual(await readObject(key), pdf);
  assert.deepEqual(
    await readFile(path.join(temporaryDirectory, "uploads", key)),
    pdf,
  );
  await assert.rejects(readObject("../../package.json"));
  await deleteObject(key);
});
test("staff photos decode to sanitized JPEG while invalid image bytes are rejected", async () => {
  const source = await sharp({
    create: { width: 400, height: 300, channels: 3, background: "blue" },
  })
    .png()
    .withMetadata({ orientation: 1 })
    .toBuffer();
  const url = await storeImage(
    new File([source], "photo.png", { type: "image/png" }),
  );
  const bytes = await readObject(`images/${url.split("/").at(-1)}`);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 400);
  assert.equal(metadata.exif, undefined);
  await assert.rejects(
    storeImage(
      new File([Buffer.from("fake-image")], "photo.png", { type: "image/png" }),
    ),
    UploadError,
  );
  await assert.rejects(
    storeImage(new File([source], "photo.svg", { type: "image/svg+xml" })),
    UploadError,
  );
});
test("passwords and signed sessions reject wrong, altered and expired credentials", async () => {
  const hash = await hashPassword("a strong test password");
  assert.equal(await verifyPassword("a strong test password", hash), true);
  assert.equal(await verifyPassword("the wrong password", hash), false);
  assert.notEqual(hash, await hashPassword("a strong test password"));
  const value = await signSession(randomUUID(), Date.now() + 60000);
  assert.ok(await decodeSession(value));
  assert.equal(await decodeSession(`${value.slice(0, -3)}abc`), undefined);
  assert.equal(
    await decodeSession(await signSession(randomUUID(), Date.now() - 100)),
    undefined,
  );
  assert.equal(
    sameOrigin(
      new Request(`${origin}/api/admin/jobs`, {
        headers: { origin: "https://hostile.example" },
      }),
    ),
    false,
  );
  assert.equal(sameOrigin(new Request(`${origin}/api/admin/jobs`)), false);
});
test("job edits survive database restart and record an audit", async () => {
  const [job] = await getJobs();
  assert.ok(job);
  const changed = { ...job, title: "Persisted warehouse role" };
  await saveJob(changed, "test-staff");
  await closeDatabase();
  assert.equal(
    (await getJobs()).find((item) => item.id === job.id)?.title,
    changed.title,
  );
  const events = await (
    await getDatabase()
  )
    .select()
    .from(audits)
    .where(eq(audits.targetId, job.id));
  assert.ok(events.some((event) => event.action === "job.updated"));
});
test("applications persist once; invalid uploads, bots and closed jobs never return success", async () => {
  const [job] = await getJobs();
  const payload = { ...applicant(job.id), discoverySource: "Instagram" as const, applicantDetails: applicantProfile() };
  const key = randomUUID();
  const first = await submit(applicationRequest(payload, key));
  assert.equal(first.status, 201, JSON.stringify(await first.clone().json()));
  const accepted = await first.json();
  assert.match(accepted.reference, /^CH-/);
  const retry = await submit(applicationRequest(payload, key));
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), accepted);
  assert.equal((await getApplications()).length, 1);
  assert.equal((await getApplications())[0].discoverySource, "Instagram");
  assert.deepEqual((await getApplications())[0].applicantDetails, payload.applicantDetails);
  assert.equal((await getApplications())[0].status, "New");
  const changedProfile = await submit(applicationRequest({ ...payload, applicantDetails: { ...payload.applicantDetails, englishProficiency: "Yes" } }, key));
  assert.equal(changedProfile.status, 409);
  const invalidProfile = await submit(applicationRequest({ ...payload, applicantDetails: { ...payload.applicantDetails, dateOfBirth: "2023-02-29" } }));
  assert.equal(invalidProfile.status, 422);
  assert.ok((await invalidProfile.json()).fieldErrors["applicantDetails.dateOfBirth"]);
  const inconsistentProfile = await submit(applicationRequest({ ...payload, applicantDetails: { ...payload.applicantDetails, firstName: "Different" } }));
  assert.equal(inconsistentProfile.status, 422);
  assert.ok((await inconsistentProfile.json()).fieldErrors["applicantDetails.firstName"]);
  const changedSource = await submit(applicationRequest({ ...payload, discoverySource: "Reddit" }, key));
  assert.equal(changedSource.status, 409);
  const invalidSource = await submit(applicationRequest({ ...payload, discoverySource: "Unlisted channel" }));
  assert.equal(invalidSource.status, 422);
  assert.ok((await invalidSource.json()).fieldErrors.discoverySource);
  const changed = await submit(
    applicationRequest({ ...payload, fullName: "Another Applicant", applicantDetails: { ...payload.applicantDetails, firstName: "Another" } }, key),
  );
  assert.equal(changed.status, 409);
  assert.equal(
    (
      await submit(
        applicationRequest(payload, randomUUID(), Buffer.from("fake")),
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await submit(
        applicationRequest(payload, randomUUID(), pdf, "resume.pdf", "spam"),
      )
    ).status,
    400,
  );
  assert.equal(
    (await submit(applicationRequest({ ...payload, jobId: "missing" }))).status,
    409,
  );
  await saveJob({ ...job, status: "closed" }, "test-staff");
  assert.equal((await submit(applicationRequest(payload))).status, 409);
  await saveJob(job, "test-staff");
  await closeDatabase();
  assert.equal((await getApplications())[0].reference, accepted.reference);
  assert.equal((await getApplications())[0].discoverySource, "Instagram");
  assert.deepEqual((await getApplications())[0].applicantDetails, payload.applicantDetails);
  const restartedRetry = await submit(applicationRequest(payload, key));
  assert.equal(restartedRetry.status, 200);
  assert.deepEqual(await restartedRetry.json(), accepted);
  const existing = (await getApplications())[0];
  await assert.rejects(
    createApplication(
      { ...existing, id: randomUUID() },
      randomUUID(),
      "collision-test",
    ),
  );
  assert.equal((await getApplications()).length, 1);
});
test("staff-only applicants, private downloads, status audits and session revocation", async () => {
  assert.equal(
    (
      await listApplications(
        new NextRequest(`${origin}/api/admin/applications`),
      )
    ).status,
    401,
  );
  const [application] = await getApplications();
  assert.equal(
    (
      await downloadResume(
        new NextRequest(
          `${origin}/api/admin/applications/${application.id}/resume`,
        ),
        { params: Promise.resolve({ id: application.id }) },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await publicImage(new NextRequest(`${origin}/api/images/resume.pdf`), {
        params: Promise.resolve({ key: "resume.pdf" }),
      })
    ).status,
    404,
  );
  const adminId = randomUUID();
  await (
    await getDatabase()
  )
    .insert(administrators)
    .values({
      id: adminId,
      email: "staff@example.test",
      passwordHash: await hashPassword("another strong password"),
    });
  const loginResponse = await signIn(
    new NextRequest(`${origin}/api/admin/session`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        email: "staff@example.test",
        password: "another strong password",
      }),
    }),
  );
  assert.equal(loginResponse.status, 200);
  assert.match(loginResponse.headers.get("set-cookie")!, /HttpOnly/i);
  assert.match(loginResponse.headers.get("set-cookie")!, /SameSite=strict/i);
  const value = loginResponse.cookies.get(SESSION_COOKIE)!.value;
  const headers = {
    origin,
    cookie: `${SESSION_COOKIE}=${value}`,
    "content-type": "application/json",
  };
  const privateApplications = await listApplications(new NextRequest(`${origin}/api/admin/applications`, { headers }));
  assert.equal(privateApplications.status, 200);
  assert.deepEqual((await privateApplications.json()).applications.find((item: { id: string }) => item.id === application.id).applicantDetails, applicantProfile());
  const photo = await sharp({
    create: { width: 400, height: 300, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const photoForm = new FormData();
  photoForm.set(
    "image",
    new File([photo], "staff-photo.png", { type: "image/png" }),
  );
  const photoResponse = await uploadPhoto(
    new NextRequest(`${origin}/api/admin/images`, {
      method: "POST",
      headers: { origin, cookie: headers.cookie },
      body: photoForm,
    }),
  );
  assert.equal(photoResponse.status, 201);
  const uploaded = await photoResponse.json();
  assert.match(uploaded.url, /^\/api\/images\/[a-f0-9-]+\.jpg$/);
  const [sample] = await getJobs();
  const jobResponse = await createJob(
    new NextRequest(`${origin}/api/admin/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...sample,
        slug: "test-new-photo-role",
        title: "New photo role",
        image: uploaded.url,
      }),
    }),
  );
  assert.equal(
    jobResponse.status,
    201,
    JSON.stringify(await jobResponse.clone().json()),
  );
  assert.equal(
    (await getJobs()).find((job) => job.slug === "test-new-photo-role")?.image,
    uploaded.url,
  );
  const duplicateSlug = await createJob(
    new NextRequest(`${origin}/api/admin/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...sample,
        slug: "test-new-photo-role",
        title: "Duplicate slug role",
        image: uploaded.url,
      }),
    }),
  );
  assert.equal(duplicateSlug.status, 409);
  const response = await downloadResume(
    new NextRequest(
      `${origin}/api/admin/applications/${application.id}/resume`,
      { headers },
    ),
    { params: Promise.resolve({ id: application.id }) },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition")!, /^attachment/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  const update = await changeStatus(
    new NextRequest(`${origin}/api/admin/applications/${application.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "Shortlisted" }),
    }),
    { params: Promise.resolve({ id: application.id }) },
  );
  assert.equal(update.status, 200);
  assert.equal((await getApplications())[0].status, "Shortlisted");
  assert.deepEqual((await getApplications())[0].applicantDetails, applicantProfile());
  const events = await (
    await getDatabase()
  )
    .select()
    .from(audits)
    .where(eq(audits.targetId, application.id));
  assert.ok(events.some((event) => event.action === "application.status"));
  const csrf = await changeStatus(
    new NextRequest(`${origin}/api/admin/applications/${application.id}`, {
      method: "PATCH",
      headers: { ...headers, origin: "https://hostile.example" },
      body: JSON.stringify({ status: "Rejected" }),
    }),
    { params: Promise.resolve({ id: application.id }) },
  );
  assert.equal(csrf.status, 403);
  await signOut(
    new NextRequest(`${origin}/api/admin/session`, {
      method: "DELETE",
      headers,
    }),
  );
  assert.equal(
    (
      await listApplications(
        new NextRequest(`${origin}/api/admin/applications`, { headers }),
      )
    ).status,
    401,
  );
});
test("rate limits persist and production fails closed without configuration", async () => {
  const request = new Request(origin);
  assert.equal(await rateLimit(request, "test-bucket", 2, 60), true);
  assert.equal(await rateLimit(request, "test-bucket", 2, 60), true);
  await closeDatabase();
  assert.equal(await rateLimit(request, "test-bucket", 2, 60), false);
  await closeDatabase();
  Object.assign(process.env, {
    NODE_ENV: "production",
    CHAPTER_LOCAL_MODE: "false",
  });
  try {
    assert.equal(localModeAllowed(), false);
    assert.throws(requireStorageConfiguration, /storage/);
    await assert.rejects(getDatabase(), /DATABASE_URL/);
    delete process.env.APP_ORIGIN;
    assert.equal(
      sameOrigin(
        new Request("https://chapter.example/api/admin/jobs", {
          headers: { origin: "https://chapter.example" },
        }),
      ),
      false,
    );
    process.env.APP_ORIGIN = "https://chapter.example";
    assert.equal(
      sameOrigin(
        new Request("https://chapter.example/api/admin/jobs", {
          headers: { origin: "https://chapter.example" },
        }),
      ),
      true,
    );
    delete process.env.SESSION_SECRET;
    await assert.rejects(
      signSession(randomUUID(), Date.now() + 60000),
      /SESSION_SECRET/,
    );
  } finally {
    Object.assign(process.env, {
      NODE_ENV: "test",
      CHAPTER_LOCAL_MODE: "true",
      APP_ORIGIN: origin,
      SESSION_SECRET: "test-only-secret-".repeat(4),
    });
  }
});
