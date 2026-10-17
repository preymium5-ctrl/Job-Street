import { createHmac } from "node:crypto";
import type { Application } from "./types";
import type { SupportingDocumentCategory } from "./document-uploads";
import { getJobFairRole } from "../data/job-fair";
import type { Job } from "./types";

export const TARGET_SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || "";
export type SheetsErrorCode = "NOT_CONFIGURED" | "CONFIGURATION_INVALID" | "WEBHOOK_UNAVAILABLE" | "WEBHOOK_REJECTED" | "INVALID_ACKNOWLEDGEMENT" | "RESUME_UNAVAILABLE";
export class SheetsDeliveryError extends Error {
  constructor(public readonly code: SheetsErrorCode) { super(code); }
}
export interface SheetsDocument { id: string; category: SupportingDocumentCategory; name: string; mime: string; base64: string; }
export interface SheetsPayload {
  version: 1 | 2;
  application: Omit<Application, "resumeKey" | "resumeName" | "resumeMime" | "isExample" | "documents"> & {
    expectedNc2: string;
    employers: { name: string; workers: number }[];
  };
  resume: { name: string; mime: string; base64: string };
  documents?: SheetsDocument[];
}
export interface SheetsAcknowledgement {
  ok: true;
  applicationId: string;
  reference: string;
  row: number;
  duplicate: boolean;
}
export type SheetsTransport = (payload: SheetsPayload, options?: { timeoutMs?: number }) => Promise<SheetsAcknowledgement>;

export function sheetsConfiguration(env: Record<string, string | undefined> = process.env): {
  configured: boolean;
  valid: boolean;
  code?: SheetsErrorCode;
} {
  const url = env.GOOGLE_SHEETS_WEBHOOK_URL;
  const secret = env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  if (!url && !secret) return { configured: false, valid: false, code: "NOT_CONFIGURED" };
  try {
    const parsed = new URL(url || "");
    if (parsed.protocol !== "https:" || parsed.hostname !== "script.google.com" || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || !/^\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(parsed.pathname) || Buffer.byteLength(secret || "") < 32)
      throw new Error("Invalid configuration");
    return { configured: true, valid: true };
  } catch {
    return { configured: true, valid: false, code: "CONFIGURATION_INVALID" };
  }
}

export function buildSheetsPayload(application: Application, resume: Buffer, job?: Job, documents: SheetsDocument[] = []): SheetsPayload {
  const { resumeKey: _key, resumeName, resumeMime, isExample: _example, documents: _documents, ...details } = application;
  void _documents;
  void _key;
  void _example;
  const fair = job ? getJobFairRole(job) : undefined;
  return {
    version: documents.length ? 2 : 1,
    ...(documents.length ? { documents } : {}),
    application: {
      ...details,
      nc2Certificate: details.nc2Certificate || "",
      preferredEmployer: details.preferredEmployer || "",
      documentReadiness: details.documentReadiness || {
        nc2: "not-yet", diploma: "not-yet", nbi: "not-yet", form18a: "not-yet",
      },
      expectedNc2: fair?.nc2 || "",
      employers: fair?.employers.map(({ name, workers }) => ({ name, workers })) || [],
    },
    resume: { name: resumeName, mime: resumeMime, base64: resume.toString("base64") },
  };
}

export function signedSheetsBody(payload: SheetsPayload, secret: string, timestamp = Date.now()) {
  const serialized = JSON.stringify(payload);
  return JSON.stringify({
    timestamp,
    payload: serialized,
    signature: createHmac("sha256", secret).update(`${timestamp}.${serialized}`).digest("hex"),
  });
}

async function readAcknowledgement(response: Response, payload: SheetsPayload) {
  if (!response.ok) throw new SheetsDeliveryError("WEBHOOK_REJECTED");
  const reader = response.body?.getReader();
  if (!reader) throw new SheetsDeliveryError("INVALID_ACKNOWLEDGEMENT");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    length += item.value.byteLength;
    if (length > 16 * 1024) {
      await reader.cancel();
      throw new SheetsDeliveryError("INVALID_ACKNOWLEDGEMENT");
    }
    chunks.push(item.value);
  }
  let answer: Partial<SheetsAcknowledgement>;
  try { answer = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new SheetsDeliveryError("INVALID_ACKNOWLEDGEMENT"); }
  if (!answer || answer.ok !== true || answer.applicationId !== payload.application.id || answer.reference !== payload.application.reference || !Number.isSafeInteger(answer.row) || (answer.row || 0) < 2 || typeof answer.duplicate !== "boolean")
    throw new SheetsDeliveryError("INVALID_ACKNOWLEDGEMENT");
  return answer as SheetsAcknowledgement;
}

export const sendApplicationToSheets: SheetsTransport = async (payload, options) => {
  const config = sheetsConfiguration();
  if (!config.valid) throw new SheetsDeliveryError(config.code!);
  const signal = AbortSignal.timeout(Math.min(120_000, Math.max(1000, options?.timeoutMs ?? 120_000)));
  try {
    let response = await fetch(process.env.GOOGLE_SHEETS_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: signedSheetsBody(payload, process.env.GOOGLE_SHEETS_WEBHOOK_SECRET!),
      signal,
      cache: "no-store",
      redirect: "manual",
    });
    // Apps Script's ContentService redirects the response to a single-use Google URL.
    // Only the signed POST goes to the configured endpoint; never forward its body elsewhere.
    if ([302, 303].includes(response.status)) {
      const location = response.headers.get("location");
      let redirect: URL;
      try { redirect = new URL(location || ""); }
      catch { throw new SheetsDeliveryError("WEBHOOK_REJECTED"); }
      if (redirect.protocol !== "https:" || redirect.hostname !== "script.googleusercontent.com" || redirect.port || redirect.username || redirect.password || redirect.pathname !== "/macros/echo")
        throw new SheetsDeliveryError("WEBHOOK_REJECTED");
      await response.body?.cancel();
      response = await fetch(redirect, { method: "GET", signal, redirect: "error", cache: "no-store" });
    }
    return await readAcknowledgement(response, payload);
  } catch (error) {
    if (error instanceof SheetsDeliveryError) throw error;
    throw new SheetsDeliveryError("WEBHOOK_UNAVAILABLE");
  }
};
