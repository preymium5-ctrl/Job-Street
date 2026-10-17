import type { NextRequest } from "next/server";
import {
  authorize,
  failure,
  json,
  limitedJson,
  serverFailure,
} from "@/lib/api";
import { updateApplicationStatus } from "@/lib/repository";
import { statusSchema } from "@/lib/validation";
export const runtime = "nodejs";
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorize(request, true);
    if (auth.response) return auth.response;
    const parsed = statusSchema.safeParse(await limitedJson(request, 2048));
    if (!parsed.success)
      return failure("Choose a valid application status.", 422);
    const { id } = await context.params;
    const application = await updateApplicationStatus(
      id,
      parsed.data.status,
      auth.admin!.id,
    );
    return application
      ? json({ application })
      : failure("Application not found.", 404);
  } catch (error) {
    if (error instanceof SyntaxError) return failure("Invalid status.");
    return serverFailure(error);
  }
}
