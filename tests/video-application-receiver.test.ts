import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const source = readFileSync(new URL("../integrations/google-sheets/Code.gs", import.meta.url), "utf8");
const secret = "isolated-video-application-test-secret-".repeat(3);
const folderId = "private-video-fixture-folder";
const origin = "https://jobs-street.example";
type DriveFile = { id: string; name: string; mimeType: string; size: string; trashed: boolean; parents: string[]; appProperties: Record<string, string> };
type Reply = { ok: boolean; code?: string; sessionId?: string; uploadUrl?: string; photoUploadUrl?: string; applicationId?: string; reference?: string; row?: number; duplicate?: boolean };

function fixture() {
  const properties = new Map([["CHAPTER_WEBHOOK_SECRET", secret], ["CHAPTER_CV_FOLDER_ID", folderId]]);
  const state = {
    now: Date.now(), files: new Map<string, DriveFile>(), pending: new Map<string, Omit<DriveFile, "size" | "trashed">>(),
    allocations: 0, origins: [] as unknown[], sheets: new Map<string, unknown[][]>(),
  };
  const response = (data: unknown, status = 200, headers: Record<string, string> = {}) => ({
    getResponseCode: () => status, getContentText: () => JSON.stringify(data), getAllHeaders: () => headers,
  });
  function sheet(name: string) {
    const rows = state.sheets.get(name)!;
    return {
      getSheetId: () => 7,
      getLastRow: () => rows.length,
      getMaxRows: () => 1000,
      getMaxColumns: () => 26,
      insertRowsAfter: () => undefined,
      setFrozenRows: () => undefined,
      getRange: (row: number, column: number, count: number, columns: number) => ({
        getValues: () => Array.from({ length: count }, (_, index) => Array.from({ length: columns }, (_, c) => rows[row - 1 + index]?.[column - 1 + c] ?? "")),
        setValue: (value: unknown) => {
          (rows[row - 1] ??= [])[column - 1] = value;
          return { setFontWeight: () => undefined };
        },
        setValues: (values: unknown[][]) => {
          values.forEach((value, index) => { rows[row - 1 + index] = value; });
          return { setFontWeight: () => undefined };
        },
      }),
    };
  }
  const context = vm.createContext({
    testNow: state.now,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key: string) => properties.get(key) ?? null,
      getProperties: () => Object.fromEntries(properties),
      setProperty: (key: string, value: string) => { properties.set(key, value); },
      deleteProperty: (key: string) => { properties.delete(key); },
    }) },
    ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
    Utilities: {
      Charset: { UTF_8: "utf8" },
      computeHmacSha256Signature: (value: string, key: string) => [...createHmac("sha256", key).update(value).digest()],
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    SpreadsheetApp: {
      flush: () => undefined,
      openById: () => ({
        getSheetByName: (name: string) => state.sheets.has(name) ? sheet(name) : null,
        insertSheet: (name: string) => { state.sheets.set(name, []); return sheet(name); },
      }),
    },
    ScriptApp: { getOAuthToken: () => "video-fixture-token" },
    UrlFetchApp: { fetch: (url: string, options: Record<string, unknown>) => {
      const parsed = new URL(url);
      const headers = (options.headers || {}) as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer video-fixture-token");
      if (parsed.hostname === "sheets.googleapis.com") {
        const range = decodeURIComponent(parsed.pathname.split("/values/")[1]);
        const match = /^'(.+)'!A(\d+):([A-Z])\d+$/.exec(range)!;
        const values = JSON.parse(options.payload as string).values[0];
        state.sheets.get(match[1])![Number(match[2]) - 1] = values;
        return response({ updatedRange: range, updatedRows: 1, updatedColumns: values.length });
      }
      if (parsed.pathname.endsWith("/files/generateIds")) return response({ ids: Array.from({ length: Number(parsed.searchParams.get("count")) }, () => `allocated-video-${++state.allocations}`) });
      if (parsed.pathname.endsWith("/permissions")) return response({ permissions: [{ type: "user", role: "owner" }] });
      if (parsed.searchParams.get("uploadType") === "resumable") {
        state.origins.push(headers.Origin);
        const metadata = JSON.parse(options.payload as string);
        assert.deepEqual(metadata.parents, [folderId]);
        state.pending.set(metadata.id, metadata);
        return response({}, 200, { Location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${metadata.id}` });
      }
      const fileId = /\/files\/([^/]+)$/.exec(parsed.pathname)?.[1];
      if (fileId === folderId) return response({ id: folderId, mimeType: "application/vnd.google-apps.folder", trashed: false });
      if (fileId) {
        const file = state.files.get(fileId);
        if (!file) return response({ error: { code: 404 } }, 404);
        if (options.method === "patch") file.trashed = true;
        return response(file);
      }
      throw new Error(`Unexpected Google request: ${url}`);
    } },
  });
  vm.runInContext(source, context);
  vm.runInContext("Date.now = () => testNow", context);
  function post(payload: unknown): Reply {
    context.testNow = state.now;
    const serialized = JSON.stringify(payload);
    const signature = createHmac("sha256", secret).update(`${state.now}.${serialized}`).digest("hex");
    context.event = { postData: { contents: JSON.stringify({ timestamp: state.now, payload: serialized, signature }) } };
    return vm.runInContext("doPost(event)", context) as Reply;
  }
  const clientKey = createHash("sha256").update("client").digest("hex");
  const photo = { name: "face.jpg", mime: "image/jpeg", size: 2_000_000 };
  const start = (overrides: Record<string, unknown> = {}) => {
    const id = randomUUID();
    return { id, reply: post({ operation: "video-upload-start", version: 1, session: {
      id, name: "welding.mp4", mime: "video/mp4", size: 52_428_800, origin, clientKey, source: "Jobstreet Croatia", photo, ...overrides,
    } }) };
  };
  /** Simulates the browser finishing its direct resumable uploads to Google. */
  const finishUpload = (size = 52_428_800, photoSize = 2_000_000, only?: "video" | "photo") => {
    for (const [id, metadata] of state.pending) {
      const part = metadata.appProperties.chapterVideoPart === "photo" ? "photo" : "video";
      if (only && part !== only) continue;
      state.files.set(id, { ...metadata, size: String(part === "photo" ? photoSize : size), trashed: false });
      state.pending.delete(id);
    }
  };
  const submit = (id: string, overrides: Record<string, unknown> = {}) => post({ operation: "video-application-submit", version: 1, application: {
    id, reference: "VA-0123456789ABCDEF", submittedAt: new Date(state.now).toISOString(), fullName: "Juan Dela Cruz", age: 34,
    nationality: "Filipino", jobTitle: "Welder", experienceYears: 7, whatsapp: "+63 912 345 6789", telegram: "+63 912 345 6789",
    durationSeconds: 75, consent: true, source: "Jobstreet Croatia", ...overrides,
  } });
  return { state, properties, start, finishUpload, submit, post };
}

test("video receiver opens a private browser upload and records one row only after the file arrives", () => {
  const { state, start, finishUpload, submit } = fixture();
  const { id, reply } = start();
  assert.equal(reply.ok, true);
  assert.equal(reply.sessionId, id);
  assert.match(reply.uploadUrl!, /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?upload_id=allocated-video-1$/);
  assert.match(reply.photoUploadUrl!, /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?upload_id=allocated-video-2$/);
  assert.deepEqual(state.origins, [origin, origin], "The browser origin must be bound to both resumable sessions for CORS");
  assert.equal(state.pending.get("allocated-video-2")!.mimeType, "image/jpeg");

  assert.deepEqual(submit(id), { ok: false, code: "VIDEO_UPLOAD_INCOMPLETE" });
  finishUpload(52_428_800, 2_000_000, "video");
  assert.deepEqual(submit(id), { ok: false, code: "VIDEO_UPLOAD_INCOMPLETE" }, "A missing photo must block the row");
  finishUpload();
  const saved = submit(id);
  assert.deepEqual(saved, { ok: true, applicationId: id, reference: "VA-0123456789ABCDEF", row: 2, duplicate: false });
  const rows = state.sheets.get("Video Applications")!;
  assert.equal(rows[0][0], "Application ID");
  assert.equal(rows[0].length, 17);
  assert.equal(rows[0][16], "Applicant photo");
  assert.equal(rows[1][16], "https://drive.google.com/file/d/allocated-video-2/view");
  assert.deepEqual(rows[1].slice(3, 11), ["Juan Dela Cruz", 34, "Filipino", "Welder", 7, "+63 912 345 6789", "+63 912 345 6789",
    "https://drive.google.com/file/d/allocated-video-1/view"]);
  assert.equal(rows[1][12], 50);
  assert.equal(rows[1][13], 75);
  assert.deepEqual(submit(id), { ok: true, applicationId: id, reference: "VA-0123456789ABCDEF", row: 2, duplicate: true });
  assert.equal(rows.length, 2);
});

test("video receiver rejects oversized, unsupported or mismatched videos", () => {
  const { start, finishUpload, submit } = fixture();
  assert.deepEqual(start({ size: 100 * 1024 * 1024 + 1 }).reply, { ok: false, code: "INVALID_VIDEO" });
  assert.deepEqual(start({ name: "work.exe", mime: "video/mp4" }).reply, { ok: false, code: "INVALID_VIDEO" });
  assert.deepEqual(start({ origin: "javascript:alert(1)" }).reply, { ok: false, code: "INVALID_VIDEO" });
  assert.deepEqual(start({ photo: { name: "face.gif", mime: "image/gif", size: 1000 } }).reply, { ok: false, code: "INVALID_PHOTO" });
  assert.deepEqual(start({ photo: { name: "face.png", mime: "image/jpeg", size: 1000 } }).reply, { ok: false, code: "INVALID_PHOTO" });
  assert.deepEqual(start({ photo: { name: "face.jpg", mime: "image/jpeg", size: 10 * 1024 * 1024 + 1 } }).reply, { ok: false, code: "INVALID_PHOTO" });
  const { id } = start();
  finishUpload(1024);
  assert.deepEqual(submit(id), { ok: false, code: "VIDEO_SESSION_CONFLICT" });
  assert.deepEqual(submit(randomUUID()), { ok: false, code: "VIDEO_SESSION_NOT_FOUND" });
  assert.deepEqual(submit(id, { telegram: "" }), { ok: false, code: "INVALID_APPLICATION" });
  assert.deepEqual(submit(id, { durationSeconds: 30 }), { ok: false, code: "INVALID_APPLICATION" });
});

test("video receiver limits upload sessions per client and trashes abandoned uploads after a day", () => {
  const { state, start } = fixture();
  for (let index = 0; index < 6; index++) assert.equal(start().reply.ok, true);
  assert.deepEqual(start().reply, { ok: false, code: "VIDEO_RATE_LIMIT" });
  const firstFile = "allocated-video-1";
  state.files.set(firstFile, { id: firstFile, name: "x", mimeType: "video/mp4", size: "1", trashed: false, parents: [folderId],
    appProperties: { chapterVideoSessionId: [...state.pending.values()][0].appProperties.chapterVideoSessionId } });
  state.now += 25 * 60 * 60 * 1000;
  assert.equal(start().reply.ok, true);
  assert.equal(state.files.get(firstFile)!.trashed, true);
});

test("video receiver upgrades the earlier 16-column tab and still accepts sessions without a photo", () => {
  const { state, start, finishUpload, submit } = fixture();
  const oldHeaders = ["Application ID", "Reference", "Submitted at (UTC)", "Complete name", "Age", "Nationality",
    "Position applying for", "Years of experience", "WhatsApp number", "Telegram number",
    "Work video", "Video file", "Video size (MB)", "Video length (seconds)", "Terms and privacy accepted", "Application source"];
  state.sheets.set("Video Applications", [oldHeaders.slice(), ["earlier-row", "VA-AAAAAAAAAAAAAAAA"]]);
  const { id, reply } = start({ photo: undefined });
  assert.equal(reply.ok, true);
  assert.equal(reply.photoUploadUrl, undefined);
  finishUpload();
  const saved = submit(id);
  assert.equal(saved.ok, true);
  assert.equal(saved.row, 3);
  const rows = state.sheets.get("Video Applications")!;
  assert.deepEqual(rows[0], [...oldHeaders, "Applicant photo"]);
  assert.equal(rows[2][16], "");
});
