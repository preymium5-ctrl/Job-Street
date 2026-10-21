import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import vm from "node:vm";
import { test } from "node:test";
import { buildSheetsPayload, type SheetsAcknowledgement, type SheetsTransport } from "../lib/sheets-transport";
import { saveApplicationToGoogle } from "../lib/google-application-storage";
import { discoverySources, type Application, type ApplicationInput, type Job } from "../lib/types";
import type { SupportingDocumentCategory } from "../lib/document-uploads";

const source = readFileSync(new URL("../integrations/google-sheets/Code.gs", import.meta.url), "utf8");
const secret = "receiver-unit-test-secret-".repeat(3);
const folderId = "private-test-folder-id";
type DriveFile = { id: string; name: string; mimeType: string; size: string; trashed: boolean;
  parents: string[]; appProperties: Record<string, string>; };

function fixture() {
  const properties = new Map([
    ["CHAPTER_WEBHOOK_SECRET", secret], ["CHAPTER_CV_FOLDER_ID", folderId],
    ["CHAPTER_SHEET_NAME", "Applications"],
  ]);
  const state = {
    rows: [] as unknown[][], files: [] as DriveFile[], calls: [] as { url: string; options: Record<string, unknown> }[],
    notes: [] as string[][],
    columnMetadata: Array.from({ length: 54 }, (_, index) => ({ format: `format-${index}`, validation: `validation-${index}` })),
    backups: [] as { name: string; hidden: boolean; rows: unknown[][]; notes: string[][]; columnMetadata: { format: string; validation: string }[] }[],
    failBackup: false, corruptBackup: false, frozenRows: 1, frozenColumns: 3,
    filter: { row: 1, column: 1, rows: 1000, columns: 54, criteria: {} as Record<number, unknown> } as { row: number; column: number; rows: number; columns: number; criteria: Record<number, unknown> } | null,
    writeFailures: 0, writeWrongAck: false, hideSearchResults: false, maxRows: 1000, maxColumns: 54, folderPublic: false, filePublic: false, locks: 0, releases: 0,
    validationChanges: [] as { action: string; row: number; column: number; count: number; columns: number; rule?: unknown }[],
    stagedFile: undefined as Omit<DriveFile, "id" | "size" | "trashed"> | undefined,
  };
  const response = (data: unknown, status = 200, headers = {}) => ({
    getResponseCode: () => status, getContentText: () => JSON.stringify(data), getAllHeaders: () => headers,
  });
  const filterHandle = () => ({
    getRange: () => ({ getColumn: () => state.filter!.column, getNumColumns: () => state.filter!.columns }),
    getColumnFilterCriteria: (column: number) => state.filter!.criteria[column] ?? null,
    setColumnFilterCriteria: (column: number, criterion: unknown) => { state.filter!.criteria[column] = criterion; },
    remove: () => { state.filter = null; },
  });
  const sheet = {
    getName: () => "Applications", getSheetId: () => 0, getParent: (): object => spreadsheet,
    setFrozenRows: (count: number) => { state.frozenRows = count; },
    setFrozenColumns: (count: number) => { state.frozenColumns = count; },
    getFilter: () => state.filter ? filterHandle() : null,
    copyTo: (parent: unknown) => {
      assert.equal(parent, spreadsheet);
      assert.ok(state.locks > state.releases, "Backups and migration must hold the writer lock");
      const backup = { name: "Copy of Applications", hidden: false, rows: structuredClone(state.rows), notes: structuredClone(state.notes), columnMetadata: structuredClone(state.columnMetadata) };
      if (state.corruptBackup && backup.rows.length > 1) backup.rows[1][2] = "Corrupted backup value";
      state.backups.push(backup);
      return backupHandle(backup);
    },
    getLastRow: () => state.rows.length,
    getMaxRows: () => state.maxRows,
    getMaxColumns: () => state.maxColumns,
    deleteColumns: (column: number, count: number) => {
      state.rows.forEach((row) => row.splice(column - 1, count)); state.maxColumns -= count;
      state.notes.forEach((row) => row.splice(column - 1, count));
      state.columnMetadata.splice(column - 1, count);
    },
    insertRowsAfter: (after: number, count: number) => { assert.equal(after, state.maxRows); state.maxRows += count; },
    insertColumnsAfter: (after: number, count: number) => {
      assert.equal(after, state.maxColumns); state.maxColumns += count;
      for (let index = 0; index < count; index++) state.columnMetadata.push({ format: "default", validation: "default" });
    },
    getLastColumn: () => Math.max(0, ...state.rows.map((row) => row.length)),
    getRange: (row: number, column: number, count = 1, columns = 1) => ({
      getColumn: () => column,
      getNumColumns: () => columns,
      getValues: () => Array.from({ length: count }, (_, index) =>
        Array.from({ length: columns }, (_, offset) => state.rows[row - 1 + index]?.[column - 1 + offset] ?? "")),
      getValue: () => state.rows[row - 1]?.[column - 1] ?? "",
      getNote: () => state.notes[row - 1]?.[column - 1] ?? "",
      getNotes: () => Array.from({ length: count }, (_, index) =>
        Array.from({ length: columns }, (_, offset) => state.notes[row - 1 + index]?.[column - 1 + offset] ?? "")),
      setNotes: (values: string[][]) => values.forEach((cells, index) => {
        const target = state.notes[row - 1 + index] ??= [];
        cells.forEach((value, offset) => { target[column - 1 + offset] = value; });
      }),
      setValue: (value: unknown) => { (state.rows[row - 1] ??= [])[column - 1] = value; },
      setValues: (values: unknown[][]) => {
        values.forEach((cells, index) => {
          const target = state.rows[row - 1 + index] ??= [];
          cells.forEach((value, offset) => { target[column - 1 + offset] = value; });
        });
      },
      clearDataValidations: () => { state.validationChanges.push({ action: "clear", row, column, count, columns }); },
      setDataValidation: (rule: unknown) => { state.validationChanges.push({ action: "set", row, column, count, columns, rule }); },
      createFilter: () => { state.filter = { row, column, rows: count, columns, criteria: {} }; return filterHandle(); },
    }),
  };
  function backupHandle(backup: (typeof state.backups)[number]) {
    return {
      setName: (name: string) => { backup.name = name; return backupHandle(backup); },
      hideSheet: () => { if (!state.failBackup) backup.hidden = true; },
      isSheetHidden: () => backup.hidden,
      getLastRow: () => backup.rows.length,
      getLastColumn: () => Math.max(0, ...backup.rows.map((row) => row.length)),
      getRange: (row: number, column: number, count: number, columns: number) => ({
        getValues: () => Array.from({ length: count }, (_, index) => Array.from({ length: columns }, (_, offset) => backup.rows[row - 1 + index]?.[column - 1 + offset] ?? "")),
        getNotes: () => Array.from({ length: count }, (_, index) => Array.from({ length: columns }, (_, offset) => backup.notes[row - 1 + index]?.[column - 1 + offset] ?? "")),
      }),
    };
  }
  const spreadsheet = { getSheetByName: (name: string): unknown => name === "Applications" ? sheet : state.backups.find((backup) => backup.name === name) };
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key: string) => properties.get(key) ?? null,
      setProperty: (key: string, value: string) => properties.set(key, value),
    }) },
    ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: (text: string) => ({
      setMimeType: () => JSON.parse(text),
    }) },
    Utilities: {
      Charset: { UTF_8: "utf8" },
      computeHmacSha256Signature: (value: string, key: string) => [...createHmac("sha256", key).update(value).digest()],
      base64Decode: (value: string) => [...Buffer.from(value, "base64")],
      newBlob: (bytes: number[]) => Buffer.from(bytes),
    },
    LockService: { getScriptLock: () => ({
      tryLock: () => { state.locks++; return true; }, releaseLock: () => { state.releases++; },
    }) },
    SpreadsheetApp: {
      openById: () => spreadsheet,
      newDataValidation: () => {
        const rule = { choices: [] as string[], showDropdown: false, allowInvalid: true };
        const builder = {
          requireValueInList: (choices: string[], showDropdown: boolean) => { rule.choices = [...choices]; rule.showDropdown = showDropdown; return builder; },
          setAllowInvalid: (allowInvalid: boolean) => { rule.allowInvalid = allowInvalid; return builder; },
          build: () => rule,
        };
        return builder;
      },
    },
    ScriptApp: { getOAuthToken: () => "mock-google-access-token" },
    UrlFetchApp: { fetch: (url: string, options: Record<string, unknown>) => {
      state.calls.push({ url, options });
      assert.equal((options.headers as Record<string, unknown>).Authorization, "Bearer mock-google-access-token");
      assert.equal(options.followRedirects, false);
      if (url.includes("/permissions?")) return response({ permissions: [
        { type: "user", role: "owner" },
        ...(url.includes(folderId) && state.folderPublic || !url.includes(folderId) && state.filePublic
          ? [{ type: "anyone", role: "reader" }] : []),
      ] });
      if (url.includes("/files/" + folderId + "?")) return response({
        id: folderId, mimeType: "application/vnd.google-apps.folder", trashed: false,
      });
      if (url.includes("/drive/v3/files?q=")) {
        const query = decodeURIComponent(url);
        const applicationId = /key='chapterApplicationId' and value='([^']+)'/.exec(query)?.[1];
        const documentId = /key='chapterDocumentId' and value='([^']+)'/.exec(query)?.[1];
        assert.ok(!/has\s*\{\s*key='[^']+'\s*\}/.test(query), "Drive property searches require key and value");
        return response({ files: state.hideSearchResults ? [] : state.files.filter((file) => file.appProperties.chapterApplicationId === applicationId &&
          (!documentId || file.appProperties.chapterDocumentId === documentId)) });
      }
      if (url.includes("uploadType=resumable")) {
        state.stagedFile = JSON.parse(options.payload as string);
        return response({}, 200, { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=mock" });
      }
      if (url.includes("upload_id=mock")) {
        assert.ok(Buffer.isBuffer(options.payload));
        const file = { ...state.stagedFile!, id: "private-cv-" + (state.files.length + 1),
          size: String((options.payload as Buffer).length), trashed: false };
        state.files.push(file);
        return response(file);
      }
      if (url.endsWith(":batchUpdate")) {
        assert.equal(options.method, "post");
        const requests = JSON.parse(options.payload as string).requests;
        if (requests.length === 1) {
          const write = requests[0].updateCells;
          assert.equal(write.fields, "userEnteredValue");
          assert.deepEqual(write.start, { sheetId: 0, rowIndex: 0, columnIndex: 35 });
          if (state.writeFailures-- > 0) return response({ error: "Private Google failure detail" }, 503);
          write.rows.forEach((row: { values: { userEnteredValue: { stringValue: string } }[] }, index: number) => {
            assert.equal(row.values.length, 1);
            assert.equal(typeof row.values[0].userEnteredValue.stringValue, "string");
            (state.rows[index] ??= [])[35] = row.values[0].userEnteredValue.stringValue;
          });
          return response({ spreadsheetId: "1v9-lAvpJPUCxCqr03EkVwKKAfedEDtckHir4ro6cyeU", replies: state.writeWrongAck ? [] : [{}] });
        }
        assert.equal(requests.length, 2);
        const write = requests[0].updateCells;
        const note = requests[1].updateCells;
        assert.equal(write.fields, "userEnteredValue");
        assert.equal(note.fields, "note");
        assert.equal(write.start.sheetId, 0);
        assert.equal(note.start.sheetId, 0);
        assert.equal(note.start.rowIndex, write.start.rowIndex);
        assert.equal(note.start.columnIndex, 0);
        assert.equal(note.rows[0].values.length, 1);
        assert.ok([0, 14].includes(write.start.columnIndex));
        assert.equal(write.rows[0].values.length, state.rows[0].length - write.start.columnIndex);
        if (state.writeFailures-- > 0) return response({ error: "Private Google failure detail" }, 503);
        const target = state.rows[write.start.rowIndex] ??= [];
        write.rows[0].values.forEach((cell: { userEnteredValue: { stringValue?: string; numberValue?: number; formulaValue?: string } }, index: number) => {
          assert.ok(!("formulaValue" in cell.userEnteredValue));
          target[write.start.columnIndex + index] = cell.userEnteredValue.stringValue ?? cell.userEnteredValue.numberValue;
        });
        (state.notes[note.start.rowIndex] ??= [])[0] = note.rows[0].values[0].note;
        return response({ spreadsheetId: "1v9-lAvpJPUCxCqr03EkVwKKAfedEDtckHir4ro6cyeU", replies: state.writeWrongAck ? [] : [{}, {}] });
      }
      if (url.includes("/values/")) {
        assert.equal(options.method, "put");
        const match = /\/values\/'Applications'!(A|AD|AE)(\d+):(AD|BB)(\d+)\?valueInputOption=RAW$/.exec(decodeURIComponent(url));
        assert.ok(match);
        const rowNumber = Number(match[2]);
        assert.equal(rowNumber, Number(match[4]));
        const firstColumn = match[1] === "A" ? 0 : match[1] === "AD" ? 29 : 30;
        if (firstColumn === 0) assert.equal(rowNumber, state.rows.length + 1);
        else assert.ok(rowNumber >= 2 && rowNumber <= state.rows.length);
        if (state.writeFailures-- > 0) return response({ error: "Private Google failure detail" }, 503);
        const row = JSON.parse(options.payload as string).values[0];
        assert.equal(row.length, match[3] === "AD" ? 1 : 54 - firstColumn);
        const target = state.rows[rowNumber - 1] ??= [];
        row.forEach((value: unknown, index: number) => { target[firstColumn + index] = value; });
        return response({ updatedRows: 1, updatedColumns: state.writeWrongAck ? 1 : row.length,
          updatedRange: "'Applications'!" + match[1] + rowNumber + ":" + match[3] + rowNumber });
      }
      const file = state.files.find((item) => url.includes("/files/" + item.id + "?"));
      if (file) return response(file);
      throw new Error("Unexpected Google request: " + url);
    } },
  });
  vm.runInContext(source, context);
  state.rows.push([...vm.runInContext("CHAPTER_HEADERS", context)]);
  function post(payload: unknown = application(), overrides: Record<string, unknown> = {}) {
    const timestamp = Date.now();
    const serialized = JSON.stringify(payload);
    const signature = createHmac("sha256", secret).update(`${timestamp}.${serialized}`).digest("hex");
    context.event = { postData: { contents: JSON.stringify({ timestamp, payload: serialized, signature, ...overrides }) } };
    return vm.runInContext("doPost(event)", context) as {
      ok: boolean; code?: string; duplicate?: boolean; applicationId?: string; reference?: string; row?: number;
    };
  }
  return { state, post, context, properties };
}

