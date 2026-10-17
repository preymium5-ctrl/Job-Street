import type { NextRequest } from "next/server";
import {
  authorize,
  failure,
  json,
  limitedJson,
  serverFailure,
} from "@/lib/api";
import { getJobById, saveJob } from "@/lib/repository";
import { jobSchema, fieldErrors } from "@/lib/validation";
import type { Job } from "@/lib/types";
export const runtime = "nodejs";
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorize(request, true);
    if (auth.response) return auth.response;
    const { id } = await context.params;
    const existing = await getJobById(id);
    if (!existing) return failure("Job not found.", 404);
    const update = await limitedJson(request);
    if (typeof update !== "object" || !update || Array.isArray(update))
      return failure("Invalid job details.");
    const parsed = jobSchema.safeParse({ ...existing, ...update, id });
    if (!parsed.success)
      return failure("Check the job details.", 422, {
        fieldErrors: fieldErrors(parsed.error),
      });
    return json({ job: await saveJob(parsed.data as Job, auth.admin!.id) });
  } catch (error) {
    if (error instanceof SyntaxError) return failure("Invalid job details.");
    if ((error as { cause?: { code?: string } }).cause?.code === "23505")
      return failure("Another job already uses this URL slug.", 409);
    return serverFailure(error);
  }
}
