import { createHmac } from "node:crypto";
import { buildSheetsPayload, sendApplicationToSheets, SheetsDeliveryError, type SheetsDocument, type SheetsTransport } from "./sheets-transport";
import type { ValidatedResume, validateSupportingDocument } from "./storage";
import type { SupportingDocumentCategory } from "./document-uploads";
import type { Application, ApplicationInput, Job } from "./types";

export function usesGoogleApplicationStorage() {
  return process.env.APPLICATION_STORAGE === "google-sheets";
}

type DocumentUpload = {
  category: SupportingDocumentCategory;
  document: Awaited<ReturnType<typeof validateSupportingDocument>>;
};

/** In this explicit mode, Google Sheets and private Drive own the durable record. */
export async function saveApplicationToGoogle(
  input: ApplicationInput,
  job: Job,
  submissionKey: string,
  requestHash: string,
  resume: ValidatedResume,
  uploads: DocumentUpload[],
  transport: SheetsTransport = sendApplicationToSheets,
) {
  // Retrying the same key reuses its record; a changed request changes the
  // reference, which the receiver rejects for an already stored application ID.
  const id = `gs-${submissionKey}`;
  const reference = `CH-${createHmac("sha256", process.env.GOOGLE_SHEETS_WEBHOOK_SECRET!)
    .update(`application-v1\0${submissionKey}\0${requestHash}`).digest("hex").slice(0, 24).toUpperCase()}`;
  const documents = uploads.map(({ category, document }) => ({
    id: `${id}-${category}`, category, name: document.name, mime: document.mime,
    key: "", size: document.bytes.length,
  }));
  const application: Application = {
    ...input, id, reference, jobTitle: job.title, status: "New", submittedAt: new Date().toISOString(),
    recentJobTitle: input.recentJobTitle || "", experienceYears: input.experienceYears || 0,
    skills: input.skills || "", education: input.education || "",
    summary: input.summary || "", coverLetter: input.coverLetter || "",
    resumeKey: "", resumeName: resume.name, resumeMime: resume.mime,
    ...(documents.length ? { documents } : {}), isExample: job.isExample,
  };
  const exported: SheetsDocument[] = uploads.map(({ category, document }, index) => ({
    id: documents[index].id, category, name: document.name, mime: document.mime,
    base64: document.bytes.toString("base64"),
  }));
  const payload = buildSheetsPayload(application, resume.bytes, job, exported);
  // This receiver namespace applies durable per-email and overall quotas.
  // Keep the specific website/form identity in its separate version field.
  payload.application.applicationSource = "Jobs in Croatia";
  payload.application.applicationFormVersion = "jobstreet-croatia-v2";
  const acknowledgement = await transport(payload, { timeoutMs: 100_000 });
  if (acknowledgement.ok !== true || acknowledgement.applicationId !== id || acknowledgement.reference !== reference ||
      !Number.isSafeInteger(acknowledgement.row) || acknowledgement.row < 2 || typeof acknowledgement.duplicate !== "boolean")
    throw new SheetsDeliveryError("INVALID_ACKNOWLEDGEMENT");
  return { reference, jobTitle: job.title, duplicate: acknowledgement.duplicate };
}