function application() {
  return {
    version: 1,
    application: {
      id: "69e88566-3117-4b32-9540-f3a66c1b1f45", reference: "CH-2026-ABCDEF0123456789",
      submittedAt: "2026-10-15T08:00:00.000Z", jobTitle: "Fabricator", jobId: "proposed-fabricator-01",
      status: "New", fullName: "=SUM(1,1)", email: "applicant@example.test", phone: "+63 917 123 4567",
      country: "Philippines", recentJobTitle: "Fabricator", experienceYears: 2, skills: "=HYPERLINK(\"https://example.test\")",
      education: "High school", summary: "", coverLetter: "", consent: true,
      nc2Certificate: "NC2 Fabricator", documentReadiness: { nc2: "ready", diploma: "ready", nbi: "in-progress", form18a: "not-yet" },
      preferredEmployer: "Končar MK", expectedNc2: "NC2 Fabricator", employers: [{ name: "Končar MK", workers: 5 }],
    },
    resume: { name: "CV.pdf", mime: "application/pdf", base64: Buffer.from("%PDF-1.4\nTest CV\n%%EOF").toString("base64") },
  };
}

function profileApplication() {
  const original = application();
  return { ...original, version: 3, documents: ["diploma", "nc2", "nbi", "form18a", "other", "driver-license", "passport", "residence-id", "employment-certificate"].map((category) => ({
    ...original.resume, id: `profile-${category}`, category, name: `${category}.pdf`,
  })), application: { ...original.application, recentJobTitle: "", experienceYears: null, skills: "",
    referralSource: "Google Search", driverLicenseDetails: "Professional, Philippines", applicationSource: "Jobs in Croatia", applicationFormVersion: "profile-v1",
    profile: { firstName: "=SUM(1,1)", lastName: "Applicant", gender: "Female", nationality: "Filipino", address: "17 Sample Street, Manila, Metro Manila, 0017",
      street: "17 Sample Street", city: "Manila", province: "Metro Manila", postalCode: "0017", dateOfBirth: "1990-01-01", placeOfBirth: "Manila",
      fatherName: "Applicant Father", motherName: "Applicant Mother", destinationCountry: "Macedonia", currentWorkCountry: "Philippines",
      secondaryJobTitle: "Welder", otherJobTitle: "Warehouse operator", englishProficiency: "Yes", telegram: "+63 917 123 4567", termsAccepted: true,
    },
  } };
}

function seedRateRow(rows: unknown[][], index: number, options: { email?: string; source?: string; submittedAt?: string | Date } = {}) {
  const row = Array<unknown>(54).fill("");
  row[0] = `rate-limit-id-${index}`;
  row[1] = `RATE-LIMIT-REF-${index}`;
  row[3] = options.email ?? `existing-${index}@example.test`;
  row[7] = options.submittedAt ?? new Date(Date.now() - 60_000).toISOString();
  row[53] = options.source ?? "Jobs in Croatia";
  rows.push(row);
}

test("Apps Script limits new Jobs in Croatia submissions to twenty per hour before creating files", () => {
  const { state, post } = fixture();
  for (let index = 0; index < 20; index++) seedRateRow(state.rows, index);
  assert.deepEqual(post(profileApplication()), { ok: false, code: "SUBMISSION_RATE_LIMIT" });
  assert.equal(state.files.length, 0);
  assert.equal(state.rows.length, 21);
  assert.ok(!state.calls.some(({ url }) => url.includes("uploadType=")));
  assert.equal(state.locks, state.releases);
});

test("Apps Script accepts the twentieth Jobs in Croatia application and persists the limit for the next request", () => {
  const { state, post } = fixture();
  for (let index = 0; index < 19; index++) seedRateRow(state.rows, index);
  const first = profileApplication();
  first.application.submittedAt = new Date().toISOString();
  assert.equal(post(first).ok, true);
  const next = profileApplication();
  next.application.id += "-next";
  next.application.reference += "-next";
  next.application.email = "next@example.test";
  const fileCount = state.files.length;
  assert.deepEqual(post(next), { ok: false, code: "SUBMISSION_RATE_LIMIT" });
  assert.equal(state.files.length, fileCount);
  assert.equal(state.rows.length, 21);
});

test("Apps Script limits a normalized email to three applications per hour", () => {
  const { state, post } = fixture();
  seedRateRow(state.rows, 0, { email: " Applicant@Example.Test " });
  seedRateRow(state.rows, 1, { email: "applicant@example.test", submittedAt: new Date(Date.now() - 60_000) });
  const third = profileApplication();
  third.application.submittedAt = new Date().toISOString();
  assert.equal(post(third).ok, true);
  const fourth = profileApplication();
  fourth.application.id += "-fourth";
  fourth.application.reference += "-fourth";
  const fileCount = state.files.length;
  assert.deepEqual(post(fourth), { ok: false, code: "SUBMISSION_RATE_LIMIT" });
  assert.equal(state.files.length, fileCount);
  assert.equal(state.rows.length, 4);
});

