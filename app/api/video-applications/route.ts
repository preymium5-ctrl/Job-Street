import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { failure, json, limitedJson, serverFailure } from "@/lib/api";
import { rateLimit, sameOrigin } from "@/lib/auth";
import { getJobById } from "@/lib/repository";
import { publishedCatalogJobs } from "@/data/catalog";
import { fieldErrors } from "@/lib/validation";
import { photoFileSchema, SESSION_ID, videoApplicationSchema, videoFileSchema } from "@/lib/video-application";
import { completeVideoApplication, startVideoUpload, VideoApplicationError, videoStorageMode } from "@/lib/video-application-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

function clientAddress(request: NextRequest) {
  // Trust only the deployment proxy's IP headers; other installations opt in.
  const forwarded = process.env.VERCEL === "1"
    ? request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for")
    : process.env.TRUST_PROXY === "true" ? request.headers.get("x-forwarded-for") : null;
  const candidate = forwarded?.split(",")[0]?.trim() || "";
  return isIP(candidate) ? candidate : "shared";
}

/**
 * Two steps keep the 100 MB video off this server in production:
 * `start` opens a private Google Drive upload that the browser fills directly,
 * then `complete` verifies the stored video and records the application row.
 */
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return failure("Submit your application from this website.", 403);
    const mode = videoStorageMode();
    if (mode === "unavailable") throw new VideoApplicationError("UNAVAILABLE");
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      return failure("Use the website application form.", 400);
    const body = await limitedJson(request, 16 * 1024);
    if (!body || typeof body !== "object" || Array.isArray(body)) return failure("Use the website application form.", 400);
    const { action, details, video, photo, sessionId, website } = body as Record<string, unknown>;
    if (typeof website === "string" && website.trim()) return failure("The application could not be accepted.", 400);

    const parsedDetails = videoApplicationSchema.safeParse(details);
    const parsedVideo = videoFileSchema.safeParse(video);
    const parsedPhoto = photoFileSchema.safeParse(photo);
    if (!parsedDetails.success || !parsedVideo.success || !parsedPhoto.success) {
      const errors = {
        ...(parsedDetails.success ? {} : fieldErrors(parsedDetails.error)),
        ...(parsedVideo.success ? {} : { video: parsedVideo.error.issues[0]?.message || "Choose a valid video." }),
        ...(parsedPhoto.success ? {} : { photo: parsedPhoto.error.issues[0]?.message || "Attach a clear photo of yourself." }),
      };
      return failure("Check the highlighted details.", 422, { fieldErrors: errors });
    }
    const job = mode === "google"
      ? publishedCatalogJobs.find(({ id }) => id === parsedDetails.data.jobId)
      : await getJobById(parsedDetails.data.jobId);
    if (!job || job.status !== "published")
      return failure("This position is no longer accepting applications.", 409, { fieldErrors: { jobId: "Select a position from the list." } });

    if (action === "start") {
      // The Google receiver enforces shared quotas; local preview uses the site database.
      if (mode === "local" && !(await rateLimit(request, "video-application", 10, 3600)))
        throw new VideoApplicationError("RATE_LIMIT");
      const origin = new URL(request.headers.get("origin")!).origin;
      return json(await startVideoUpload(parsedVideo.data, parsedPhoto.data, origin, clientAddress(request)), 201);
    }
    if (action === "complete") {
      if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return failure("Refresh the form and try again.", 400);
      const saved = await completeVideoApplication(sessionId, parsedDetails.data, parsedVideo.data, parsedPhoto.data, job.title);
      return json({ reference: saved.reference, jobTitle: saved.jobTitle }, saved.duplicate ? 200 : 201);
    }
    return failure("Use the website application form.", 400);
  } catch (error) {
    if (error instanceof VideoApplicationError) return failure(error.message, error.status, { code: error.code });
    if (error instanceof SyntaxError) return failure("Use the website application form.", 400);
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") return failure("Use the website application form.", 413);
    return serverFailure(error);
  }
}
