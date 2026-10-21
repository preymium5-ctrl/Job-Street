import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const source = readFileSync(new URL("../integrations/google-sheets/Code.gs", import.meta.url), "utf8");
const secret = "isolated-upload-staging-test-secret-".repeat(3);
const folderId = "private-staging-fixture-folder";
const chunkSize = 2 * 1024 * 1024;
type Manifest = {
  id: string; idempotencyKey: string; size: number; chunkSize: number; chunkCount: number;
  sha256: string; contentType: string; expiresAt: number; source: string; emailKey: string; clientKey: string;
};
type StageFile = {
  id: string; name: string; mimeType: string; size: string; trashed: boolean;
  parents: string[]; appProperties: Record<string, string>; driveId?: string; bytes: Buffer;
};
type Reply = { ok: boolean; code?: string; sessionId?: string; index?: number; size?: number; base64?: string };
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const properties = new Map([
    ["CHAPTER_WEBHOOK_SECRET", secret], ["CHAPTER_CV_FOLDER_ID", folderId], ["CHAPTER_SHEET_NAME", "Applications"],
  ]);
  const state = {
    now: Date.now(), files: new Map<string, StageFile>(), calls: [] as { url: string; options: Record<string, unknown> }[],
    allocations: 0, uploads: 0, locks: 0, releases: 0, folderPublic: false, publicFiles: new Set<string>(),
    failTrash: false, failUpload: false, failGeneration: false, failPartAcknowledgement: false, lockAvailable: true,
    sessions: new Map<string, Omit<StageFile, "bytes" | "size" | "trashed">>(),
  };
  function response(data: unknown, status = 200, headers: Record<string, string> = {}, bytes?: Buffer) {
    return {
      getResponseCode: () => status,
      getContentText: () => JSON.stringify(data),
      getAllHeaders: () => headers,
      getContent: () => [...(bytes ?? Buffer.from(JSON.stringify(data)))],
      getBlob: () => ({ getBytes: () => [...(bytes ?? Buffer.from(JSON.stringify(data)))] }),
    };
  }
  const context = vm.createContext({
    testNow: state.now,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key: string) => properties.get(key) ?? null,
      getProperties: () => Object.fromEntries(properties),
      setProperty: (key: string, value: string) => {
        if (state.failPartAcknowledgement && key.startsWith("CHAPTER_UPLOAD_STAGE_") && JSON.parse(value).parts?.some(Boolean)) {
          state.failPartAcknowledgement = false;
          throw new Error("Injected durable acknowledgement failure");
        }
        properties.set(key, value);
      },
      deleteProperty: (key: string) => { properties.delete(key); },
    }) },
    ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    Utilities: {
      Charset: { UTF_8: "utf8" }, DigestAlgorithm: { SHA_256: "SHA_256" },
      computeHmacSha256Signature: (value: string, key: string) => [...createHmac("sha256", key).update(value).digest()],
      computeDigest: (_algorithm: string, value: number[] | string) => [...createHash("sha256").update(typeof value === "string" ? value : Buffer.from(value)).digest()],
      base64Decode: (value: string) => [...Buffer.from(value, "base64")],
      base64Encode: (value: number[]) => Buffer.from(value).toString("base64"),
      newBlob: (value: number[]) => Buffer.from(value),
    },
    LockService: { getScriptLock: () => ({
      tryLock: () => { state.locks++; return state.lockAvailable; }, releaseLock: () => { state.releases++; },
    }) },
    SpreadsheetApp: new Proxy({}, { get() { throw new Error("Staging must never read or write the application spreadsheet"); } }),
    ScriptApp: { getOAuthToken: () => "staging-fixture-access-token" },
    UrlFetchApp: { fetch: (url: string, options: Record<string, unknown>) => {
      state.calls.push({ url, options });
      assert.equal((options.headers as Record<string, unknown>).Authorization, "Bearer staging-fixture-access-token");
      assert.equal(options.followRedirects, false);
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/files/generateIds")) {
        if (state.failGeneration) return response({ error: "private provider detail" }, 503);
        const count = Number(parsed.searchParams.get("count"));
        assert.ok(count >= 1 && count <= 8);
        const ids = Array.from({ length: count }, () => `allocated-part-${++state.allocations}`);
        return response({ ids, space: "drive" });
      }
      const fileId = /\/files\/([^/]+)(?:\/permissions)?$/.exec(parsed.pathname)?.[1];
      if (parsed.pathname.endsWith("/permissions")) return response({ permissions: [
        { type: "user", role: "owner" },
        ...((fileId === folderId ? state.folderPublic : state.publicFiles.has(fileId ?? ""))
          ? [{ type: "anyone", role: "reader" }] : []),
      ] });
      if (fileId === folderId) return response({ id: folderId, mimeType: "application/vnd.google-apps.folder", trashed: false });
      if (parsed.searchParams.get("uploadType") === "resumable") {
        assert.equal(options.method, "post");
        const metadata = JSON.parse(options.payload as string);
        assert.match(metadata.id, /^allocated-part-\d+$/);
        assert.deepEqual(metadata.parents, [folderId]);
        state.sessions.set(metadata.id, metadata);
        return response({}, 200, { Location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${metadata.id}` });
      }
      const uploadId = parsed.searchParams.get("upload_id");
      if (uploadId) {
        if (state.failUpload) return response({ error: "private provider detail" }, 503);
        assert.equal(options.method, "put");
        assert.ok(Buffer.isBuffer(options.payload));
        const bytes = Buffer.from(options.payload as Buffer);
        const metadata = state.sessions.get(uploadId)!;
        assert.ok(metadata, "Only a previously reserved explicit ID may be uploaded");
        assert.equal(state.files.has(uploadId), false, "An existing deterministic part may not be overwritten");
        const file = { ...metadata, size: String(bytes.length), trashed: false, bytes };
        state.files.set(uploadId, file);
        state.uploads++;
        return response(file);
      }
      if (fileId) {
        const file = state.files.get(fileId);
        if (!file) return response({ error: { code: 404 } }, 404);
        if (options.method === "patch") {
          assert.deepEqual(JSON.parse(options.payload as string), { trashed: true });
          if (state.failTrash) return response({ error: "private provider detail" }, 503);
          file.trashed = true;
        }
        return parsed.searchParams.get("alt") === "media" ? response({}, 200, {}, file.bytes) : response(file);
      }
      throw new Error(`Unexpected Google request: ${url}`);
    } },
  });
  vm.runInContext(source, context);
  vm.runInContext("Date.now = () => testNow", context);
  function post(payload: unknown, overrides: Record<string, unknown> = {}): Reply {
    context.testNow = state.now;
    const serialized = JSON.stringify(payload);
    const timestamp = state.now;
    const signature = createHmac("sha256", secret).update(`${timestamp}.${serialized}`).digest("hex");
    context.event = { postData: { contents: JSON.stringify({ timestamp, payload: serialized, signature, ...overrides }) } };
    return vm.runInContext("doPost(event)", context) as Reply;
  }
  function manifest(bytes = Buffer.from("synthetic multipart payload"), overrides: Partial<Manifest> = {}): Manifest {
    return { id: randomUUID(), idempotencyKey: randomUUID(), size: bytes.length, chunkSize,
      chunkCount: Math.ceil(bytes.length / chunkSize), sha256: digest(bytes), contentType: "multipart/form-data; boundary=test-staging-boundary",
      expiresAt: state.now + 30 * 60 * 1000, source: "Jobs in Croatia", emailKey: digest("synthetic-email"), clientKey: digest("synthetic-client"), ...overrides };
  }
  const init = (value: Manifest) => post({ operation: "upload-stage-init", version: 1, manifest: value });
  const write = (id: string, bytes: Buffer, index = 0) => post({ operation: "upload-stage-write", version: 1, sessionId: id, index, base64: bytes.toString("base64") });
  const read = (id: string, index = 0) => post({ operation: "upload-stage-read", version: 1, sessionId: id, index });
  return { state, properties, context, post, manifest, init, write, read };
}

function rejected(reply: Reply, expectedCode?: string) {
  assert.equal(reply.ok, false);
  if (expectedCode) assert.equal(reply.code, expectedCode);
  else assert.match(reply.code ?? "", /^(UPLOAD_STAGE_|INVALID_|EXPIRED_REQUEST|BUSY_RETRY|CV_NOT_PRIVATE)/,
    "Expected a validation error rather than an unexpected fixture or receiver exception");
  assert.equal("base64" in reply, false, "Rejected operations must not expose file contents");
}

test("staging operations reject invalid or expired HMAC envelopes before accessing Drive or persistent state", () => {
  for (const overrides of [{ signature: "0".repeat(64) }, { timestamp: Date.now() - 6 * 60 * 1000 }]) {
    const f = fixture();
    const before = [...f.properties];
    rejected(f.post({ operation: "upload-stage-init", version: 1, manifest: f.manifest() }, overrides));
    assert.equal(f.state.calls.length, 0);
    assert.deepEqual([...f.properties], before);
  }
});

test("staging init strictly validates manifest keys, identity, bounds, expiry and source before reserving Drive IDs", () => {
  const invalid: Record<string, unknown>[] = [
    { id: "not-a-uuid" }, { idempotencyKey: "not-a-uuid" }, { size: 0 }, { size: -1 },
    { size: 16 * 1024 * 1024 + 1 }, { size: 1.5 }, { chunkSize: chunkSize - 1 },
    { chunkCount: 0 }, { chunkCount: 2 }, { chunkCount: 9 }, { sha256: "x".repeat(64) },
    { contentType: "application/json" }, { contentType: "multipart/form-data; boundary=unsafe\r\nheader" },
    { expiresAt: 0 }, { expiresAt: Date.now() + 61 * 60 * 1000 },
    { source: "untrusted-site" }, { emailKey: "applicant@example.test" }, { clientKey: "198.51.100.7" },
    { unexpected: "field" },
  ];
  for (const overrides of invalid) {
    const f = fixture();
    const value = Object.assign(f.manifest(), overrides);
    rejected(f.init(value));
    assert.equal(f.state.allocations, 0, JSON.stringify(overrides));
    assert.equal(f.state.files.size, 0);
    assert.equal([...f.properties.keys()].filter((key) => key.startsWith("CHAPTER_UPLOAD_STAGE_")).length, 0);
  }
});

test("staging rejects unknown operations, extra operation fields and unsupported versions", () => {
  const f = fixture();
  for (const payload of [
    { operation: "upload-stage-unknown", version: 1 },
    { operation: "upload-stage-init", version: 2, manifest: f.manifest() },
    { operation: "upload-stage-init", version: 1, manifest: f.manifest(), extra: true },
  ]) rejected(f.post(payload));
  assert.equal(f.state.allocations, 0);
});

test("init persists explicit part reservations and an identical retry reuses them without creating files", () => {
  const f = fixture();
  const manifest = f.manifest(undefined, { size: 16 * 1024 * 1024, chunkCount: 8 });
  assert.deepEqual(f.init(manifest), { ok: true, sessionId: manifest.id });
  const stored = f.properties.get(`CHAPTER_UPLOAD_STAGE_${manifest.id}`);
  assert.ok(stored);
  assert.equal(f.state.allocations, 8);
  assert.equal(f.state.files.size, 0);
  assert.deepEqual(f.init(manifest), { ok: true, sessionId: manifest.id });
  assert.equal(f.properties.get(`CHAPTER_UPLOAD_STAGE_${manifest.id}`), stored);
  assert.equal(f.state.allocations, 8);
  rejected(f.init({ ...manifest, sha256: digest("changed-manifest") }));
  assert.equal(f.state.allocations, 8);
  assert.equal(f.state.locks, f.state.releases);
});

test("a publicly shared destination folder is rejected before part reservations or upload", () => {
  const f = fixture();
  f.state.folderPublic = true;
  rejected(f.init(f.manifest()));
  assert.equal(f.state.allocations, 0);
  assert.equal(f.state.files.size, 0);
});

test("staged chunks round trip privately, including a full first chunk and shorter last chunk", () => {
  const f = fixture();
  const bytes = Buffer.alloc(chunkSize + 73, 91);
  const manifest = f.manifest(bytes);
  assert.equal(f.init(manifest).ok, true);
  for (let index = 0; index < 2; index++) {
    const part = bytes.subarray(index * chunkSize, Math.min(bytes.length, (index + 1) * chunkSize));
    assert.deepEqual(f.write(manifest.id, part, index), { ok: true, sessionId: manifest.id, index, size: part.length });
    const reply = f.read(manifest.id, index);
    assert.deepEqual(reply, { ok: true, sessionId: manifest.id, index, base64: part.toString("base64") });
  }
  assert.equal(f.state.files.size, 2);
  assert.equal(f.state.uploads, 2);
  for (const file of f.state.files.values()) {
    assert.deepEqual(file.parents, [folderId]);
    assert.equal(file.trashed, false);
    assert.ok(Object.values(file.appProperties).includes(manifest.id));
  }
  assert.equal(f.state.calls.some(({ url }) => url.includes("/files?q=")), false, "Part retries may not rely on eventually consistent Drive search");
  assert.equal(f.state.locks, f.state.releases);
});

test("a lost write acknowledgement can retry the same deterministic part, while different bytes cannot replace it", () => {
  const f = fixture();
  const bytes = Buffer.from("original part data");
  const manifest = f.manifest(bytes);
  assert.equal(f.init(manifest).ok, true);
  assert.equal(f.write(manifest.id, bytes).ok, true);
  assert.equal(f.write(manifest.id, bytes).ok, true);
  assert.equal(f.state.uploads, 1);
  rejected(f.write(manifest.id, Buffer.alloc(bytes.length, 63)), "UPLOAD_STAGE_CONFLICT");
  assert.equal(f.state.uploads, 1);
  assert.equal(f.read(manifest.id).base64, bytes.toString("base64"));
});

test("write and read validate session, index, base64 and exact expected chunk length", () => {
  const f = fixture();
  const bytes = Buffer.alloc(chunkSize + 10, 33);
  const manifest = f.manifest(bytes);
  assert.equal(f.init(manifest).ok, true);
  for (const index of [-1, 2, 0.5]) {
    rejected(f.write(manifest.id, bytes.subarray(0, 10), index));
    rejected(f.read(manifest.id, index));
  }
  rejected(f.write(randomUUID(), Buffer.from("missing")));
  rejected(f.read(randomUUID()));
  rejected(f.write(manifest.id, Buffer.alloc(chunkSize - 1), 0));
  rejected(f.write(manifest.id, Buffer.alloc(11), 1));
  rejected(f.post({ operation: "upload-stage-write", version: 1, sessionId: manifest.id, index: 1, base64: "not base64!!!!" }));
  rejected(f.read(manifest.id, 0));
  assert.equal(f.state.uploads, 0);
});

test("read refuses missing, public, foreign, truncated or modified stage files", () => {
  const mutations: ((f: ReturnType<typeof fixture>, file: StageFile) => void)[] = [
    (f, file) => { f.state.files.delete(file.id); },
    (f, file) => { f.state.publicFiles.add(file.id); },
    (_f, file) => { file.parents = ["foreign-folder"]; },
    (_f, file) => { file.appProperties = { unrelated: "file" }; },
    (_f, file) => { file.driveId = "shared-drive-id"; },
    (_f, file) => { file.trashed = true; },
    (_f, file) => { file.size = String(Number(file.size) - 1); },
    (_f, file) => { file.bytes = Buffer.alloc(file.bytes.length, 63); },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    const bytes = Buffer.from("private original part");
    const manifest = f.manifest(bytes);
    assert.equal(f.init(manifest).ok, true);
    assert.equal(f.write(manifest.id, bytes).ok, true);
    mutate(f, [...f.state.files.values()][0]);
    rejected(f.read(manifest.id));
  }
});

test("expired sessions cannot be written or read and cleanup only trashes their exact owned part IDs", () => {
  const f = fixture();
  const bytes = Buffer.from("expired private synthetic data");
  const manifest = f.manifest(bytes);
  assert.equal(f.init(manifest).ok, true);
  assert.equal(f.write(manifest.id, bytes).ok, true);
  const ownFile = [...f.state.files.values()][0];
  const unrelated: StageFile = { ...ownFile, id: "unrelated-real-document", appProperties: { unrelated: "true" }, bytes: Buffer.from("unrelated") };
  f.state.files.set(unrelated.id, unrelated);
  f.state.now = manifest.expiresAt + 1;
  rejected(f.read(manifest.id));
  rejected(f.write(manifest.id, bytes));
  assert.equal(f.init(f.manifest(undefined, { emailKey: digest("next-email"), clientKey: digest("next-client") })).ok, true);
  assert.equal(ownFile.trashed, true);
  assert.equal(unrelated.trashed, false);
  assert.equal(f.state.calls.some(({ options }) => options.method === "delete"), false, "Expiration cleanup must remain recoverable in Drive Trash");
});

test("persistent admission limits allow retries but reject a fourth session for the same email", () => {
  const f = fixture();
  const admitted: Manifest[] = [];
  for (let index = 0; index < 3; index++) {
    const manifest = f.manifest();
    admitted.push(manifest);
    assert.equal(f.init(manifest).ok, true);
  }
  assert.equal(f.init(admitted[0]).ok, true);
  const before = f.state.allocations;
  rejected(f.init(f.manifest()));
  assert.equal(f.state.allocations, before);
  f.state.now += 31 * 60 * 1000;
  rejected(f.init(f.manifest()));
  assert.equal(f.state.allocations, before, "Expired upload files must not erase the hourly admission quota");
});

test("persistent admission limits reject a twenty-first source session even with different email and client keys", () => {
  const f = fixture();
  for (let index = 0; index < 20; index++) {
    assert.equal(f.init(f.manifest(undefined, { emailKey: digest(`email-${index}`), clientKey: digest(`client-${index}`) })).ok, true);
  }
  const before = f.state.allocations;
  rejected(f.init(f.manifest(undefined, { emailKey: digest("email-21"), clientKey: digest("client-21") })));
  assert.equal(f.state.allocations, before);
  f.state.now += 61 * 60 * 1000;
  assert.equal(f.init(f.manifest()).ok, true);
});

test("a client cannot bypass its persistent twenty-session quota by changing site or email", () => {
  const f = fixture();
  for (let index = 0; index < 20; index++) {
    assert.equal(f.init(f.manifest(undefined, {
      source: index % 2 ? "Jobstreet Croatia" : "Jobs in Croatia", emailKey: digest(`rotated-email-${index}`),
    })).ok, true);
  }
  const before = f.state.allocations;
  rejected(f.init(f.manifest(undefined, { emailKey: digest("rotated-email-21") })), "UPLOAD_STAGE_RATE_LIMIT");
  assert.equal(f.state.allocations, before);
});

test("a failed ID allocation retains its quota reservation and the exact init can safely recover", () => {
  const f = fixture();
  const manifest = f.manifest();
  f.state.failGeneration = true;
  rejected(f.init(manifest), "RECEIVER_ERROR");
  const reservation = JSON.parse(f.properties.get(`CHAPTER_UPLOAD_STAGE_${manifest.id}`)!);
  assert.deepEqual(reservation.ids, []);
  assert.equal(reservation.manifest.id, manifest.id);
  f.state.failGeneration = false;
  assert.equal(f.init(manifest).ok, true);
  assert.equal(f.state.allocations, 1);
  assert.equal([...f.properties.keys()].filter((key) => key.startsWith("CHAPTER_UPLOAD_STAGE_")).length, 1);
});

test("an upload or ledger acknowledgement failure can retry without allocating a second part", () => {
  for (const failPartAcknowledgement of [false, true]) {
    const f = fixture();
    const bytes = Buffer.from("synthetic retry verification part");
    const manifest = f.manifest(bytes);
    assert.equal(f.init(manifest).ok, true);
    f.state.failUpload = !failPartAcknowledgement;
    f.state.failPartAcknowledgement = failPartAcknowledgement;
    rejected(f.write(manifest.id, bytes), "RECEIVER_ERROR");
    f.state.failUpload = false;
    assert.equal(f.write(manifest.id, bytes).ok, true);
    assert.equal(f.state.files.size, 1);
    assert.equal(f.state.uploads, 1);
    assert.equal(f.state.allocations, 1);
    assert.equal(f.read(manifest.id).base64, bytes.toString("base64"));
  }
});

test("cleanup failures preserve their ledger entry for retry and never trash foreign files", () => {
  for (const foreign of [false, true]) {
    const f = fixture();
    const bytes = Buffer.from("synthetic expired part");
    const manifest = f.manifest(bytes);
    assert.equal(f.init(manifest).ok, true);
    assert.equal(f.write(manifest.id, bytes).ok, true);
    const file = [...f.state.files.values()][0];
    if (foreign) file.appProperties.chapterUploadId = randomUUID();
    else f.state.failTrash = true;
    f.state.now = manifest.expiresAt + 1;
    rejected(f.init(f.manifest(undefined, { emailKey: digest("different-email") })), foreign ? "UPLOAD_STAGE_CONFLICT" : "RECEIVER_ERROR");
    assert.equal(file.trashed, false);
    assert.ok(f.properties.has(`CHAPTER_UPLOAD_STAGE_${manifest.id}`));
    assert.equal(JSON.parse(f.properties.get(`CHAPTER_UPLOAD_STAGE_${manifest.id}`)!).cleanupIndex, 0);
    assert.equal(f.state.allocations, 1);
    if (!foreign) {
      f.state.failTrash = false;
      assert.equal(f.init(f.manifest(undefined, { emailKey: digest("different-email") })).ok, true);
      assert.equal(file.trashed, true);
    }
  }
});

test("each cleanup pass probes at most eight reserved file IDs", () => {
  const f = fixture();
  for (let index = 0; index < 2; index++) {
    const manifest = f.manifest(undefined, { size: 16 * 1024 * 1024, chunkCount: 8 });
    assert.equal(f.init(manifest).ok, true);
  }
  f.state.now += 31 * 60 * 1000;
  f.state.calls.length = 0;
  assert.equal(f.init(f.manifest()).ok, true);
  const reservedProbes = f.state.calls.filter(({ url }) => /\/files\/allocated-part-\d+\?/.test(url));
  assert.equal(reservedProbes.length, 8);
});

test("read can proceed without the writer lock while init and write refuse a busy lock", () => {
  const f = fixture();
  const bytes = Buffer.from("immutable read verification");
  const manifest = f.manifest(bytes);
  assert.equal(f.init(manifest).ok, true);
  assert.equal(f.write(manifest.id, bytes).ok, true);
  const priorLocks = f.state.locks;
  f.state.lockAvailable = false;
  assert.equal(f.read(manifest.id).base64, bytes.toString("base64"));
  assert.equal(f.state.locks, priorLocks);
  rejected(f.write(manifest.id, bytes), "BUSY_RETRY");
  rejected(f.init(f.manifest()), "BUSY_RETRY");
});
