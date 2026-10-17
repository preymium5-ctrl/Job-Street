import type { NextRequest } from "next/server";
import { authorize, json, serverFailure } from "@/lib/api";
import { getApplications } from "@/lib/repository";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    return json({ applications: await getApplications() });
  } catch (error) {
    return serverFailure(error);
  }
}