test("Apps Script excludes other sources and records outside the hourly window", () => {
  const { state, post } = fixture();
  const email = profileApplication().application.email;
  for (let index = 0; index < 20; index++) seedRateRow(state.rows, index, {
    email, source: index % 2 ? "Jobstreet Croatia" : "",
  });
  seedRateRow(state.rows, 20, { email, submittedAt: new Date(Date.now() - 61 * 60_000).toISOString() });
  seedRateRow(state.rows, 21, { email, submittedAt: "invalid historical timestamp" });
  seedRateRow(state.rows, 22, { email, submittedAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(post(profileApplication()).ok, true);
  assert.equal(state.rows.length, 25);
});

test("Apps Script preserves legacy Jobstreet deliveries after Jobs in Croatia reaches its limit", () => {
  const { state, post } = fixture();
  for (let index = 0; index < 20; index++) seedRateRow(state.rows, index, {
    email: application().application.email,
  });
  assert.equal(post(application()).ok, true);
  assert.equal(state.rows.length, 22);
  const otherSource = profileApplication();
  otherSource.application.id += "-other-source";
  otherSource.application.reference += "-other-source";
  otherSource.application.applicationSource = "Jobstreet Croatia";
  assert.equal(post(otherSource).ok, true);
  assert.equal(state.rows.length, 23);
});

test("Apps Script recovers duplicate references after submission limits are reached", () => {
  const { state, post } = fixture();
  const original = profileApplication();
  original.application.submittedAt = new Date().toISOString();
  assert.equal(post(original).ok, true);
  for (let index = 0; index < 20; index++) seedRateRow(state.rows, index, {
    email: original.application.email,
  });
  const rowCount = state.rows.length;
  const fileCount = state.files.length;
  const result = post(original);
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.reference, original.application.reference);
  assert.equal(state.rows.length, rowCount);
  assert.equal(state.files.length, fileCount);
});

test("Apps Script signed delivery writes RAW recruiter columns and retry deduplicates row and private CV", () => {
  const { state, post } = fixture();
  assert.deepEqual(post(), { ok: true, applicationId: application().application.id,
    reference: application().application.reference, row: 2, duplicate: false,
    cvUrl: "https://drive.google.com/file/d/private-cv-1/view" });
  assert.equal(state.rows[1][2], "=SUM(1,1)");
  assert.equal(state.rows[1][4], "+63 917 123 4567");
  assert.equal(state.rows[1][14], application().application.skills);
  assert.equal(state.rows[1][17], application().application.education);
  assert.equal(state.rows[1][21], "Yes");
  assert.ok(!state.rows[0].some((header) => /^(NC2|Diploma|NBI\/apostille|Form 18a) status$/.test(String(header))));
  assert.equal(post().duplicate, true);
  assert.equal(state.rows.length, 2);
  assert.equal(state.files.length, 1);
  assert.equal(state.locks, state.releases);
  assert.ok(state.calls.every(({ url }) => !url.includes("permissions.create")));
});

test("Apps Script rejects tampered signatures and expired envelopes before Google access", () => {
  const { state, post } = fixture();
  assert.equal(post(application(), { signature: "0".repeat(64) }).code, "INVALID_SIGNATURE");
  assert.equal(post(application(), { timestamp: Date.now() - 6 * 60 * 1000 }).code, "EXPIRED_REQUEST");
  assert.equal(state.calls.length, 0);
  assert.equal(state.locks, 0);
});

test("Apps Script validates strict payload, readiness and CV signatures before storage", () => {
  const { state, post } = fixture();
  const extraField = { ...application(), unexpected: "field" };
  assert.equal(post(extraField).code, "INVALID_SCHEMA");
  const missingCertificate = application();
  missingCertificate.application.nc2Certificate = "";
  assert.equal(post(missingCertificate).code, "INVALID_APPLICATION");
  const wrongBytes = application();
  wrongBytes.resume.base64 = Buffer.from("Not a PDF").toString("base64");
  assert.equal(post(wrongBytes).code, "INVALID_CV");
  const pathName = application();
  pathName.resume.name = "../CV.pdf";
  assert.equal(post(pathName).code, "INVALID_CV");
  const malformed = application();
  malformed.resume.base64 = "%%%";
  assert.equal(post(malformed).code, "INVALID_CV");
  const tooLarge = application();
  tooLarge.resume.base64 = Buffer.alloc(5 * 1024 * 1024 + 1, 1).toString("base64");
  assert.equal(post(tooLarge).code, "INVALID_CV");
  assert.equal(state.calls.length, 0);
});

test("Apps Script reuses uploaded CV after failed sheet write and returns sanitized errors", () => {
  const { state, post } = fixture();
  state.writeFailures = 1;
  assert.deepEqual(post(), { ok: false, code: "SHEET_WRITE_FAILED" });
  assert.equal(state.files.length, 1);
  assert.equal(state.rows.length, 1);
  assert.equal(post().ok, true);
  assert.equal(state.files.length, 1);
  assert.equal(state.rows.length, 2);
});

test("Apps Script writes fixed A:BB coordinates without append table detection and expands a full sheet", () => {
  const { state, post } = fixture();
  state.maxRows = 1;
  assert.equal(post().ok, true);
  assert.equal(state.maxRows, 101);
  assert.equal(state.rows[1][0], application().application.id);
  assert.equal(state.rows[1][21], "Yes");
  const write = state.calls.find(({ url }) => url.includes("/values/"));
  assert.ok(write);
  assert.match(decodeURIComponent(write.url), /'Applications'!A2:BB2\?valueInputOption=RAW$/);
  assert.ok(!write.url.includes(":append"));
});

test("Apps Script stops on changed headers, conflicting references, or public CV folders", () => {
  const altered = fixture();
  altered.state.rows[0][2] = "Unrelated data";
  assert.equal(altered.post().code, "HEADER_MISMATCH");
  assert.equal(altered.state.calls.length, 0);
  const conflict = fixture();
  conflict.state.rows.push(["other-id", application().application.reference]);
  assert.equal(conflict.post().code, "DUPLICATE_CONFLICT");
  assert.equal(conflict.state.files.length, 0);
  const publicFolder = fixture();
  publicFolder.state.folderPublic = true;
  assert.equal(publicFolder.post().code, "CV_NOT_PRIVATE");
  assert.equal(publicFolder.state.files.length, 0);
  const publicFile = fixture();
  publicFile.state.filePublic = true;
  assert.equal(publicFile.post().code, "CV_NOT_PRIVATE");
  assert.equal(publicFile.state.rows.length, 1);
});

test("Apps Script health endpoint has no applicant data or secret", () => {
  const { context, properties } = fixture();
  properties.clear();
  assert.deepEqual(vm.runInContext("doGet()", context), { ok: true, service: "chapter-applications", version: 1, schemaVersion: 7, columns: 36, supportedColumns: [36, 35, 54] });
});

test("referral sources append after every existing recruiter column and legacy payloads leave AD blank", () => {
  const legacy = fixture();
  assert.equal(legacy.post().ok, true);
  assert.equal(legacy.state.rows[0][29], "Where did you hear about us?");
  assert.equal(legacy.state.rows[1][29], "");
  assert.equal(legacy.post().duplicate, true);
  for (const referralSource of ["Facebook", "TikTok", "Instagram", "Reddit", "YouTube", "Google Search", "Friend or family", "Other", ""]) {
    const { state, post } = fixture();
    const original = application();
    assert.equal(post({ ...original, application: { ...original.application, referralSource } }).ok, true);
    assert.deepEqual(state.rows[1].slice(0, 29), legacy.state.rows[1].slice(0, 29));
    assert.equal(state.rows[1][29], referralSource);
  }
});

test("complete website payload writes a literal referral answer through signed delivery without interpreting formula text", () => {
  const { state, post } = fixture();
  const original = application();
  const payload = buildSheetsPayload({
    ...original.application, preferredEmployer: "", discoverySource: "Google search",
    resumeKey: "private/resume.pdf", resumeName: original.resume.name, resumeMime: original.resume.mime, isExample: false,
  } as Application, Buffer.from(original.resume.base64, "base64"));
  assert.equal(post(payload).ok, true);
  assert.equal(state.rows[1][29], "Google search");
  assert.equal(state.rows[1][2], "=SUM(1,1)");
  assert.equal(state.rows[1][14], original.application.skills);
  assert.equal(state.rows[1][4], original.application.phone);
  const write = state.calls.find(({ url }) => url.includes("/values/"));
  assert.match(decodeURIComponent(write!.url), /valueInputOption=RAW$/);
  assert.equal(post(payload).duplicate, true);
  assert.equal(state.rows.length, 2);
});

test("website profile and every uploaded identity document deliver into distinct private links and answer columns", () => {
  const { state, post, context } = fixture();
  const original = application();
  const documents = ["diploma", "nc2", "nbi", "form18a", "other", "driver-license", "passport", "residence-id", "employment-certificate"].map((category) => ({
    id: `${category}-id`, category, name: `${category}.pdf`, key: `private/${category}.pdf`, mime: original.resume.mime,
    size: Buffer.from(original.resume.base64, "base64").length,
  })) as NonNullable<Application["documents"]>;
  const record: Application = {
    ...original.application, preferredEmployer: "", resumeKey: "private/resume.pdf", resumeName: original.resume.name,
    resumeMime: original.resume.mime, isExample: false, fullName: "Test Applicant", recentJobTitle: "", experienceYears: 0, skills: "",
    applicationFormVersion: 2, destinationCountry: "North Macedonia", termsAccepted: true, country: "Romania",
    applicantDetails: { firstName: "Test", lastName: "Applicant", gender: "Female", currentAddress: "17 Sample Street, Manila, Metro Manila, 0017",
      street: "17 Sample Street", city: "Manila", province: "Metro Manila", postalCode: "0017",
      dateOfBirth: "1990-01-01", placeOfBirth: "Manila", fatherName: "Applicant Father", motherName: "Applicant Mother",
      telegram: "+639179876543", secondaryPosition: "Welder", otherPosition: "Warehouse operator", englishProficiency: "No" }, documents,
  } as Application;
  const payload = buildSheetsPayload(record, Buffer.from(original.resume.base64, "base64"), undefined,
    documents.map(({ key: _key, size: _size, ...document }) => { void _key; void _size; return { ...document, base64: original.resume.base64 }; }));
  assert.equal(payload.version, 3);
  assert.deepEqual(payload.application.profile, {
    firstName: "Test", lastName: "Applicant", gender: "Female", address: record.applicantDetails!.currentAddress,
    street: "17 Sample Street", city: "Manila", province: "Metro Manila", postalCode: "0017",
    dateOfBirth: "1990-01-01", placeOfBirth: "Manila", fatherName: "Applicant Father", motherName: "Applicant Mother",
    destinationCountry: "North Macedonia", currentWorkCountry: "Romania", secondaryJobTitle: "Welder", otherJobTitle: "Warehouse operator",
    englishProficiency: "No", telegram: "+639179876543", termsAccepted: true,
  });
  assert.deepEqual(payload.documents?.map(({ category }) => category), documents.map(({ category }) => category));
  assert.ok(!JSON.stringify(payload).includes("private/"));
  // Match the compact form layout already used by the production receiver.
  vm.runInContext("setupChapterSync()", context);
  assert.equal(post(payload).ok, true);
  assert.equal(state.rows[0].length, 36);
  assert.equal(state.rows[1].length, 36);
  assert.deepEqual(state.rows[1].slice(14, 32), ["Test", "Applicant", "Female", "17 Sample Street", "Manila", "Metro Manila", "0017",
    "1990-01-01", "Manila", "Applicant Father", "Applicant Mother", "North Macedonia", "Romania", "Welder", "Warehouse operator", "No", "+639179876543", "Yes"]);
  for (const index of [7, 9, 10, 11, 12, 13, 32, 33, 34]) assert.match(String(state.rows[1][index]), /^https:\/\/drive.google.com\/file\/d\/private-cv-\d+\/view$/);
  assert.match(state.notes[1][0], /Jobstreet Croatia/);
  assert.match(state.notes[1][0], /private-cv-5/);
  assert.equal(state.files.length, 10);
  state.hideSearchResults = true;
  const callsBeforeRetry = state.calls.length;
  assert.equal(post(payload).duplicate, true);
  assert.equal(state.rows.length, 2);
  assert.equal(state.files.length, 10);
  assert.ok(!state.calls.slice(callsBeforeRetry).some(({ url }) => url.includes("/files?q=") || url.includes("uploadType=") || url.endsWith(":batchUpdate")));
  const acceptedRows = structuredClone(state.rows);
  const changedProfile = { ...payload, application: { ...payload.application, profile: { ...payload.application.profile!, city: "Changed city" } } };
  assert.equal(post(changedProfile).code, "EXISTING_PROFILE_MISMATCH");
  assert.deepEqual(state.rows, acceptedRows);
  assert.equal(state.files.length, 10);
});

test("Google primary storage delivers current form answers and private uploads into the compact receiver with durable retries and quotas", async () => {
  const previousSecret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  process.env.GOOGLE_SHEETS_WEBHOOK_SECRET = secret;
  try {
    const input: ApplicationInput = {
      applicationFormVersion: 2, destinationCountry: "Serbia", termsAccepted: true,
      jobId: "integration-driver", fullName: "Google Primary Applicant", email: "google-primary@example.test",
      phone: "+639171234567", country: "Romania", consent: true, discoverySource: "Instagram",
      applicantDetails: { firstName: "Google", lastName: "Primary Applicant", gender: "Female",
        currentAddress: "17 Sample Street, Manila, Metro Manila, 0017", street: "17 Sample Street", city: "Manila", province: "Metro Manila", postalCode: "0017",
        dateOfBirth: "1990-01-01", placeOfBirth: "Manila", fatherName: "Applicant Father", motherName: "Applicant Mother",
        secondaryPosition: "Welder", otherPosition: "Warehouse operator", englishProficiency: "Yes", telegram: "+639179876543" },
    };
    const job = { id: input.jobId, title: "Delivery Driver", slug: "integration-driver", isExample: false } as Job;
    const pdf = Buffer.from(application().resume.base64, "base64");
    const resume = { bytes: pdf, extension: "pdf" as const, name: "CV.pdf", mime: "application/pdf" };
    const uploads = (["passport", "residence-id", "driver-license"] as SupportingDocumentCategory[]).map((category) => ({
      category, document: { ...resume, name: `${category}.pdf` },
    }));
    const current = fixture();
    vm.runInContext("setupChapterSync()", current.context);
    const transportFor = (receiver: ReturnType<typeof fixture>): SheetsTransport => async (payload, options) => {
      assert.equal(options?.timeoutMs, 100_000);
      assert.equal(payload.application.applicationSource, "Jobs in Croatia");
      assert.equal(payload.application.applicationFormVersion, "jobstreet-croatia-v2");
      assert.equal(payload.version, 3);
      assert.match(payload.application.id, /^gs-/);
      assert.ok(payload.documents?.every(({ id, category }) => id === `${payload.application.id}-${category}`));
      const acknowledgement = receiver.post(payload);
      if (!acknowledgement.ok) throw Object.assign(new Error("Receiver rejected the test submission"), { code: acknowledgement.code });
      return acknowledgement as SheetsAcknowledgement;
    };
    const transport = transportFor(current);
    const submissionKey = "ac4f4ed6-cb7d-43f7-b612-0c95e78bb112";
    const requestHash = "a".repeat(64);
    const receipt = await saveApplicationToGoogle(input, job, submissionKey, requestHash, resume, uploads, transport);
    assert.equal(receipt.duplicate, false);
    assert.equal(receipt.jobTitle, job.title);
    assert.match(receipt.reference, /^CH-[A-F0-9]{24}$/);
    assert.equal(current.state.rows.length, 2);
    assert.equal(current.state.files.length, 4);
    assert.deepEqual(current.state.rows[1].slice(14, 32), ["Google", "Primary Applicant", "Female", "17 Sample Street", "Manila", "Metro Manila", "0017",
      "1990-01-01", "Manila", "Applicant Father", "Applicant Mother", "Serbia", "Romania", "Welder", "Warehouse operator", "Yes", "+639179876543", "Yes"]);
    for (const index of [7, 13, 32, 33]) assert.match(String(current.state.rows[1][index]), /^https:\/\/drive.google.com\/file\/d\/private-cv-\d+\/view$/);
    assert.match(current.state.notes[1][0], /Jobs in Croatia/);
    assert.equal(current.state.rows[1][35], "Instagram");
    current.state.hideSearchResults = true;
    assert.deepEqual(await saveApplicationToGoogle(input, job, submissionKey, requestHash, resume, uploads, transport), { ...receipt, duplicate: true });
    await assert.rejects(saveApplicationToGoogle({ ...input, email: "changed@example.test" }, job, submissionKey, "b".repeat(64), resume, uploads, transport), { code: "DUPLICATE_CONFLICT" });
    assert.equal(current.state.rows.length, 2);
    assert.equal(current.state.files.length, 4);

    const limited = fixture();
    for (let index = 0; index < 20; index++) seedRateRow(limited.state.rows, index);
    vm.runInContext("setupChapterSync()", limited.context);
    await assert.rejects(saveApplicationToGoogle(input, job, submissionKey, requestHash, resume, uploads, transportFor(limited)), { code: "SUBMISSION_RATE_LIMIT" });
    assert.equal(limited.state.rows.length, 21);
    assert.equal(limited.state.files.length, 0);
    assert.ok(!limited.state.calls.some(({ url }) => url.includes("uploadType=")));
  } finally {
    if (previousSecret === undefined) delete process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
    else process.env.GOOGLE_SHEETS_WEBHOOK_SECRET = previousSecret;
  }
});

test("receiver accepts unknown years as null and leaves the sheet cell blank while rejecting string sentinels", () => {
  const original = application();
  const { post, state } = fixture();
  for (const experienceYears of ["", "Not collected", "0", -1, 61])
    assert.equal(post({ ...original, application: { ...original.application, experienceYears } }).code, "INVALID_APPLICATION");
  assert.equal(state.files.length, 0);
  const payload = { ...original, application: { ...original.application, experienceYears: null, recentJobTitle: "", skills: "" } };
  assert.equal(post(payload).ok, true);
  assert.equal(state.rows[1][12], "");
  assert.equal(state.rows[1][13], "");
  assert.equal(state.rows[1][14], "");
  assert.equal(post(payload).duplicate, true);
});

test("receiver rejects invalid and formula-like referral answers before storing files or rows", () => {
  for (const referralSource of ["=HYPERLINK(\"https://example.test\")", "+Facebook", "Unknown source", "Facebook\n", 1, null, []]) {
    const { state, post } = fixture();
    const original = application();
    assert.equal(post({ ...original, application: { ...original.application, referralSource } }).code, "INVALID_APPLICATION");
    assert.equal(state.calls.length, 0);
    assert.equal(state.rows.length, 1);
  }
});

test("owner setup appends the referral header to a 29-column sheet without changing existing answers or links", () => {
  const { state, post, context } = fixture();
  state.rows[0] = state.rows[0].slice(0, 29);
  state.maxColumns = 29;
  const oldRow = state.rows[0].map((_, index) => "existing-cell-" + index);
  state.rows.push([...oldRow]);
  assert.equal(post().code, "HEADER_MISMATCH");
  assert.equal(state.calls.length, 0);
  vm.runInContext("chapterEnsureLegacyLayout_(chapterGetSheet_(chapterConfig_(true), true))", context);
  assert.equal(state.maxColumns, 54);
  assert.equal(state.rows[0][29], "Where did you hear about us?");
  assert.deepEqual(state.rows[1], oldRow);
  vm.runInContext("chapterEnsureLegacyLayout_(chapterGetSheet_(chapterConfig_(true), true))", context);
  assert.deepEqual(state.rows[1], oldRow);
  assert.equal(post().ok, true);
  assert.equal(state.rows[2][29], "");
});

test("referral header migration refuses to overwrite an unrelated existing AD column", () => {
  const { state, context } = fixture();
  state.rows[0][29] = "Staff notes";
  const before = state.rows[0].slice();
  assert.throws(() => vm.runInContext("setupChapterSync()", context), /HEADER_MISMATCH/);
  assert.deepEqual(state.rows[0], before);
  assert.equal(state.calls.length, 0);
});

test("Apps Script delivers diploma and other supporting files privately and retries without duplicates", () => {
  const { state, post } = fixture();
  const original = application();
  const payload = { ...original, version: 2, documents: [
    { ...original.resume, id: "diploma-id", category: "diploma", name: "diploma.pdf" },
    { ...original.resume, id: "other-id", category: "other", name: "training.pdf" },
  ] };
  state.writeFailures = 1;
  assert.equal(post(payload).code, "SHEET_WRITE_FAILED");
  assert.equal(state.files.length, 3);
  assert.equal(state.rows.length, 1);
  assert.equal(post(payload).ok, true);
  assert.equal(state.rows.length, 2);
  assert.equal(state.files.length, 3);
  assert.match(String(state.rows[1][22]), /drive.google.com\/file\/d\/private-cv-1\/view/);
  assert.match(String(state.rows[1][26]), /drive.google.com\/file\/d\/private-cv-2\/view/);
  assert.equal(post(payload).duplicate, true);
  assert.equal(state.files.length, 3);
  assert.equal(state.rows.length, 2);
  const invalid = { ...payload, documents: [payload.documents[0], { ...payload.documents[1], category: "diploma" }] };
  assert.equal(post(invalid).code, "INVALID_DOCUMENT");
});

test("receiver migration removes only retired status columns and preserves existing applicant details and document links", () => {
  const { state, context } = fixture();
  const currentHeaders = state.rows[0].slice(0, 27);
  state.rows[0] = [...currentHeaders];
  state.rows[0].splice(17, 0, "NC2 status", "Diploma status", "NBI/apostille status", "Form 18a status");
  const originalRow = currentHeaders.map((_, index) => "existing-cell-" + index);
  state.rows.push([...originalRow]);
  state.rows[1].splice(17, 0, "Ready", "Ready", "In progress", "Not yet available");
  state.maxColumns = 31;
  context.migrationSheet = {
    getLastRow: () => state.rows.length, getMaxColumns: () => state.maxColumns,
    getLastColumn: () => state.rows[0].length,
    getRange: (_row: number, column: number, _count: number, columns: number) => ({ getValues: () => [state.rows[0].slice(column - 1, column - 1 + columns)] }),
    deleteColumns: (column: number, count: number) => { state.rows.forEach((row) => row.splice(column - 1, count)); state.maxColumns -= count; },
  };
  vm.runInContext("chapterRemoveLegacyStatusColumns_(migrationSheet)", context);
  assert.deepEqual(state.rows[0], currentHeaders);
  assert.deepEqual(state.rows[1], originalRow);
  assert.equal(state.maxColumns, 27);
  vm.runInContext("chapterRemoveLegacyStatusColumns_(migrationSheet)", context);
  assert.deepEqual(state.rows[1], originalRow);
  state.rows[0].splice(17, 0, "NC2 status", "Diploma status", "NBI/apostille status", "Form 18a status");
  state.rows[0][30] = "Unrelated column"; state.maxColumns = 31;
  assert.throws(() => vm.runInContext("chapterRemoveLegacyStatusColumns_(migrationSheet)", context), /HEADER_MISMATCH/);
  assert.equal(state.maxColumns, 31);
});

test("driver license details and all six optional documents align, remain private and deduplicate seven files", () => {
  const { state, post } = fixture();
  const original = application();
  const payload = { ...original, version: 2,
    application: { ...original.application, driverLicenseDetails: "Professional license, Philippines" },
    documents: ["diploma", "nc2", "nbi", "form18a", "other", "driver-license"].map((category) => ({
      ...original.resume, id: `test-${category}`, category, name: `${category}.pdf`,
    })),
  };
  assert.equal(post(payload).ok, true);
  assert.equal(state.files.length, 7);
  assert.match(String(state.rows[1][24]), /drive.google.com\/file\/d\/private-cv-3\/view/);
  assert.match(String(state.rows[1][25]), /drive.google.com\/file\/d\/private-cv-4\/view/);
  assert.equal(state.rows[1][27], payload.application.driverLicenseDetails);
  assert.match(String(state.rows[1][28]), /drive.google.com\/file\/d\/private-cv-6\/view/);
  assert.equal(post(payload).duplicate, true);
  assert.equal(state.files.length, 7);
  assert.equal(state.rows.length, 2);
  assert.equal(post({ ...payload, application: { ...payload.application, driverLicenseDetails: "Different category" } }).code, "EXISTING_DOCUMENT_MISMATCH");
  assert.equal(post({ ...payload, application: { ...payload.application, driverLicenseDetails: "x".repeat(201) } }).code, "INVALID_APPLICATION");
});

test("v3 exports every profile answer and all nine document categories in fixed positions with private RAW writes", () => {
  const { state, post } = fixture();
  const payload = profileApplication();
  assert.equal(post(payload).ok, true);
  assert.deepEqual(state.rows[0].slice(30), [
    "First name", "Last name", "Gender", "Nationality", "Current address / location", "Street", "City", "Province / State", "Postal code",
    "Date of birth", "Place of birth", "Father’s full name", "Mother’s full name", "Destination country", "Current work country",
    "Additional experienced role", "Other job choice", "English proficiency", "Telegram number", "Terms accepted", "Passport document",
    "Residence ID document", "Employment certificate document", "Application source",
  ]);
  assert.deepEqual(state.rows[1].slice(30, 50), [
    "=SUM(1,1)", "Applicant", "Female", "Filipino", "17 Sample Street, Manila, Metro Manila, 0017", "17 Sample Street", "Manila", "Metro Manila", "0017",
    "1990-01-01", "Manila", "Applicant Father", "Applicant Mother", "Macedonia", "Philippines", "Welder", "Warehouse operator", "Yes", "+63 917 123 4567", "Yes",
  ]);
  for (const [index, fileNumber] of [[22, 1], [23, 2], [24, 3], [25, 4], [26, 5], [28, 6], [50, 7], [51, 8], [52, 9]])
    assert.equal(state.rows[1][index], `https://drive.google.com/file/d/private-cv-${fileNumber}/view`);
  assert.equal(state.rows[1][8], "https://drive.google.com/file/d/private-cv-10/view");
  assert.equal(state.rows[1][53], "Jobs in Croatia");
  assert.equal(state.files.length, 10);
  assert.equal(post(payload).duplicate, true);
  assert.equal(state.files.length, 10);
  assert.equal(state.rows.length, 2);
  assert.ok(state.calls.filter(({ url }) => url.includes("/drive/v3/files?q=")).every(({ url }) => url.includes("pageSize=11")));
  assert.ok(state.calls.every(({ url }) => !url.includes("permissions.create")));
  assert.equal(post({ ...payload, application: { ...payload.application, profile: { ...payload.application.profile, city: "Cebu" } } }).code, "EXISTING_PROFILE_MISMATCH");
  assert.equal(post({ ...payload, application: { ...payload.application, applicationSource: "Changed source" } }).code, "EXISTING_PROFILE_MISMATCH");
  const missingPassport = { ...payload, documents: payload.documents.filter(({ category }) => category !== "passport") };
  assert.equal(post(missingPassport).duplicate, true);
  assert.equal(state.rows[1][50], "https://drive.google.com/file/d/private-cv-7/view");
});

test("an acknowledged v3 retry uses committed private file IDs while Drive search is stale", () => {
  const { state, post } = fixture();
  const payload = profileApplication();
  assert.equal(post(payload).ok, true);
  const originalRows = structuredClone(state.rows);
  state.hideSearchResults = true;
  const callsBefore = state.calls.length;
  const retry = post(payload);
  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.reference, payload.application.reference);
  assert.deepEqual(state.rows, originalRows);
  assert.equal(state.files.length, 10);
  const retryCalls = state.calls.slice(callsBefore);
  assert.ok(!retryCalls.some(({ url }) => url.includes("/files?q=") || url.includes("uploadType=") || url.includes("upload_id=")));
  assert.equal(retryCalls.filter(({ url }) => /\/files\/private-cv-\d+\?/.test(url)).length, 10);
});

