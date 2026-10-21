import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { proposedJobs } from "../data/jobs";
import { additionalApplicationJobs } from "../data/application-jobs";
import { applicationSchema, fieldErrors } from "./validation";
import { getReferenceApplicationUploads, MAX_REFERENCE_FILE_BYTES, MAX_REFERENCE_UPLOAD_BYTES } from "./document-uploads";
import { sheetsConfiguration, signedSheetsBody, type SheetsPayload } from "./sheets-transport";

export const STAGED_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
export const MAX_STAGED_ENVELOPE_BYTES = 16 * 1024 * 1024;
export const MAX_STAGED_REQUEST_BYTES = 3 * 1024 * 1024;
const MAX_TICKET_BYTES = 4096;
const STAGED_UPLOAD_LIFETIME_MS = 60 * 60 * 1000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MULTIPART = /^multipart\/form-data;\s*boundary=(?:[A-Za-z0-9'()+_,\-./:=?]{1,70}|"[A-Za-z0-9'()+_,\-./:=?]{1,70}")$/;

type StageErrorCode = "UPLOAD_STAGE_INVALID" | "UPLOAD_STAGE_EXPIRED" | "UPLOAD_STAGE_CONFLICT" | "UPLOAD_STAGE_NOT_FOUND" | "UPLOAD_STAGE_RATE_LIMIT" | "UPLOAD_STAGE_UNAVAILABLE";
const errors: Record<StageErrorCode, { status: number; message: string }> = {
  UPLOAD_STAGE_INVALID: { status: 422, message: "The upload could not be verified. Choose your files and try again." },
  UPLOAD_STAGE_EXPIRED: { status: 410, message: "Your upload session expired. Submit again to upload your selected files." },
  UPLOAD_STAGE_CONFLICT: { status: 409, message: "The uploaded files changed. Submit again to start a new upload." },
  UPLOAD_STAGE_NOT_FOUND: { status: 410, message: "An uploaded part is unavailable. Submit again to upload your selected files." },
  UPLOAD_STAGE_RATE_LIMIT: { status: 429, message: "Too many upload attempts. Please try again in an hour." },
  UPLOAD_STAGE_UNAVAILABLE: { status: 503, message: "We couldn’t upload your documents to Google. Please try again; keep this form open." },
};

export class StagedUploadError extends Error {
  readonly status: number;
  constructor(readonly code: StageErrorCode, message = errors[code].message, readonly fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "StagedUploadError";
    this.status = errors[code].status;
  }
}

export interface StagedUploadStart {
  payload: unknown;
  submissionKey: string;
  upload: { sha256: string; totalBytes: number; chunkCount: number; contentType: string };
  files: { field: string; name: string; size: number; type: string }[];
}

interface StageManifest {
  id: string;
  idempotencyKey: string;
  size: number;
  chunkSize: number;
  chunkCount: number;
  sha256: string;
  contentType: string;
  expiresAt: number;
  source: "Jobstreet Croatia";
  emailKey: string;
  clientKey: string;
}
interface StageTicket { manifest: StageManifest; payloadHash: string; }

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function requireGoogleStorage() {
  if (process.env.APPLICATION_STORAGE !== "google-sheets" || !sheetsConfiguration().valid)
    throw new StagedUploadError("UPLOAD_STAGE_UNAVAILABLE");
}
function secret() {
  requireGoogleStorage();
  return process.env.GOOGLE_SHEETS_WEBHOOK_SECRET!;
}
function digest(bytes: string | Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function privateKey(purpose: string, value: string) {
  const normalized = purpose === "email" ? value.trim().toLowerCase() : value;
  return createHmac("sha256", secret()).update(`staged-upload-${purpose}-v1\0${normalized}`).digest("hex");
}
function payloadDigest(payload: unknown) {
  const result = applicationSchema.safeParse(payload);
  if (!result.success) throw new StagedUploadError("UPLOAD_STAGE_INVALID", "Check the highlighted application details.", fieldErrors(result.error));
  if (result.data.applicationFormVersion !== 2 || !result.data.applicantDetails)
    throw new StagedUploadError("UPLOAD_STAGE_INVALID", "Complete the current website application form.");
  return { value: result.data, hash: digest(JSON.stringify(result.data)) };
}
function checkEnvelope(upload: unknown) {
  if (!exact(upload, ["sha256", "totalBytes", "chunkCount", "contentType"]) ||
    typeof upload.sha256 !== "string" || !SHA256.test(upload.sha256) ||
    !Number.isSafeInteger(upload.totalBytes) || Number(upload.totalBytes) < 1 || Number(upload.totalBytes) > MAX_STAGED_ENVELOPE_BYTES ||
    !Number.isSafeInteger(upload.chunkCount) || upload.chunkCount !== Math.ceil(Number(upload.totalBytes) / STAGED_UPLOAD_CHUNK_BYTES) ||
    typeof upload.contentType !== "string" || upload.contentType.length > 160 || !MULTIPART.test(upload.contentType))
    throw new StagedUploadError("UPLOAD_STAGE_INVALID");
  return upload as unknown as StagedUploadStart["upload"];
}
function checkFiles(files: unknown, uploads: ReturnType<typeof getReferenceApplicationUploads>, envelopeBytes: number) {
  if (!Array.isArray(files) || files.length < 1 || files.length > uploads.length)
    throw new StagedUploadError("UPLOAD_STAGE_INVALID");
  const allowedFields = new Set(uploads.map(({ id }) => id === "resume" ? "resume" : `document:${id}`));
  const seen = new Set<string>();
  const mimeByExtension: Record<string, string> = {
    pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  };
  let total = 0;
  for (const file of files) {
    if (!exact(file, ["field", "name", "size", "type"]) || typeof file.field !== "string" || !allowedFields.has(file.field) || seen.has(file.field) ||
      typeof file.name !== "string" || !file.name || file.name.length > 200 || /[\\/\x00-\x1f\x7f]/.test(file.name) ||
      typeof file.type !== "string" || file.type.length > 100 || !Number.isSafeInteger(file.size) || Number(file.size) < 1)
      throw new StagedUploadError("UPLOAD_STAGE_INVALID");
    seen.add(file.field);
    if (Number(file.size) > MAX_REFERENCE_FILE_BYTES)
      throw new StagedUploadError("UPLOAD_STAGE_INVALID", "Each file must be 5 MB or smaller.", { [file.field]: "Choose a file of 5 MB or less." });
    const extension = /\.([a-z]+)$/i.exec(file.name)?.[1].toLowerCase() || "";
    const expectedMime = mimeByExtension[extension];
    if (!expectedMime || (file.field === "resume" && !["pdf", "doc", "docx"].includes(extension)) ||
      file.type && file.type !== "application/octet-stream" && file.type !== expectedMime)
      throw new StagedUploadError("UPLOAD_STAGE_INVALID", "Choose a supported document format.", { [file.field]: file.field === "resume" ? "Choose a PDF, DOC or DOCX file." : "Choose a PDF, DOC, DOCX, JPG or PNG file." });
    total += Number(file.size);
  }
  if (total > MAX_REFERENCE_UPLOAD_BYTES || total >= envelopeBytes)
    throw new StagedUploadError("UPLOAD_STAGE_INVALID", "Keep all files together within 15 MB.", { documents: "Keep all files together within 15 MB." });
  const required = uploads.filter(({ required }) => required).map(({ id }) => id === "resume" ? "resume" : `document:${id}`);
  const missing = Object.fromEntries(required.filter((field) => !seen.has(field)).map((field) => [field, "Attach the required application document."]));
  if (Object.keys(missing).length) throw new StagedUploadError("UPLOAD_STAGE_INVALID", "Attach the required application documents.", missing);
}

function encodeTicket(value: StageTicket) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(`staged-upload-ticket-v1\0${body}`).digest("base64url");
  return `${body}.${signature}`;
}
function decodeTicket(ticket: unknown): StageTicket {
  const signingSecret = secret();
  if (typeof ticket !== "string" || ticket.length > MAX_TICKET_BYTES || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket))
    throw new StagedUploadError("UPLOAD_STAGE_INVALID");
  const [body, signature] = ticket.split(".");
  const expected = createHmac("sha256", signingSecret).update(`staged-upload-ticket-v1\0${body}`).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new StagedUploadError("UPLOAD_STAGE_INVALID");
  let value: unknown;
  try { value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); }
  catch { throw new StagedUploadError("UPLOAD_STAGE_INVALID"); }
  if (!exact(value, ["manifest", "payloadHash"]) || typeof value.payloadHash !== "string" || !SHA256.test(value.payloadHash) ||
    !exact(value.manifest, ["id", "idempotencyKey", "size", "chunkSize", "chunkCount", "sha256", "contentType", "expiresAt", "source", "emailKey", "clientKey"]))
    throw new StagedUploadError("UPLOAD_STAGE_INVALID");
  const manifest = value.manifest;
  if (typeof manifest.id !== "string" || !UUID.test(manifest.id) || typeof manifest.idempotencyKey !== "string" || !UUID.test(manifest.idempotencyKey) ||
    manifest.chunkSize !== STAGED_UPLOAD_CHUNK_BYTES || manifest.source !== "Jobstreet Croatia" ||
    typeof manifest.emailKey !== "string" || !SHA256.test(manifest.emailKey) || typeof manifest.clientKey !== "string" || !SHA256.test(manifest.clientKey) ||
    !Number.isSafeInteger(manifest.expiresAt) || Number(manifest.expiresAt) > Date.now() + STAGED_UPLOAD_LIFETIME_MS)
    throw new StagedUploadError("UPLOAD_STAGE_INVALID");
  checkEnvelope({ sha256: manifest.sha256, totalBytes: manifest.size, chunkCount: manifest.chunkCount, contentType: manifest.contentType });
  if (Number(manifest.expiresAt) <= Date.now()) throw new StagedUploadError("UPLOAD_STAGE_EXPIRED");
  return value as unknown as StageTicket;
}

