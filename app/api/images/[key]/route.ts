import { NextResponse, type NextRequest } from "next/server";
import { failure } from "@/lib/api";
import { readObject } from "@/lib/storage";
export const runtime = "nodejs";
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;
  if (!/^[a-f0-9-]{36}\.jpg$/.test(key))
    return failure("Image not found.", 404);
  try {
    return new NextResponse(new Uint8Array(await readObject(`images/${key}`)), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return failure("Image not found.", 404);
  }
}
