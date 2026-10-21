import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { failure, json, limitedJson, serverFailure } from "@/lib/api";
import { sameOrigin } from "@/lib/auth";
import { initializeStagedUpload, MAX_STAGED_REQUEST_BYTES, StagedUploadError, uploadStagedChunk } from "@/lib/staged-uploads";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return failure("Submit your application from this website.", 403);
    if (process.env.APPLICATION_STORAGE !== "google-sheets") return failure("Document staging is unavailable.", 404);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      return failure("Use the website application form.", 400);
    const input = await limitedJson(request, MAX_STAGED_REQUEST_BYTES);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new StagedUploadError("UPLOAD_STAGE_INVALID");
    const body = input as Record<string, unknown>;
    if (body.action === "start") {
      if (Object.keys(body).length !== 5) throw new StagedUploadError("UPLOAD_STAGE_INVALID");
      const { action: _action, ...start } = body;
      void _action;
      // Trust only the deployment proxy's IP headers; other installations opt in.
      const forwarded = process.env.VERCEL === "1"
        ? request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for")
        : process.env.TRUST_PROXY === "true" ? request.headers.get("x-forwarded-for") : null;
      const candidate = forwarded?.split(",")[0]?.trim() || "";
      return json(await initializeStagedUpload(start, isIP(candidate) ? candidate : "shared"));
    }
    if (body.action === "chunk") {
      if (Object.keys(body).length !== 4 || typeof body.ticket !== "string" || typeof body.index !== "number" || typeof body.base64 !== "string")
        throw new StagedUploadError("UPLOAD_STAGE_INVALID");
      return json(await uploadStagedChunk(body.ticket, body.index, body.base64));
    }
    throw new StagedUploadError("UPLOAD_STAGE_INVALID");
  } catch (error) {
    if (error instanceof StagedUploadError)
      return failure(error.message, error.status, { code: error.code, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) });
    if (error instanceof SyntaxError) return failure("The upload request is invalid.", 400);
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") return failure("Upload each document in smaller parts.", 413);
    return serverFailure(error);
  }
}
