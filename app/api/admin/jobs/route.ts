import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  authorize,
  failure,
  json,
  limitedJson,
  serverFailure,
} from "@/lib/api";
import { getJobs, saveJob } from "@/lib/repository";
import { jobSchema, fieldErrors } from "@/lib/validation";
import type { Job } from "@/lib/types";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    return json({ jobs: await getJobs({ includeUnpublished: true }) });
  } catch (error) {
    return serverFailure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const auth = await authorize(request, true);
    if (auth.response) return auth.response;
    const parsed = jobSchema.safeParse(await limitedJson(request));
    if (!parsed.success)
      return failure("Check the job details.", 422, {
        fieldErrors: fieldErrors(parsed.error),
      });
    const job = { ...parsed.data, id: randomUUID() } as Job;
    return json({ job: await saveJob(job, auth.admin!.id, true) }, 201);
  } catch (error) {
    if (error instanceof SyntaxError) return failure("Invalid job details.");
    if ((error as { cause?: { code?: string } }).cause?.code === "23505")
      return failure("Another job already uses this URL slug.", 409);
    return serverFailure(error);
  }
}