async function readReply(response: Response) {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_STAGED_REQUEST_BYTES)
    throw new StagedUploadError("UPLOAD_STAGE_UNAVAILABLE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    total += item.value.byteLength;
    if (total > MAX_STAGED_REQUEST_BYTES) {
      await reader.cancel();
      throw new StagedUploadError("UPLOAD_STAGE_UNAVAILABLE");
    }
    chunks.push(item.value);
  }
  let reply: unknown;
  try { reply = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new StagedUploadError("UPLOAD_STAGE_UNAVAILABLE"); }
  if (!object(reply)) throw new StagedUploadError("UPLOAD_STAGE_UNAVAILABLE");
  if (reply.ok === false) {
    const code = typeof reply.code === "string" && Object.hasOwn(errors, reply.code) ? reply.code as StageErrorCode : "UPLOAD_STAGE_UNAVAILABLE";
    throw new StagedUploadError(code);
  }
  return reply;
}

async function stageOperation(payload: Record<string, unknown>) {
  const signingSecret = secret();
  const signal = AbortSignal.timeout(75_000);
  try {
    let response = await fetch(process.env.GOOGLE_SHEETS_WEBHOOK_URL!, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: signedSheetsBody(payload as unknown as SheetsPayload, signingSecret),
      signal, cache: "no-store", redirect: "manual",
    });
    if ([302, 303].includes(response.status)) {
      let redirect: URL;
      try { redirect = new URL(response.headers.get("location") || ""); }
      catch { throw new StagedUploadError("UPLOAD_STAGE_UNAVAILABLE"); }
      if (redirect.protocol !== "https:" || redirect.hostname !== "script.googleusercontent.com" || redirect.port || redirect.username || redirect.password || redirect.pathname !== "/macros/echo")
        throw new StagedUploadError("UPLOAD_STAGE_UNAVAILABLE");
      await response.body?.cancel();
      response = await fetch(redirect, { method: "GET", signal, cache: "no-store", redirect: "error" });
    }
    return await readReply(response);
  } catch (error) {
    if (error instanceof StagedUploadError) throw error;
    throw new StagedUploadError("UPLOAD_STAGE_UNAVAILABLE");
  }
}

