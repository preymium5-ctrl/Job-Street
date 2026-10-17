import { NextResponse, type NextRequest } from "next/server";
import { authorize, failure, serverFailure } from "@/lib/api";
import { auditResumeAccess, getApplicationById } from "@/lib/repository";
import { readObject } from "@/lib/storage";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    const { id } = await context.params;
    const application = await getApplicationById(id);
    if (!application) return failure("Application not found.", 404);
    const bytes = await readObject(application.resumeKey);
    await auditResumeAccess(auth.admin!.id, id);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": application.resumeMime,
        "Content-Disposition": `attachment; filename="${application.resumeName.replace(/["\r\n]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return serverFailure(error);
  }
}