test("retries verify committed document ownership, category and privacy before accepting stored links", () => {
  for (const change of ["application", "reference", "category", "folder", "mime", "trashed", "link", "public"]) {
    const { state, post } = fixture();
    const payload = profileApplication();
    assert.equal(post(payload).ok, true);
    const document = state.files[0];
    if (change === "application") document.appProperties.chapterApplicationId = "another-application";
    if (change === "reference") document.appProperties.chapterReference = "ANOTHER-REFERENCE";
    if (change === "category") document.appProperties.chapterDocumentId = "another-document";
    if (change === "folder") document.parents = ["another-private-folder"];
    if (change === "mime") document.mimeType = "image/jpeg";
    if (change === "trashed") document.trashed = true;
    if (change === "link") state.rows[1][22] = "https://hostile.example/private-file";
    if (change === "public") state.filePublic = true;
    const callsBefore = state.calls.length;
    assert.equal(post(payload).code, change === "link" ? "EXISTING_DOCUMENT_MISMATCH" : change === "public" ? "CV_NOT_PRIVATE" : "CV_METADATA_MISMATCH");
    assert.equal(state.files.length, 10);
    assert.equal(state.rows.length, 2);
    assert.ok(!state.calls.slice(callsBefore).some(({ url }) => url.includes("/files?q=") || url.includes("uploadType=")));
  }
});

