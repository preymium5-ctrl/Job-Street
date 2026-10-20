import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { failure, json, limitedFormData, serverFailure } from "@/lib/api";
import {
  rateLimit,
  requireApplicationConfiguration,
  sameOrigin,
} from "@/lib/auth";
import {
  createApplication,
  findApplicationByKey,
  getJobById,
} from "@/lib/repository";
import { applicationSchema, fieldErrors } from "@/lib/validation";
import {
  deleteObject,
  requireStorageConfiguration,
  storeResume,
  UploadError,
  validateResume,
  validateSupportingDocument,
  storeSupportingDocument,
} from "@/lib/storage";
import type { Application } from "@/lib/types";
import { getJobFairRole } from "@/data/job-fair";
import { drainSheetsQueue } from "@/lib/sheets-queue";
import { getReferenceApplicationUploads, MAX_APPLICATION_UPLOAD_BYTES, MAX_REFERENCE_FILE_BYTES, MAX_REFERENCE_UPLOAD_BYTES, supportingDocumentTypes } from "@/lib/document-uploads";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const stagedKeys: string[] = [];
  try {
    if (!sameOrigin(request))
      return failure("Submit your application from this website.", 403);
    if (!(await rateLimit(request, "application", 20, 3600)))
      return failure("Too many attempts. Please try again in an hour.", 429);
    requireStorageConfiguration();
    await requireApplicationConfiguration();
    const form = await limitedFormData(request, MAX_APPLICATION_UPLOAD_BYTES + 1024 * 1024);
    if (String(form.get("website") || "").trim())
      return failure("The application could not be accepted.", 400);
    const key = String(form.get("idempotencyKey") || "").toLowerCase();
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        key,
      )
    )
      return failure("Refresh the form and try again.");
    const payload = form.get("payload");
    if (typeof payload !== "string" || payload.length > 30000)
      return failure("The application details are invalid.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return failure("The application details are invalid.");
    }
    const result = applicationSchema.safeParse(parsed);
    if (!result.success)
      return failure("Check the highlighted application details.", 422, {
        fieldErrors: fieldErrors(result.error),
      });
    const referenceForm = result.data.applicationFormVersion === 2;
    // Document requirements use the stored position title, never a client-supplied role.
    const job = await getJobById(result.data.jobId);
    const referenceUploads = getReferenceApplicationUploads({
      country: result.data.country,
      destinationCountry: result.data.destinationCountry,
      jobTitle: job?.title,
    });
    const maximumUploadBytes = referenceForm ? MAX_REFERENCE_UPLOAD_BYTES : MAX_APPLICATION_UPLOAD_BYTES;
    const combinedLimitMessage = `Keep all uploads together within ${referenceForm ? 4 : 15} MB.`;
    const referenceCategories = new Set<string>(referenceUploads.map(({ id }) => id));
    const documentTypes = supportingDocumentTypes.filter(({ id }) => !referenceForm || referenceCategories.has(id));
    if (referenceForm) {
      if (form.has("document:other"))
        return failure("Choose a document category listed in this form.", 422, { fieldErrors: { documents: "Other supporting documents are not collected by this form." } });
    }
    const file = form.get("resume");
    if (!(file instanceof File))
      return failure("Attach your resume.", 422, {
        fieldErrors: { resume: "Attach a PDF, DOC, or DOCX resume." },
      });
    if (referenceForm && file.size > MAX_REFERENCE_FILE_BYTES)
      return failure("Your CV must be 3 MB or smaller.", 422, { fieldErrors: { resume: "Your CV must be 3 MB or smaller." } });
    const resume = await validateResume(file);
    const documents: { category: (typeof supportingDocumentTypes)[number]["id"]; document: Awaited<ReturnType<typeof validateSupportingDocument>> }[] = [];
    let uploadBytes = file.size;
    const allowedFileFields = new Set(["resume", ...documentTypes.map(({ id }) => `document:${id}`)]);
    for (const [field, item] of form.entries()) {
      if (item instanceof File && !allowedFileFields.has(field))
        return failure("Choose a supported document category.", 422, { fieldErrors: { documents: "Choose a supported document category." } });
    }
    if (form.getAll("resume").length !== 1) return failure("Attach one CV only.", 422);
    for (const { id } of documentTypes) {
      const files = form.getAll(`document:${id}`);
      if (files.length > 1 || files.some((item) => !(item instanceof File)))
        return failure("Attach one file per document category.", 422, { fieldErrors: { [referenceForm ? `document:${id}` : "documents"]: "Attach one file per document category." } });
      const attachment = files[0];
      if (attachment instanceof File) {
        uploadBytes += attachment.size;
        if (uploadBytes > maximumUploadBytes) return failure(combinedLimitMessage, 422, { fieldErrors: { documents: combinedLimitMessage } });
        try { documents.push({ category: id, document: await validateSupportingDocument(attachment) }); }
        catch (error) {
          if (error instanceof UploadError) return failure(error.message, 422, { fieldErrors: { [referenceForm ? `document:${id}` : "documents"]: error.message } });
          throw error;
        }
      }
    }
    if (resume.bytes.length + documents.reduce((sum, item) => sum + item.document.bytes.length, 0) > maximumUploadBytes)
      return failure(combinedLimitMessage, 422, { fieldErrors: { documents: combinedLimitMessage } });
    const requestDigest = createHash("sha256")
      .update(JSON.stringify(result.data))
      .update(resume.bytes);
    for (const { category, document } of documents) requestDigest.update(JSON.stringify({ category, name: document.name, mime: document.mime, size: document.bytes.length })).update(document.bytes);
    const requestHash = requestDigest.digest("hex");
    const existing = await findApplicationByKey(key);
    if (existing) {
      if (existing.requestHash !== requestHash)
        return failure(
          "This submission ID was already used. Refresh the form before sending a different application.",
          409,
        );
      return json({
        reference: existing.data.reference,
        jobTitle: existing.data.jobTitle,
      });
    }
    // An exact retry keeps its original receipt even if staff have since changed the role.
    if (referenceForm) {
      const missingUploads: Record<string, string> = {};
      for (const upload of referenceUploads) {
        const field = upload.id === "resume" ? "resume" : `document:${upload.id}`;
        if (upload.required && !(form.get(field) instanceof File)) missingUploads[field] = `${upload.label}.`;
      }
      if (Object.keys(missingUploads).length)
        return failure("Attach the required application documents.", 422, { fieldErrors: missingUploads });
    }
    if (
      !(await rateLimit(
        request,
        "application-email",
        3,
        3600,
        result.data.email,
      ))
    )
      return failure(
        "You have submitted several applications recently. Please try again in an hour.",
        429,
      );
    if (!job || job.status !== "published")
      return failure("This position is no longer accepting applications.", 409);
    const fairRole = getJobFairRole(job);
    if (!referenceForm && (result.data.driverLicenseDetails || documents.some(({ category }) => category === "driver-license")) && !fairRole?.drivingLicenseIsPlus)
      return failure("Driver’s license details are not collected for this position.", 422, {
        fieldErrors: { driverLicenseDetails: "Remove the license details and attachment for this position." },
      });
    if (result.data.preferredEmployer && !fairRole?.employers.some((employer) => employer.name === result.data.preferredEmployer))
      return failure("Choose an employer listed for this position.", 422, {
        fieldErrors: { preferredEmployer: "Choose an employer listed for this position, or no preference." },
      });
    const resumeKey = await storeResume(resume);
    stagedKeys.push(resumeKey);
    const storedDocuments: NonNullable<Application["documents"]> = [];
    for (const { category, document } of documents) {
      const key = await storeSupportingDocument(document);
      stagedKeys.push(key);
      storedDocuments.push({ id: randomUUID(), category, key, name: document.name, mime: document.mime, size: document.bytes.length });
    }
    const date = new Date();
    const reference = `CH-${date.toISOString().slice(2, 7).replace("-", "")}-${randomBytes(8).toString("hex").toUpperCase()}`;
    const application: Application = {
      ...result.data,
      id: randomUUID(),
      reference,
      jobTitle: job.title,
      status: "New",
      submittedAt: date.toISOString(),
      resumeName: resume.name,
      resumeKey,
      resumeMime: resume.mime,
      ...(storedDocuments.length ? { documents: storedDocuments } : {}),
      isExample: job.isExample,
    };
    const persisted = await createApplication(application, key, requestHash);
    if (!persisted.created) {
      await Promise.all(stagedKeys.map(deleteObject));
      stagedKeys.length = 0;
      if (persisted.requestHash !== requestHash)
        return failure(
          "This submission ID was already used. Refresh the form.",
          409,
        );
    } else stagedKeys.length = 0; // The persisted application owns these objects now.
    // Google downtime must not turn an already committed application into a failed submission.
    // The outbox owns retries even if this request or this Node process ends unexpectedly.
    await drainSheetsQueue({ applicationId: persisted.application.id, limit: 1, timeoutMs: 20_000 }).catch(() => {
      console.error("Chapter Google Sheets delivery remains queued.");
    });
    return json(
      {
        reference: persisted.application.reference,
        jobTitle: persisted.application.jobTitle,
      },
      persisted.created ? 201 : 200,
    );
  } catch (error) {
    await Promise.all(stagedKeys.map((key) => deleteObject(key).catch(() => console.error("Orphan application upload cleanup failed."))));
    if (error instanceof UploadError)
      return failure(error.message, 422, {
        fieldErrors: { resume: error.message },
      });
    if (error instanceof Error && error.message === "BODY_TOO_LARGE")
      return failure(
        "The upload is too large. Keep all files together within 15 MB.",
        413,
      );
    if (error instanceof Error && error.message === "INVALID_MULTIPART")
      return failure("Use the website application form.", 400);
    if (error instanceof Error && error.message === "JOB_NOT_OPEN")
      return failure("This position is no longer accepting applications.", 409);
    if (error instanceof Error && error.message === "INVALID_EMPLOYER")
      return failure("Choose an employer listed for this position.", 422, {
        fieldErrors: { preferredEmployer: "Choose an employer listed for this position, or no preference." },
      });
    return serverFailure(error);
  }
}
