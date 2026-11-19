import "server-only";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory, localModeAllowed } from "./db";
import { usesGoogleApplicationStorage } from "./google-application-storage";
import { sheetsConfiguration, signedSheetsBody, type SheetsPayload } from "./sheets-transport";
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES, photoMimeType, SESSION_ID, VIDEO_CHUNK_BYTES, videoMimeType, type PhotoFileInput, type VideoApplicationDetails, type VideoFileInput } from "./video-application";

const SOURCE = "Jobstreet Croatia";
const LOCAL_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

type VideoErrorCode = "UNAVAILABLE" | "RATE_LIMIT" | "NOT_FOUND" | "INCOMPLETE" | "CONFLICT" | "INVALID";
const messages: Record<VideoErrorCode, [number, string]> = {
  UNAVAILABLE: [503, "Video applications are temporarily unavailable. Please try again later."],
  RATE_LIMIT: [429, "Too many video uploads were started recently. Please try again in an hour."],
  NOT_FOUND: [410, "Your upload session expired. Select Submit to upload your video again."],
  INCOMPLETE: [409, "Your video has not finished uploading. Select Submit to continue."],
  CONFLICT: [409, "This upload no longer matches your video. Refresh the page and try again."],
  INVALID: [422, "The upload could not be verified. Choose your video and try again."],
};
export class VideoApplicationError extends Error {
  readonly status: number;
  constructor(readonly code: VideoErrorCode) {
    super(messages[code][1]);
    this.status = messages[code][0];
  }
}

export type VideoStorageMode = "google" | "local" | "unavailable";
export function videoStorageMode(): VideoStorageMode {
  if (usesGoogleApplicationStorage()) return sheetsConfiguration().valid ? "google" : "unavailable";
  return localModeAllowed() ? "local" : "unavailable";
}

/* ---------------- Google Apps Script receiver (production) ---------------- */

async function receiver(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const signal = AbortSignal.timeout(60_000);
  let response: Response;
  try {
    response = await fetch(process.env.GOOGLE_SHEETS_WEBHOOK_URL!, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: signedSheetsBody(payload as unknown as SheetsPayload, process.env.GOOGLE_SHEETS_WEBHOOK_SECRET!),
      signal, cache: "no-store", redirect: "manual",
    });
    // ContentService answers through a single-use googleusercontent echo URL.
    if ([302, 303].includes(response.status)) {
      const redirect = new URL(response.headers.get("location") || "");
      if (redirect.protocol !== "https:" || redirect.hostname !== "script.googleusercontent.com" || redirect.port ||
        redirect.username || redirect.password || redirect.pathname !== "/macros/echo")
        throw new VideoApplicationError("UNAVAILABLE");
      await response.body?.cancel();
      response = await fetch(redirect, { method: "GET", signal, cache: "no-store", redirect: "error" });
    }
    if (!response.ok) throw new VideoApplicationError("UNAVAILABLE");
    const text = await response.text();
    if (text.length > 16 * 1024) throw new VideoApplicationError("UNAVAILABLE");
    const reply = JSON.parse(text) as unknown;
    if (!reply || typeof reply !== "object" || Array.isArray(reply)) throw new VideoApplicationError("UNAVAILABLE");
    const answer = reply as Record<string, unknown>;
    if (answer.ok !== true) {
      const code = answer.code;
      if (code === "VIDEO_RATE_LIMIT") throw new VideoApplicationError("RATE_LIMIT");
      if (code === "VIDEO_SESSION_NOT_FOUND") throw new VideoApplicationError("NOT_FOUND");
      if (code === "VIDEO_UPLOAD_INCOMPLETE") throw new VideoApplicationError("INCOMPLETE");
      if (code === "VIDEO_SESSION_CONFLICT" || code === "DUPLICATE_CONFLICT") throw new VideoApplicationError("CONFLICT");
      throw new VideoApplicationError("UNAVAILABLE");
    }
    return answer;
  } catch (error) {
    if (error instanceof VideoApplicationError) throw error;
    throw new VideoApplicationError("UNAVAILABLE");
  }
}

