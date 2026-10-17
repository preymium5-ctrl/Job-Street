import type { NextRequest } from "next/server";
import {
  authorize,
  failure,
  json,
  limitedFormData,
  serverFailure,
} from "@/lib/api";
import { MAX_IMAGE_BYTES, storeImage, UploadError } from "@/lib/storage";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const auth = await authorize(request, true);
    if (auth.response) return auth.response;
    const form = await limitedFormData(request, MAX_IMAGE_BYTES + 64 * 1024);
    const file = form.get("image");
    if (!(file instanceof File)) return failure("Choose a photo.");
    return json({ url: await storeImage(file) }, 201);
  } catch (error) {
    if (error instanceof UploadError) return failure(error.message, 422);
    if (error instanceof Error && error.message === "BODY_TOO_LARGE")
      return failure("Photos must be no larger than 8 MB.", 413);
    return serverFailure(error);
  }
}
