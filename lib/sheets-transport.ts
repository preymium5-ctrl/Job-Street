import { createHmac } from "node:crypto";
import type { Application } from "./types";
import type { SupportingDocumentCategory } from "./document-uploads";
import { getJobFairRole } from "../data/job-fair";
import type { Job } from "./types";

export const TARGET_SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || "";
export type SheetsErrorCode = "NOT_CONFIGURED" | "CONFIGURATION_INVALID" | "WEBHOOK_UNAVAILABLE" | "WEBHOOK_REJECTED" | "INVALID_ACKNOWLEDGEMENT" | "RESUME_UNAVAILABLE" | "INVALID_APPLICATION_PROFILE" | "UNSUPPORTED_RECEIVER" | "SUBMISSION_RATE_LIMIT" | "DUPLICATE_CONFLICT";
export class SheetsDeliveryError extends Error {
  constructor(public readonly code: SheetsErrorCode) { super(code); }
}
export interface SheetsDocument { id: string; category: SupportingDocumentCategory; name: string; mime: string; base64: string; }
const receiverDocumentCategories = new Set<SupportingDocumentCategory>(["diploma", "nc2", "nbi", "form18a", "other", "driver-license"]);

export interface ReceiverProfile {
  firstName: string;
  lastName: string;
  gender: "Male" | "Female";
  nationality?: string;
  address: string;
  street?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  dateOfBirth: string;
  placeOfBirth: string;
  destinationCountry: string;
  currentWorkCountry: string;
  secondaryJobTitle: string;
  otherJobTitle?: string;
  englishProficiency: "Yes" | "No";
  telegram?: string;
  fatherName?: string;
  motherName?: string;
  termsAccepted: boolean;
}
type ReceiverApplication = Pick<Application,
  "id" | "reference" | "jobId" | "jobTitle" | "fullName" | "email" | "phone" | "country" |
  "discoverySource" | "recentJobTitle" | "experienceYears" | "skills" | "education" | "summary" |
  "coverLetter" | "consent" | "nc2Certificate" | "driverLicenseDetails" | "documentReadiness" |
  "preferredEmployer" | "status" | "submittedAt"