function clientKey(clientAddress: string) {
  return createHmac("sha256", process.env.GOOGLE_SHEETS_WEBHOOK_SECRET!).update(`video-client-v1\0${clientAddress}`).digest("hex");
}

/* ---------------- Local preview storage (.data/video-applications) ---------------- */

/** A video session links the applicant photo, which has its own upload session. */
interface LocalSession { id: string; name: string; mime: string; size: number; createdAt: number; reference?: string; photoId?: string; }
const localRoot = () => path.join(dataDirectory(), "video-applications");
const sessionPath = (id: string) => path.join(localRoot(), "sessions", `${id}.json`);
const partPath = (id: string) => path.join(localRoot(), "uploads", `${id}.part`);

async function readLocalSession(id: string): Promise<LocalSession> {
  if (!SESSION_ID.test(id)) throw new VideoApplicationError("INVALID");
  try {
    const session = JSON.parse(await readFile(sessionPath(id), "utf8")) as LocalSession;
    if (!session.reference && session.createdAt < Date.now() - LOCAL_SESSION_LIFETIME_MS) throw new VideoApplicationError("NOT_FOUND");
    return session;
  } catch (error) {
    if (error instanceof VideoApplicationError) throw error;
    throw new VideoApplicationError("NOT_FOUND");
  }
}
async function receivedBytes(id: string) {
  try { return (await stat(partPath(id))).size; }
  catch { return 0; }
}

/** Mirrors Google's resumable protocol so one browser uploader serves both modes. */
export async function writeLocalVideoChunk(id: string, contentRange: string | null, body: Uint8Array) {
  if (videoStorageMode() !== "local") throw new VideoApplicationError("UNAVAILABLE");
  const session = await readLocalSession(id);
  if (session.reference) return { complete: true as const, received: session.size };
  const status = /^bytes \*\/(\d+)$/.exec(contentRange || "");
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange || "");
  const total = Number(range ? range[3] : status?.[1]);
  if ((!status && !range) || total !== session.size) throw new VideoApplicationError("INVALID");
  let received = await receivedBytes(id);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (end < start || end >= session.size || body.byteLength !== end - start + 1 || body.byteLength > VIDEO_CHUNK_BYTES)
      throw new VideoApplicationError("INVALID");
    // A retried part that was already stored is acknowledged without rewriting it.
    if (start === received) {
      await appendFile(partPath(id), body);
      received += body.byteLength;
    }
  }
  return received >= session.size ? { complete: true as const, received } : { complete: false as const, received };
}

/* ---------------- Public operations used by the API route ---------------- */

const googleUploadUrl = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("https://www.googleapis.com/upload/drive/v3/files?");

export async function startVideoUpload(video: VideoFileInput, photo: PhotoFileInput, origin: string, clientAddress: string) {
  const mode = videoStorageMode();
  const mime = videoMimeType(video.name);
  const photoMime = photoMimeType(photo.name);
  if (mode === "unavailable" || !mime || !photoMime) throw new VideoApplicationError(mode === "unavailable" ? "UNAVAILABLE" : "INVALID");
  const id = randomUUID();
  if (mode === "local") {
    await mkdir(path.dirname(sessionPath(id)), { recursive: true });
    await mkdir(path.dirname(partPath(id)), { recursive: true });
    const photoId = randomUUID();
    const now = Date.now();
    await writeFile(sessionPath(photoId), JSON.stringify({ id: photoId, name: photo.name, mime: photoMime, size: photo.size, createdAt: now } satisfies LocalSession));
    await writeFile(sessionPath(id), JSON.stringify({ id, name: video.name, mime, size: video.size, createdAt: now, photoId } satisfies LocalSession));
    return { sessionId: id, uploadUrl: `/api/video-applications/upload/${id}`, photoUploadUrl: `/api/video-applications/upload/${photoId}` };
  }
  const reply = await receiver({ operation: "video-upload-start", version: 1, session: {
    id, name: video.name, mime, size: video.size, origin, clientKey: clientKey(clientAddress), source: SOURCE,
    photo: { name: photo.name, mime: photoMime, size: photo.size },
  } });
  if (reply.sessionId !== id || !googleUploadUrl(reply.uploadUrl) || !googleUploadUrl(reply.photoUploadUrl))
    throw new VideoApplicationError("UNAVAILABLE");
  return { sessionId: id, uploadUrl: reply.uploadUrl, photoUploadUrl: reply.photoUploadUrl };
}