test("v3 profile schema rejects unknown keys, invalid dates, unchecked terms and oversized values before Google access", () => {
  const original = profileApplication();
  const invalidApplications = [
    { ...original.application, profile: { ...original.application.profile, unexpected: "value" } },
    { ...original.application, profile: { ...original.application.profile, dateOfBirth: "1990-02-30" } },
    { ...original.application, profile: { ...original.application.profile, termsAccepted: false } },
    { ...original.application, profile: { ...original.application.profile, firstName: "x".repeat(61) } },
    { ...original.application, profile: { ...original.application.profile, telegram: "x".repeat(81) } },
    { ...original.application, applicationSource: "x".repeat(81) },
    { ...original.application, applicationFormVersion: "x".repeat(81) },
  ];
  for (const input of invalidApplications) {
    const { state, post } = fixture();
    assert.equal(post({ ...original, application: input }).ok, false);
    assert.equal(state.calls.length, 0);
    assert.equal(state.rows.length, 1);
  }
  const { state, post } = fixture();
  assert.equal(post({ ...original, documents: [] }).ok, true);
  assert.equal(state.files.length, 1);
  assert.deepEqual(state.rows[1].slice(50, 53), ["", "", ""]);
});

test("shared receiver preserves both original senders and the existing AD header alias during 30-to-54 migration", () => {
  for (const adHeader of ["Where did you hear about us?", "How did you hear about us?"]) {
    const { state, context, post } = fixture();
    // Produce a real legacy row, then model a pre-migration 30-column sheet.
    assert.equal(post().ok, true);
    state.rows = state.rows.map((row) => row.slice(0, 30));
    state.rows[0][29] = adHeader;
    state.maxColumns = 30;
    const originalHeaders = [...state.rows[0]];
    const oldRow = [...state.rows[1]];
    assert.equal(post().code, "HEADER_MISMATCH");
    vm.runInContext("chapterEnsureLegacyLayout_(chapterGetSheet_(chapterConfig_(true), true))", context);
    assert.equal(state.maxColumns, 54);
    assert.deepEqual(state.rows[0].slice(0, 30), originalHeaders);
    assert.deepEqual(state.rows[1], oldRow);
    assert.equal(post().duplicate, true);
    vm.runInContext("chapterEnsureLegacyLayout_(chapterGetSheet_(chapterConfig_(true), true))", context);
    assert.deepEqual(state.rows[1], oldRow);
    const base = application();
    const discoveryPayload = { ...base, version: 2, documents: [], application: {
      ...base.application, id: "jobstreet-app-id", reference: "JOBSTREET-REFERENCE", recentJobTitle: "Not provided", skills: "Not provided",
      experienceYears: 0, discoverySource: "Threads",
    } };
    assert.equal(post(discoveryPayload).ok, true);
    assert.equal(state.rows[2][29], "Threads");
    assert.equal(state.rows[2][12], 0);
    assert.ok(state.rows[2].slice(30).every((value) => value === ""));
    assert.equal(post(discoveryPayload).duplicate, true);
  }
});