>;
export interface SheetsPayload {
  version: 1 | 2 | 3;
  application: ReceiverApplication & {
    expectedNc2: string;
    employers: { name: string; workers: number }[];
    profile?: ReceiverProfile;
    applicationSource?: string;
    applicationFormVersion?: string;
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

function receiverProfile(application: Application): ReceiverProfile | undefined {
  if (application.applicationFormVersion !== 2) return undefined;
  const details = application.applicantDetails;
  if (!details || !application.destinationCountry || application.termsAccepted !== true ||
    (details.gender !== "Male" && details.gender !== "Female") || !details.secondaryPosition)
    throw new SheetsDeliveryError("INVALID_APPLICATION_PROFILE");
  return {
    firstName: details.firstName,
    lastName: details.lastName,
    gender: details.gender,
    address: details.currentAddress,
    dateOfBirth: details.dateOfBirth,
    placeOfBirth: details.placeOfBirth,
    destinationCountry: application.destinationCountry,
    currentWorkCountry: application.country,
    secondaryJobTitle: details.secondaryPosition,
    englishProficiency: details.englishProficiency,
    termsAccepted: application.termsAccepted,
    ...Object.fromEntries((["nationality", "street", "city", "province", "postalCode", "telegram", "fatherName", "motherName"] as const)
      .filter((key) => details[key] !== undefined).map((key) => [key, details[key]])),
    ...(details.otherPosition !== undefined ? { otherJobTitle: details.otherPosition } : {}),
  };
}

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
  const fair = job ? getJobFairRole(job) : undefined;
  const profile = receiverProfile(application);
  const expandedPayload = Boolean(profile || documents.some(({ category }) => !receiverDocumentCategories.has(category)));
  return {
    version: expandedPayload ? 3 : documents.length ? 2 : 1,
    ...(expandedPayload || documents.length ? { documents } : {}),
    application: {
      id: application.id,
      reference: application.reference,
      jobId: application.jobId,
      jobTitle: application.jobTitle,
      fullName: application.fullName,
      email: application.email,
      phone: application.phone,
      country: application.country,
      ...(profile ? { profile, applicationSource: "Jobstreet Croatia", applicationFormVersion: "jobstreet-croatia-v2" } : {}),
      ...(application.discoverySource !== undefined ? { discoverySource: application.discoverySource } : {}),
      recentJobTitle: application.applicationFormVersion === 2 && !application.recentJobTitle ? "Not collected by this form" : application.recentJobTitle,
      experienceYears: application.experienceYears,
      skills: application.applicationFormVersion === 2 && !application.skills ? "Not collected by this form" : application.skills,
      education: application.education,
      summary: application.summary,
      coverLetter: application.coverLetter,
      consent: application.consent,
      ...(application.driverLicenseDetails !== undefined ? { driverLicenseDetails: application.driverLicenseDetails } : {}),
      status: application.status,
      submittedAt: application.submittedAt,
      nc2Certificate: application.nc2Certificate || "",
      preferredEmployer: application.preferredEmployer || "",
      documentReadiness: application.documentReadiness || {
        nc2: "not-yet", diploma: "not-yet", nbi: "not-yet", form18a: "not-yet",
      },
      expectedNc2: fair?.nc2 || "",
      employers: fair?.employers.map(({ name, workers }) => ({ name, workers })) || [],
    },
    resume: { name: application.resumeName, mime: application.resumeMime, base64: resume.toString("base64") },
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

async function readSheetsJson(response: Response): Promise<unknown> {
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
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new SheetsDeliveryError("INVALID_ACKNOWLEDGEMENT"); }
}

async function readAcknowledgement(response: Response, payload: SheetsPayload): Promise<SheetsAcknowledgement> {
  const answer = await readSheetsJson(response) as Record<string, unknown> | null;
  if (answer?.ok === false && (answer.code === "SUBMISSION_RATE_LIMIT" || answer.code === "DUPLICATE_CONFLICT"))
    throw new SheetsDeliveryError(answer.code);
  if (!answer || answer.ok !== true || answer.applicationId !== payload.application.id || answer.reference !== payload.application.reference || typeof answer.row !== "number" || !Number.isSafeInteger(answer.row) || answer.row < 2 || typeof answer.duplicate !== "boolean")
    throw new SheetsDeliveryError("INVALID_ACKNOWLEDGEMENT");
  return { ok: true, applicationId: payload.application.id, reference: payload.application.reference,
    row: answer.row, duplicate: answer.duplicate };
}

async function fetchSheetsResponse(url: string, init: RequestInit) {
  let response = await fetch(url, { ...init, cache: "no-store", redirect: "manual" });
  // ContentService redirects both health GETs and signed POST acknowledgements.
  // Only a body-free GET may follow the single-use Google response URL.
  if ([302, 303].includes(response.status)) {
    const location = response.headers.get("location");
    let redirect: URL;
    try { redirect = new URL(location || ""); }
    catch { throw new SheetsDeliveryError("WEBHOOK_REJECTED"); }
    if (redirect.protocol !== "https:" || redirect.hostname !== "script.googleusercontent.com" || redirect.port || redirect.username || redirect.password || redirect.pathname !== "/macros/echo")
      throw new SheetsDeliveryError("WEBHOOK_REJECTED");
    await response.body?.cancel();
    response = await fetch(redirect, { method: "GET", signal: init.signal, redirect: "error", cache: "no-store" });
  }
  return response;
}

async function receiverCapabilities(url: string, signal: AbortSignal, requireExpandedProfile = false) {
  try {
    const response = await fetchSheetsResponse(url, {
      method: "GET", signal: AbortSignal.any([signal, AbortSignal.timeout(requireExpandedProfile ? 20_000 : 3000)]),
    });
    const health = await readSheetsJson(response) as Record<string, unknown> | null;
    const discoverySource = health?.ok === true && health.service === "chapter-applications" && health.version === 1 &&
      Number.isSafeInteger(health.schemaVersion) && (health.schemaVersion as number) >= 4 &&
      Number.isSafeInteger(health.columns) && (health.columns as number) >= 30;
    // Accept the staged 35-to-36-column upgrade and the original 54-column
    // layout. Never downgrade a complete application to a partial delivery.
    const expandedProfile = discoverySource && (health!.schemaVersion as number) >= 6 &&
      (health!.columns === 35 || health!.columns === 36 || health!.columns === 54);
    return { discoverySource, expandedProfile };
  } catch {
    // Existing legacy deliveries can continue; full-profile delivery must wait.
    return { discoverySource: false, expandedProfile: false };
  }
}

export const sendApplicationToSheets: SheetsTransport = async (payload, options) => {
  const config = sheetsConfiguration();
  if (!config.valid) throw new SheetsDeliveryError(config.code!);
  const signal = AbortSignal.timeout(Math.min(120_000, Math.max(1000, options?.timeoutMs ?? 120_000)));
  try {
    const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL!;
    const { discoverySource, ...legacyApplication } = payload.application;
    const capabilities = payload.version === 3 || discoverySource ? await receiverCapabilities(url, signal, payload.version === 3) : undefined;
    if (payload.version === 3 && !capabilities?.expandedProfile) throw new SheetsDeliveryError("UNSUPPORTED_RECEIVER");
    // Keep the answer in the stored application and full payload. Only the signed
    // outbound copy is filtered until the deployed receiver advertises column AD.
    const outbound = capabilities?.discoverySource && discoverySource
      ? payload : { ...payload, application: legacyApplication };
    const response = await fetchSheetsResponse(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: signedSheetsBody(outbound, process.env.GOOGLE_SHEETS_WEBHOOK_SECRET!),
      signal,
    });
    return await readAcknowledgement(response, payload);
  } catch (error) {
    if (error instanceof SheetsDeliveryError) throw error;
    throw new SheetsDeliveryError("WEBHOOK_UNAVAILABLE");
  }
};