function googleReference(sessionId: string) {
  return `VA-${createHmac("sha256", process.env.GOOGLE_SHEETS_WEBHOOK_SECRET!)
    .update(`video-application-v1\0${sessionId}`).digest("hex").slice(0, 16).toUpperCase()}`;
}

export async function completeVideoApplication(sessionId: string, details: VideoApplicationDetails, video: VideoFileInput, photo: PhotoFileInput, jobTitle: string) {
  if (!SESSION_ID.test(sessionId)) throw new VideoApplicationError("INVALID");
  const mode = videoStorageMode();
  if (mode === "unavailable") throw new VideoApplicationError("UNAVAILABLE");
  const submittedAt = new Date().toISOString();
  if (mode === "google") {
    const reference = googleReference(sessionId);
    const reply = await receiver({ operation: "video-application-submit", version: 1, application: {
      id: sessionId, reference, submittedAt, fullName: details.fullName, age: details.age, nationality: details.nationality,
      jobTitle, experienceYears: details.experienceYears, whatsapp: details.whatsapp, telegram: details.telegram,
      durationSeconds: video.durationSeconds === null ? null : Math.round(video.durationSeconds), consent: true, source: SOURCE,
    } });
    if (reply.applicationId !== sessionId || reply.reference !== reference || typeof reply.duplicate !== "boolean")
      throw new VideoApplicationError("UNAVAILABLE");
    return { reference, jobTitle, duplicate: reply.duplicate };
  }
  const session = await readLocalSession(sessionId);
  if (session.reference) return { reference: session.reference, jobTitle, duplicate: true };
  if (session.name !== video.name || session.size !== video.size || !session.photoId) throw new VideoApplicationError("CONFLICT");
  const photoSession = await readLocalSession(session.photoId);
  if (photoSession.name !== photo.name || photoSession.size !== photo.size) throw new VideoApplicationError("CONFLICT");
  if (await receivedBytes(sessionId) !== session.size || session.size > MAX_VIDEO_BYTES ||
    await receivedBytes(session.photoId) !== photoSession.size || photoSession.size > MAX_PHOTO_BYTES)
    throw new VideoApplicationError("INCOMPLETE");
  const reference = `VA-${randomBytes(8).toString("hex").toUpperCase()}`;
  const folder = path.join(localRoot(), "applications", reference);
  await mkdir(folder, { recursive: true });
  const extension = path.extname(session.name).toLowerCase();
  const photoExtension = path.extname(photoSession.name).toLowerCase();
  await rename(partPath(sessionId), path.join(folder, `work-video${extension}`));
  await rename(partPath(session.photoId), path.join(folder, `photo${photoExtension}`));
  await writeFile(path.join(folder, "application.json"), JSON.stringify({
    reference, sessionId, submittedAt, ...details, jobTitle,
    video: { originalName: session.name, mime: session.mime, size: session.size, durationSeconds: video.durationSeconds, file: `work-video${extension}` },
    photo: { originalName: photoSession.name, mime: photoSession.mime, size: photoSession.size, file: `photo${photoExtension}` },
  }, null, 2));
  await writeFile(sessionPath(sessionId), JSON.stringify({ ...session, reference }));
  return { reference, jobTitle, duplicate: false };
}
