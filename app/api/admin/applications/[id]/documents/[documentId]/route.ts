import { NextResponse, type NextRequest } from "next/server";
import { authorize, failure, serverFailure } from "@/lib/api";
import { auditResumeAccess, getApplicationById } from "@/lib/repository";
import { readObject } from "@/lib/storage";
export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    const { id, documentId } = await context.params;
    const application = await getApplicationById(id);
    const document = application?.documents?.find((item) => item.id === documentId);
    if (!document) return failure("Document not found.", 404);
    const bytes = await readObject(document.key);
    await auditResumeAccess(auth.admin!.id, id, documentId);
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": document.mime,
      "Content-Disposition": `attachment; filename="${document.name.replace(/["\r\n]/g, "_")}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return serverFailure(error); }
}