test("shared source aliases allow each site's choices and reject conflicting nonempty values", () => {
  for (const discoverySource of ["Threads", "X (Twitter)", "LinkedIn", "Google search", "Facebook", ""]) {
    const { state, post } = fixture();
    const original = application();
    assert.equal(post({ ...original, application: { ...original.application, discoverySource } }).ok, true);
    assert.equal(state.rows[1][29], discoverySource);
  }
  const original = application();
  for (const [referralSource, discoverySource, expected] of [
    ["Facebook", "Facebook", "Facebook"], ["", "Threads", "Threads"], ["Google Search", "", "Google Search"],
  ]) {
    const { state, post } = fixture();
    assert.equal(post({ ...original, application: { ...original.application, referralSource, discoverySource } }).ok, true);
    assert.equal(state.rows[1][29], expected);
  }
  const { state, post } = fixture();
  assert.equal(post({ ...original, application: { ...original.application, referralSource: "Facebook", discoverySource: "Threads" } }).code, "INVALID_APPLICATION");
  assert.equal(state.calls.length, 0);
});

test("extended header migration refuses conflicting nonempty columns without overwriting headers or applicant answers", () => {
  for (const index of [29, 30, 44, 53]) {
    const { state, context } = fixture();
    state.rows[0][index] = "Staff notes";
    state.rows.push(state.rows[0].map((_, cell) => `answer-${cell}`));
    const before = structuredClone(state.rows);
    assert.throws(() => vm.runInContext("setupChapterSync()", context), /HEADER_MISMATCH/);
    assert.deepEqual(state.rows, before);
    assert.equal(state.calls.length, 0);
  }
});

test("a v3 retry recovers an older delivery by filling blank referral and AE:BB cells, then remains idempotent", () => {
  const { state, post, context } = fixture();
  const current = profileApplication();
  const legacy = { ...application(), version: 2, application: {
    ...application().application, driverLicenseDetails: current.application.driverLicenseDetails,
  }, documents: current.documents.slice(0, 6) };
  assert.equal(post(legacy).ok, true);
  assert.equal(state.files.length, 7);
  // The old receiver wrote its row, but the original sender never received its
  // acknowledgement. Model that persisted row and upgrade the header first.
  state.rows = state.rows.map((row) => row.slice(0, 30));
  state.maxColumns = 30;
  const originalBase = [...state.rows[1]];
  vm.runInContext("chapterEnsureLegacyLayout_(chapterGetSheet_(chapterConfig_(true), true))", context);
  // An existing recruiter entry is retained when the retry does not supply it.
  state.rows[1][46] = "Existing recruiter note";
  const retry = { ...current, application: { ...current.application,
    profile: { ...current.application.profile, otherJobTitle: "" },
  } };
  const writesBefore = state.calls.filter(({ url }) => url.includes("/values/")).length;
  const searchesBefore = state.calls.filter(({ url }) => url.includes("/files?q=")).length;
  assert.equal(post(retry).duplicate, true);
  assert.deepEqual(state.rows[1].slice(0, 29), originalBase.slice(0, 29));
  assert.equal(state.rows[1][29], current.application.referralSource);
  assert.equal(state.rows[1][30], "=SUM(1,1)");
  assert.equal(state.rows[1][46], "Existing recruiter note");
  assert.equal(state.rows[1][53], "Jobs in Croatia");
  assert.ok(state.rows[1].slice(50, 53).every((link) => /^https:\/\/drive.google.com\/file\/d\/private-cv-\d+\/view$/.test(String(link))));
  assert.equal(state.files.length, 10);
  assert.equal(state.rows.length, 2);
  const backfill = state.calls.filter(({ url }) => decodeURIComponent(url).includes("!AE2:BB2")).at(-1)!;
  assert.match(decodeURIComponent(backfill.url), /'Applications'!AE2:BB2\?valueInputOption=RAW$/);
  assert.equal(JSON.parse(backfill.options.payload as string).values[0].length, 24);
  assert.equal(state.calls.filter(({ url }) => url.includes("/values/")).length, writesBefore + 2);
  assert.equal(state.calls.filter(({ url }) => url.includes("/files?q=")).length, searchesBefore + 3);
  assert.equal(post(retry).duplicate, true);
  assert.equal(state.calls.filter(({ url }) => url.includes("/values/")).length, writesBefore + 2);
  assert.equal(state.calls.filter(({ url }) => url.includes("/files?q=")).length, searchesBefore + 3);
  assert.equal(state.files.length, 10);
  assert.equal(state.rows.length, 2);
  assert.equal(post(legacy).duplicate, true);
  assert.equal(state.rows[1][46], "Existing recruiter note");
  const beforeConflict = structuredClone(state.rows);
  assert.equal(post({ ...retry, application: { ...retry.application, profile: { ...retry.application.profile, city: "Conflicting city" } } }).code, "EXISTING_PROFILE_MISMATCH");
  assert.deepEqual(state.rows, beforeConflict);
});

test("lost acknowledgement after an extended recovery write does not create rows or files on the next retry", () => {
  const { state, post } = fixture();
  const payload = profileApplication();
  assert.equal(post(payload).ok, true);
  state.rows[1] = state.rows[1].slice(0, 30);
  const base = [...state.rows[1]];
  state.writeWrongAck = true;
  assert.equal(post(payload).code, "SHEET_WRITE_UNCONFIRMED");
  assert.deepEqual(state.rows[1].slice(0, 30), base);
  assert.equal(state.rows[1][53], "Jobs in Croatia");
  const writes = state.calls.filter(({ url }) => url.includes("/values/")).length;
  state.writeWrongAck = false;
  assert.equal(post(payload).duplicate, true);
  assert.equal(state.calls.filter(({ url }) => url.includes("/values/")).length, writes);
  assert.equal(state.files.length, 10);
  assert.equal(state.rows.length, 2);
});

test("failed extended recovery writes retry safely without losing existing fields or reuploading identity documents", () => {
  const { state, post } = fixture();
  const payload = profileApplication();
  assert.equal(post(payload).ok, true);
  state.rows[1] = state.rows[1].slice(0, 30);
  const base = [...state.rows[1]];
  state.writeFailures = 1;
  assert.equal(post(payload).code, "SHEET_WRITE_FAILED");
  assert.deepEqual(state.rows[1], base);
  assert.equal(post(payload).duplicate, true);
  assert.deepEqual(state.rows[1].slice(0, 30), base);
  assert.equal(state.files.length, 10);
  assert.equal(state.rows.length, 2);
});

