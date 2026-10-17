import { NextResponse, type NextRequest } from "next/server";
import { currentAdmin, sameOrigin } from "./auth";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function failure(
  error: string,
  status = 400,
  extra: Record<string, unknown> = {},
) {
  return json({ error, ...extra }, status);
}
export async function authorize(request: NextRequest, mutate = false) {
  if (mutate && !sameOrigin(request))
    return {
      response: failure("This request must come from this website.", 403),
    };
  const admin = await currentAdmin(request);
  if (!admin) return { response: failure("Sign in to continue.", 401) };
  return { admin };
}
export function serverFailure(error: unknown) {
  // Do not put database messages, storage paths, or credentials into responses.
  const code = (error as { cause?: { code?: unknown } } | undefined)?.cause
    ?.code;
  console.error(
    "Chapter request failed:",
    error instanceof Error ? error.name : "Unknown error",
    typeof code === "string" && /^[A-Z0-9_]{1,20}$/.test(code) ? code : "",
  );
  return failure(
    "The service is temporarily unavailable. Please try again later.",
    503,
  );
}
export async function limitedJson(request: Request, maximum = 64 * 1024) {
  return JSON.parse(
    new TextDecoder().decode(await boundedBody(request, maximum)),
  ) as unknown;
}
export async function boundedBody(request: Request, maximum: number) {
  if (Number(request.headers.get("content-length")) > maximum)
    throw new Error("BODY_TOO_LARGE");
  if (!request.body) throw new Error("EMPTY_BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error("BODY_TOO_LARGE");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
export async function limitedFormData(request: Request, maximum: number) {
  const type = request.headers.get("content-type") || "";
  if (!type.startsWith("multipart/form-data;"))
    throw new Error("INVALID_MULTIPART");
  const body = await boundedBody(request, maximum);
  return new Request(request.url, {
    method: "POST",
    headers: { "content-type": type },
    body,
  }).formData();
}
