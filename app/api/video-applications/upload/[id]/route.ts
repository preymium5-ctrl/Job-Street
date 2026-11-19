import { NextResponse, type NextRequest } from "next/server";
import { boundedBody, failure, serverFailure } from "@/lib/api";
import { sameOrigin } from "@/lib/auth";
import { VIDEO_CHUNK_BYTES } from "@/lib/video-application";
import { VideoApplicationError, writeLocalVideoChunk } from "@/lib/video-application-storage";

export const runtime = "nodejs";

/**
 * Local preview only. Production browsers upload straight to Google Drive's
 * resumable endpoint; this route answers with the same 308/Range protocol.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) return failure("Upload your video from this website.", 403);
    const { id } = await context.params;
    const contentRange = request.headers.get("content-range");
    const body = contentRange?.startsWith("bytes */") ? new Uint8Array() : await boundedBody(request, VIDEO_CHUNK_BYTES);
    const result = await writeLocalVideoChunk(id, contentRange, body);
    if (result.complete) return NextResponse.json({ id }, { status: 200, headers: { "Cache-Control": "no-store" } });
    return new NextResponse(null, {
      status: 308,
      headers: { "Cache-Control": "no-store", ...(result.received ? { Range: `bytes=0-${result.received - 1}` } : {}) },
    });
  } catch (error) {
    if (error instanceof VideoApplicationError) return failure(error.message, error.status, { code: error.code });
    if (error instanceof Error && (error.message === "BODY_TOO_LARGE" || error.message === "EMPTY_BODY"))
      return failure("Upload the video in smaller parts.", 413);
    return serverFailure(error);
  }
}