test("owner setup clears inherited referral validation only from new fields and shares AD choices across both websites", () => {
  const { state, post, context } = fixture();
  assert.equal(post(profileApplication()).ok, true);
  state.rows[0][29] = "How did you hear about us?";
  const originalRows = structuredClone(state.rows);
  vm.runInContext("chapterEnsureLegacyLayout_(chapterGetSheet_(chapterConfig_(true), true))", context);
  assert.deepEqual(state.rows, originalRows);
  assert.deepEqual(state.validationChanges[0], { action: "clear", row: 2, column: 31, count: 999, columns: 24 });
  assert.deepEqual(state.validationChanges[1], {
    action: "set", row: 2, column: 30, count: 999, columns: 1,
    rule: { choices: ["Facebook", "TikTok", "Instagram", "Reddit", "Threads", "X (Twitter)", "YouTube", "LinkedIn",
      "Google Search", "Google search", "Friend or family", "Other"], showDropdown: true, allowInvalid: false },
  });
  assert.equal(state.validationChanges.length, 2);
  assert.ok(state.validationChanges.every(({ row, column }) => row === 2 && column >= 30));
});

test("owner compaction preserves applicant values, links, notes and native column formatting behind a verified hidden backup", () => {
  const { state, post, context } = fixture();
  const payload = profileApplication();
  assert.equal(post(payload).ok, true);
  state.notes[1] = [];
  state.notes[1][0] = "Recruiter original note";
  state.notes[1][3] = "Email verified";
  state.notes[1][36] = "City verified";
  state.filter!.criteria[37] = { city: "Manila" };
  state.filter!.criteria[12] = { retiredCountry: "Philippines" };
  const originalRows = structuredClone(state.rows);
  const originalNotes = structuredClone(state.notes);
  const originalColumns = structuredClone(state.columnMetadata);
  const kept = [...vm.runInContext("CHAPTER_FORM_COLUMNS", context)] as number[];
  const result = vm.runInContext("setupChapterSync()", context);
  assert.equal(result.columns, 36);
  assert.match(result.backupSheetName, /^Applications backup \d{4}-\d{2}-\d{2}$/);
  assert.equal(state.backups.length, 1);
  assert.equal(state.backups[0].hidden, true);
  assert.deepEqual(state.backups[0].rows, originalRows);
  assert.deepEqual(state.backups[0].notes, originalNotes);
  assert.deepEqual(state.backups[0].columnMetadata, originalColumns);
  assert.equal(state.maxColumns, 36);
  assert.deepEqual(state.rows[1], kept.map((index) => originalRows[1][index]));
  assert.deepEqual(state.columnMetadata.slice(0, 35), kept.slice(0, 35).map((index) => originalColumns[index]));
  assert.equal(state.rows[0][4], "WhatsApp number");
  assert.equal(state.rows[0][7], "CV document");
  assert.equal(state.rows[0][8], "Privacy consent");
  assert.equal(state.notes[1][3], "Email verified");
  assert.equal(state.notes[1][kept.indexOf(36)], "City verified");
  assert.match(state.notes[1][0], /^Recruiter original note\n\nCHAPTER_RECEIVER_METADATA_V1\n/);
  const metadata = JSON.parse(state.notes[1][0].split("CHAPTER_RECEIVER_METADATA_V1\n")[1]);
  assert.deepEqual(metadata, { source: "Jobs in Croatia", otherDocumentUrl: originalRows[1][26], driverLicenseDetails: payload.application.driverLicenseDetails,
    referralSource: payload.application.referralSource });
  assert.equal(state.filter!.columns, 36);
  assert.deepEqual(state.filter!.criteria, { [kept.indexOf(36) + 1]: { city: "Manila" } });
  assert.equal(state.frozenRows, 1);
  assert.equal(state.frozenColumns, 3);
  assert.equal(state.validationChanges.length, 1);
  assert.equal(state.validationChanges[0].column, 36);
  const compactRows = structuredClone(state.rows);
  const compactNotes = structuredClone(state.notes);
  vm.runInContext("setupChapterSync()", context);
  assert.equal(state.backups.length, 1);
  assert.deepEqual(state.rows, compactRows);
  assert.deepEqual(state.notes, compactNotes);
  assert.equal(state.validationChanges.length, 2);
  state.hideSearchResults = true;
  const callsBefore = state.calls.length;
  assert.equal(post(payload).duplicate, true);
  assert.deepEqual(state.rows, compactRows);
  assert.equal(state.files.length, 10);
  assert.ok(!state.calls.slice(callsBefore).some(({ url }) => url.includes("/files?q=") || url.includes("uploadType=") || url.endsWith(":batchUpdate")));
});

test("compact submissions atomically save exactly the current form fields and private links with literal cell values", () => {
  const { state, post, context } = fixture();
  vm.runInContext("setupChapterSync()", context);
  state.notes[1] = ["Existing ID comment", "Existing reference comment"];
  const payload = profileApplication();
  assert.equal(post(payload).ok, true);
  assert.deepEqual(state.rows[0], [
    "Application ID", "Reference", "Full name", "Email", "WhatsApp number", "Job position", "Submitted at (UTC)", "CV document", "Privacy consent",
    "Diploma / education document", "NC2 document", "NBI / apostille document", "Form 18a document", "Driver license document", "First name", "Last name", "Gender",
    "Street", "City", "Province / State", "Postal code", "Date of birth", "Place of birth", "Father’s full name", "Mother’s full name", "Destination country",
    "Current work country", "Additional experienced role", "Other job choice", "English proficiency", "Telegram number", "Terms accepted", "Passport document",
    "Residence ID document", "Employment certificate document", "Where did you find us?",
  ]);
  assert.equal(state.rows[1].length, 36);
  assert.equal(state.rows[1][2], "=SUM(1,1)");
  assert.equal(state.rows[1][4], "+63 917 123 4567");
  assert.equal(state.rows[1][7], "https://drive.google.com/file/d/private-cv-10/view");
  assert.equal(state.rows[1][8], "Yes");
  assert.equal(state.rows[1][13], "https://drive.google.com/file/d/private-cv-6/view");
  assert.deepEqual(state.rows[1].slice(14, 32), [
    "=SUM(1,1)", "Applicant", "Female", "17 Sample Street", "Manila", "Metro Manila", "0017", "1990-01-01", "Manila", "Applicant Father", "Applicant Mother",
    "Macedonia", "Philippines", "Welder", "Warehouse operator", "Yes", "+63 917 123 4567", "Yes",
  ]);
  assert.deepEqual(state.rows[1].slice(32, 35), [7, 8, 9].map((id) => `https://drive.google.com/file/d/private-cv-${id}/view`));
  assert.equal(state.rows[1][35], payload.application.referralSource);
  assert.equal(state.notes[1][1], "Existing reference comment");
  assert.match(state.notes[1][0], /^Existing ID comment/);
  assert.match(state.notes[1][0], /private-cv-5/);
  assert.ok(!state.rows[0].some((header) => /^(Nationality|Country|Current address|Expected NC2|Application source|Other document)/.test(String(header))));
  const write = state.calls.find(({ url, options }) => url.endsWith(":batchUpdate") && JSON.parse(options.payload as string).requests.length === 2)!;
  assert.ok(write);
  const requests = JSON.parse(write.options.payload as string).requests;
  assert.equal(requests[0].updateCells.fields, "userEnteredValue");
  assert.deepEqual(requests[0].updateCells.rows[0].values[2], { userEnteredValue: { stringValue: "=SUM(1,1)" } });
  assert.equal(requests[1].updateCells.fields, "note");
  state.hideSearchResults = true;
  const callsBefore = state.calls.length;
  assert.equal(post(payload).duplicate, true);
  assert.equal(state.rows.length, 2);
  assert.equal(state.files.length, 10);
  assert.ok(!state.calls.slice(callsBefore).some(({ url }) => url.includes("/files?q=") || url.includes("uploadType=")));
});

test("compact layout accepts legacy Jobstreet payloads without inventing missing profile answers", () => {
  const { state, post, context } = fixture();
  vm.runInContext("setupChapterSync()", context);
  const legacy = application();
  const payload = { ...legacy, version: 2, application: { ...legacy.application, driverLicenseDetails: "Legacy professional driver" },
    documents: [{ ...legacy.resume, id: "legacy-other", category: "other" }] };
  assert.equal(post(payload).ok, true);
  assert.equal(state.rows[1][3], legacy.application.email);
  assert.equal(state.rows[1][5], "Fabricator");
  assert.ok(state.rows[1].slice(14).every((value) => value === ""));
  assert.match(state.notes[1][0], /private-cv-1/);
  assert.match(state.notes[1][0], /Legacy professional driver/);
  state.hideSearchResults = true;
  const callsBefore = state.calls.length;
  assert.equal(post(payload).duplicate, true);
  assert.equal(state.files.length, 2);
  assert.ok(!state.calls.slice(callsBefore).some(({ url }) => url.includes("/files?q=") || url.includes("uploadType=")));
});

test("compact quotas retain migrated source attribution and gs-prefix recovery without affecting Jobstreet", () => {
  for (const quota of ["total", "email", "gs-prefix"]) {
    const { state, post, context } = fixture();
    const count = quota === "total" ? 20 : 3;
    for (let index = 0; index < count; index++) seedRateRow(state.rows, index, {
      email: quota === "total" ? `existing-${index}@example.test` : " Applicant@Example.Test ",
    });
    vm.runInContext("setupChapterSync()", context);
    if (quota === "gs-prefix") {
      for (let row = 1; row < state.rows.length; row++) {
        state.rows[row][0] = "gs-" + state.rows[row][0];
        state.notes[row][0] = "";
      }
    }
    assert.equal(post(profileApplication()).code, "SUBMISSION_RATE_LIMIT");
    assert.equal(state.files.length, 0);
    assert.equal(post(application()).ok, true);
  }
});