export async function initializeStagedUpload(input: StagedUploadStart | unknown, clientAddress = "shared") {
  requireGoogleStorage();
  if (!exact(input, ["payload", "submissionKey", "upload", "files"]) || typeof input.submissionKey !== "string" || !UUID.test(input.submissionKey))
    throw new StagedUploadError("UPLOAD_STAGE_INVALID");
  const { value, hash } = payloadDigest(input.payload);
  const job = [...proposedJobs, ...additionalApplicationJobs].find(({ id }) => id === value.jobId);
  if (!job || job.status !== "published") throw new StagedUploadError("UPLOAD_STAGE_CONFLICT", "This position is no longer accepting applications.");
  const upload = checkEnvelope(input.upload);
  const uploads = getReferenceApplicationUploads({ country: value.country, destinationCountry: value.destinationCountry, jobTitle: job.title });
  checkFiles(input.files, uploads, upload.totalBytes);
  const manifest: StageManifest = {
    id: randomUUID(), idempotencyKey: input.submissionKey, size: upload.totalBytes,
    chunkSize: STAGED_UPLOAD_CHUNK_BYTES, chunkCount: upload.chunkCount, sha256: upload.sha256,
    contentType: upload.contentType, expiresAt: Date.now() + STAGED_UPLOAD_LIFETIME_MS,
    source: "Jobstreet Croatia", emailKey: privateKey("email", value.email), clientKey: privateKey("client", clientAddress),
  };
  // Issue the stable ticket before reserving Google storage. A lost start
  // response creates no abandoned reservation or extra quota charge.
  return { ticket: encodeTicket({ manifest, payloadHash: hash }), uploadId: manifest.id, chunkCount: manifest.chunkCount };
}

