import type { NextRequest } from "next/server";
import { authorize, json, serverFailure } from "@/lib/api";
import { retryPendingSheetsDeliveries, sheetsQueueStatus } from "@/lib/sheets-queue";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    return json(await sheetsQueueStatus());
  } catch (error) { return serverFailure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const auth = await authorize(request, true);
    if (auth.response) return auth.response;
    const result = await retryPendingSheetsDeliveries();
    return json({ ...await sheetsQueueStatus(), result });
  } catch (error) { return serverFailure(error); }
}
