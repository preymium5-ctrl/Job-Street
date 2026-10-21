const DIRECT_REQUEST_BYTES = 3_500_000;
const CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 16 * 1024 * 1024;

export class ApplicationUploadError extends Error {
  constructor(message: string, public readonly code?: string) { super(message); }
}

export interface PreparedApplicationUpload {
  key: string;
  form: FormData;
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
  ticket?: string;
  uploadId?: string;
  uploadedChunks: Set<number>;
}

async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function uploadRequest(body: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch("/api/applications/uploads", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new ApplicationUploadError("We couldn’t finish uploading your files. Check your connection and select Submit to retry.");
  }
  let result: Record<string, unknown>;
  try { result = await response.json(); }
  catch { throw new ApplicationUploadError("We couldn’t confirm the file upload. Select Submit to retry."); }
  if (!response.ok)
    throw new ApplicationUploadError(typeof result.error === "string" ? result.error : "We couldn’t upload your files. Select Submit to retry.", typeof result.code === "string" ? result.code : undefined);
  return result;
}

export async function prepareApplicationUpload(form: FormData, key: string): Promise<PreparedApplicationUpload> {
  // Keep this exact multipart boundary and its bytes for an unchanged retry.
  const serialized = new Response(form);
  const bytes = new Uint8Array(await serialized.arrayBuffer());
  if (bytes.length > MAX_ENVELOPE_BYTES)
    throw new ApplicationUploadError("Keep all files together within 15 MB and try again.");
  return {
    key, form, bytes, contentType: serialized.headers.get("content-type") || "",
    sha256: bytes.length > DIRECT_REQUEST_BYTES ? await digest(bytes) : "",
    uploadedChunks: new Set(),
  };
}

export function resetStagedUpload(upload: PreparedApplicationUpload) {
  upload.ticket = undefined;
  upload.uploadId = undefined;
  upload.uploadedChunks.clear();
}

export async function stageApplicationUpload(upload: PreparedApplicationUpload, onProgress: (percent: number) => void): Promise<{
  body: FormData | string; contentType?: string; staged: boolean;
}> {
  if (upload.bytes.length <= DIRECT_REQUEST_BYTES) return { body: upload.form, staged: false };
  const chunkCount = Math.ceil(upload.bytes.length / CHUNK_BYTES);
  try {
    if (!upload.ticket) {
      const payload = upload.form.get("payload");
      if (typeof payload !== "string") throw new ApplicationUploadError("Check your application details and try again.");
      const files = Array.from(upload.form.entries()).flatMap(([field, value]) => value instanceof File
        ? [{ field, name: value.name, size: value.size, type: value.type }] : []);
      const result = await uploadRequest({ action: "start", payload: JSON.parse(payload), submissionKey: upload.key,
        upload: { sha256: upload.sha256, totalBytes: upload.bytes.length, chunkCount, contentType: upload.contentType }, files });
      if (typeof result.ticket !== "string" || typeof result.uploadId !== "string" || result.chunkCount !== chunkCount)
        throw new ApplicationUploadError("We couldn’t start the file upload. Select Submit to retry.");
      upload.ticket = result.ticket;
      upload.uploadId = result.uploadId;
    }
    for (let index = 0; index < chunkCount; index++) {
      if (!upload.uploadedChunks.has(index)) {
        const part = upload.bytes.subarray(index * CHUNK_BYTES, Math.min((index + 1) * CHUNK_BYTES, upload.bytes.length));
        const result = await uploadRequest({ action: "chunk", ticket: upload.ticket, index, base64: base64(part) });
        if (result.uploadId !== upload.uploadId || result.index !== index || result.bytes !== part.length || result.sha256 !== await digest(part))
          throw new ApplicationUploadError("We couldn’t confirm one part of your upload. Select Submit to retry.");
        upload.uploadedChunks.add(index);
      }
      onProgress(Math.round(((index + 1) / chunkCount) * 90));
    }
    return { body: JSON.stringify({ stagedUploadTicket: upload.ticket }), contentType: "application/json", staged: true };
  } catch (error) {
    if (error instanceof ApplicationUploadError && error.code && ["UPLOAD_STAGE_EXPIRED", "UPLOAD_STAGE_NOT_FOUND", "UPLOAD_STAGE_CONFLICT"].includes(error.code)) resetStagedUpload(upload);
    throw error;
  }
}