function chunkBytes(manifest: StageManifest, index: unknown, base64: unknown) {
  if (!Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= manifest.chunkCount || typeof base64 !== "string")
    throw new StagedUploadError("UPLOAD_STAGE_INVALID");
  const expected = Math.min(STAGED_UPLOAD_CHUNK_BYTES, manifest.size - Number(index) * STAGED_UPLOAD_CHUNK_BYTES);
  if (base64.length !== Math.ceil(expected / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    throw new StagedUploadError("UPLOAD_STAGE_INVALID");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length !== expected || bytes.toString("base64") !== base64) throw new StagedUploadError("UPLOAD_STAGE_INVALID");
  return bytes;
}

export async function uploadStagedChunk(ticket: string, index: number, base64: string) {
  const { manifest } = decodeTicket(ticket);
  const bytes = chunkBytes(manifest, index, base64);
  if (index === 0) {
    // If Google's acknowledgement is lost, retrying this already issued ticket
    // initializes the same manifest and reuses its reservation and file IDs.
    const initialized = await stageOperation({ operation: "upload-stage-init", version: 1, manifest });
    if (!exact(initialized, ["ok", "sessionId"]) || initialized.ok !== true || initialized.sessionId !== manifest.id)
      throw new StagedUploadError("UPLOAD_STAGE_UNAVAILABLE");
  }
  const reply = await stageOperation({ operation: "upload-stage-write", version: 1, sessionId: manifest.id, index, base64 });
  if (!exact(reply, ["ok", "sessionId", "index", "size"]) || reply.ok !== true || reply.sessionId !== manifest.id || reply.index !== index || reply.size !== bytes.length)
    throw new StagedUploadError("UPLOAD_STAGE_UNAVAILABLE");
  return { uploadId: manifest.id, index, bytes: bytes.length, sha256: digest(bytes) };
}

/** Download privately, verify the complete envelope, then reuse normal form validation. */
export async function restoreStagedFormData(ticket: string): Promise<FormData> {
  const { manifest, payloadHash } = decodeTicket(ticket);
  const chunks: Buffer[] = new Array(manifest.chunkCount);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(3, manifest.chunkCount) }, async () => {
    while (nextIndex < manifest.chunkCount) {
      const index = nextIndex++;
      const reply = await stageOperation({ operation: "upload-stage-read", version: 1, sessionId: manifest.id, index });
      if (!exact(reply, ["ok", "sessionId", "index", "base64"]) || reply.ok !== true || reply.sessionId !== manifest.id || reply.index !== index)
        throw new StagedUploadError("UPLOAD_STAGE_UNAVAILABLE");
      chunks[index] = chunkBytes(manifest, index, reply.base64);
    }
  }));
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== manifest.size || digest(bytes) !== manifest.sha256) throw new StagedUploadError("UPLOAD_STAGE_CONFLICT");
  let form: FormData;
  try { form = await new Response(bytes, { headers: { "content-type": manifest.contentType } }).formData(); }
  catch { throw new StagedUploadError("UPLOAD_STAGE_INVALID"); }
  if (form.getAll("idempotencyKey").length !== 1 || form.get("idempotencyKey") !== manifest.idempotencyKey ||
    form.getAll("payload").length !== 1 || typeof form.get("payload") !== "string" || String(form.get("payload")).length > 30000)
    throw new StagedUploadError("UPLOAD_STAGE_CONFLICT");
  let payload: unknown;
  try { payload = JSON.parse(String(form.get("payload"))); }
  catch { throw new StagedUploadError("UPLOAD_STAGE_INVALID"); }
  const parsed = payloadDigest(payload);
  if (parsed.hash !== payloadHash || privateKey("email", parsed.value.email) !== manifest.emailKey)
    throw new StagedUploadError("UPLOAD_STAGE_CONFLICT");
  // Leave private parts available until expiry: an acknowledgement may be lost.
  return form;
}