test("compact legacy recovery fills only retained profile columns and new identity links once", () => {
  const { state, post, context } = fixture();
  const current = profileApplication();
  const legacy = { ...application(), version: 2, application: { ...application().application, driverLicenseDetails: current.application.driverLicenseDetails }, documents: current.documents.slice(0, 6) };
  assert.equal(post(legacy).ok, true);
  state.rows = state.rows.map((row) => row.slice(0, 30));
  state.maxColumns = 30;
  vm.runInContext("setupChapterSync()", context);
  const preservedBase = [...state.rows[1].slice(0, 14)];
  const callsBefore = state.calls.length;
  assert.equal(post(current).duplicate, true);
  assert.deepEqual(state.rows[1].slice(0, 14), preservedBase);
  assert.equal(state.rows[1][14], current.application.profile.firstName);
  assert.equal(state.rows[1][18], "Manila");
  assert.equal(state.rows[1][25], "Macedonia");
  assert.ok(state.rows[1].slice(32, 35).every((link) => /^https:\/\/drive\.google\.com\/file\/d\//.test(String(link))));
  assert.equal(state.rows[1].length, 36);
  assert.equal(state.files.length, 10);
  assert.equal(state.calls.slice(callsBefore).filter(({ url }) => url.includes("/files?q=")).length, 3);
  const write = state.calls.slice(callsBefore).find(({ url }) => url.endsWith(":batchUpdate"))!;
  assert.equal(JSON.parse(write.options.payload as string).requests[0].updateCells.start.columnIndex, 14);
  state.hideSearchResults = true;
  const duplicateCalls = state.calls.length;
  assert.equal(post(current).duplicate, true);
  assert.ok(!state.calls.slice(duplicateCalls).some(({ url }) => url.includes("/files?q=") || url.endsWith(":batchUpdate") || url.includes("uploadType=")));
  assert.equal(state.files.length, 10);
  assert.equal(post(legacy).duplicate, true);
});

test("compact writes retry safely after failed persistence or a lost acknowledgement", () => {
  for (const failure of ["write", "acknowledgement"]) {
    const { state, post, context } = fixture();
    vm.runInContext("setupChapterSync()", context);
    const payload = profileApplication();
    if (failure === "write") state.writeFailures = 1;
    else state.writeWrongAck = true;
    assert.equal(post(payload).code, failure === "write" ? "SHEET_WRITE_FAILED" : "SHEET_WRITE_UNCONFIRMED");
    assert.equal(state.files.length, 10);
    if (failure === "write") {
      assert.equal(state.rows.length, 1);
      assert.equal(state.notes[1]?.[0] ?? "", "");
    } else {
      assert.equal(state.rows.length, 2);
      assert.match(state.notes[1][0], /Jobs in Croatia/);
      state.hideSearchResults = true;
    }
    state.writeWrongAck = false;
    assert.equal(post(payload).ok, true);
    assert.equal(state.rows.length, 2);
    assert.equal(state.files.length, 10);
  }
});

test("compaction refuses changed headers or an unverified backup before removing any columns", () => {
  for (const failure of ["header", "hidden", "values"]) {
    const { state, post, context } = fixture();
    assert.equal(post(profileApplication()).ok, true);
    if (failure === "header") state.rows[0][29] = "Unrelated recruiter notes";
    if (failure === "hidden") state.failBackup = true;
    if (failure === "values") state.corruptBackup = true;
    const original = structuredClone(state.rows);
    const metadata = structuredClone(state.columnMetadata);
    assert.throws(() => vm.runInContext("setupChapterSync()", context), failure === "header" ? /HEADER_MISMATCH/ : /BACKUP_FAILED/);
    assert.deepEqual(state.rows, original);
    assert.deepEqual(state.columnMetadata, metadata);
    assert.equal(state.maxColumns, 54);
    assert.equal(state.locks, state.releases);
    if (failure === "header") assert.equal(state.backups.length, 0);
  }
});

test("owner setup chooses a unique native backup title and initializes a blank compact sheet", () => {
  const populated = fixture();
  populated.state.backups.push({ name: `Applications backup ${new Date().toISOString().slice(0, 10)}`, hidden: true, rows: [], notes: [], columnMetadata: [] });
  const result = vm.runInContext("setupChapterSync()", populated.context);
  assert.match(result.backupSheetName, / \(2\)$/);
  const blank = fixture();
  blank.state.rows = [];
  blank.state.filter = null;
  vm.runInContext("setupChapterSync()", blank.context);
  assert.equal(blank.state.rows[0].length, 36);
  assert.equal(blank.state.maxColumns, 36);
  assert.equal(blank.state.backups.length, 0);
  assert.equal(blank.state.filter!.columns, 36);
  assert.equal(blank.post(profileApplication()).ok, true);
});

test("every website discovery choice and shared referral alias is stored literally in appended AJ with safe retries", () => {
  for (const answer of [...discoverySources, "Google Search", ""]) {
    const { state, post, context } = fixture();
    vm.runInContext("setupChapterSync()", context);
    const original = profileApplication();
    const { referralSource: _source, ...details } = original.application;
    const payload = { ...original, application: { ...details, discoverySource: answer } };
    assert.equal(post(payload).ok, true);
    assert.equal(state.rows[0][35], "Where did you find us?");
    assert.equal(state.rows[1][35], answer);
    const saved = structuredClone(state.rows);
    state.hideSearchResults = true;
    const calls = state.calls.length;
    assert.equal(post(payload).duplicate, true);
    assert.deepEqual(state.rows, saved);
    assert.equal(state.files.length, 10);
    assert.ok(!state.calls.slice(calls).some(({ url }) => url.includes("uploadType=") || url.endsWith(":batchUpdate")));
    if (answer) {
      const changed = answer === "Facebook" ? "Instagram" : "Facebook";
      assert.equal(post({ ...payload, application: { ...payload.application, discoverySource: changed } }).code, "EXISTING_PROFILE_MISMATCH");
      assert.deepEqual(state.rows, saved);
    }
  }
});

test("staged receiver saves discovery answers in compact35 metadata and exact retries preserve the retained answer", () => {
  const { state, post, context } = fixture();
  vm.runInContext("setupChapterSync()", context);
  state.rows[0] = state.rows[0].slice(0, 35);
  state.maxColumns = 35;
  const source = profileApplication();
  const { referralSource: _source, ...details } = source.application;
  const legacy = { ...source, application: details };
  state.calls.length = 0;
  assert.equal(post(source).ok, true);
  assert.equal(state.rows[1].length, 35);
  const metadata = JSON.parse(state.notes[1][0].split("CHAPTER_RECEIVER_METADATA_V1\n")[1]);
  assert.equal(metadata.referralSource, "Google Search");
  assert.equal(post(source).duplicate, true);
  assert.equal(post(legacy).duplicate, true);
  assert.equal(state.files.length, 10);
  assert.equal(state.rows.length, 2);
  const rows = structuredClone(state.rows);
  assert.equal(post({ ...legacy, application: { ...legacy.application, discoverySource: "Facebook" } }).code, "EXISTING_PROFILE_MISMATCH");
  assert.deepEqual(state.rows, rows);
});

test("owner referral upgrade backs up compact35 and appends retained discovery answers at AJ without moving existing data", () => {
  const { state, post, context, properties } = fixture();
  vm.runInContext("setupChapterSync()", context);
  const original = profileApplication();
  const { referralSource: _source, ...details } = original.application;
  state.rows[0] = state.rows[0].slice(0, 35);
  state.maxColumns = 35;
  assert.equal(post({ ...original, application: { ...details, discoverySource: "Threads" } }).ok, true);
  state.notes[1][3] = "Staff email note";
  state.filter!.columns = 35;
  state.filter!.criteria[19] = { city: "Manila" };
  const rows = structuredClone(state.rows);
  const notes = structuredClone(state.notes);
  const columns = structuredClone(state.columnMetadata);
  const configured = [...properties];
  const backups = state.backups.length;
  const upgrade = vm.runInContext("setupChapterSync()", context);
  assert.equal(upgrade.columns, 36);
  assert.deepEqual(state.rows.map((row) => row.slice(0, 35)), rows);
  assert.equal(state.rows[0][35], "Where did you find us?");
  assert.equal(state.rows[1][35], "Threads");
  assert.deepEqual(state.notes, notes);
  assert.deepEqual(state.columnMetadata.slice(0, 35), columns.slice(0, 35));
  assert.deepEqual([...properties], configured);
  assert.equal(state.backups.length, backups + 1);
  assert.equal(state.backups.at(-1)?.hidden, true);
  assert.deepEqual(state.backups.at(-1)?.rows, rows);
  assert.deepEqual(state.filter!.criteria, { 19: { city: "Manila" } });
  assert.equal(state.filter!.columns, 36);
  assert.equal(state.validationChanges.at(-1)?.column, 36);
  const writes = state.validationChanges.length;
  assert.equal(vm.runInContext("setupChapterSync()", context).columns, 36);
  assert.equal(state.validationChanges.length, writes + 1);
  assert.equal(state.backups.length, backups + 1);
  // The exact signed retry still resolves to the existing row and private files.
  assert.equal(post({ ...original, application: { ...details, discoverySource: "Threads" } }).duplicate, true);
  assert.deepEqual(state.rows[1].slice(0, 35), rows[1]);
  assert.equal(state.rows[1][35], "Threads");
  assert.equal(state.files.length, 10);
  const saved = structuredClone(state.rows);
  const calls = state.calls.length;
  assert.equal(post({ ...original, application: { ...details, discoverySource: "Threads" } }).duplicate, true);
  assert.deepEqual(state.rows, saved);
  assert.ok(!state.calls.slice(calls).some(({ url }) => url.endsWith(":batchUpdate") || url.includes("uploadType=")));
});

test("AJ header conflicts fail closed before altering rows or uploading documents", () => {
  const { state, post, context } = fixture();
  vm.runInContext("setupChapterSync()", context);
  state.rows[0][35] = "Recruiter notes";
  const original = structuredClone(state.rows);
  assert.throws(() => vm.runInContext("setupChapterSync()", context), /HEADER_MISMATCH/);
  assert.equal(post(profileApplication()).code, "HEADER_MISMATCH");
  assert.deepEqual(state.rows, original);
  assert.equal(state.files.length, 0);
});
