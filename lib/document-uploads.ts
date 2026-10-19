export const supportingDocumentTypes = [
  { id: "diploma", label: "Diploma / education certificate" },
  { id: "nc2", label: "NC2 certificate" },
  { id: "nbi", label: "NBI clearance / apostille" },
  { id: "form18a", label: "Form 18a" },
  { id: "other", label: "Other supporting document" },
  { id: "driver-license", label: "Driver’s license copy" },
  { id: "passport", label: "Valid passport copy" },
  { id: "residence-id", label: "Residence ID (front & back)" },
  { id: "employment-certificate", label: "Certificate of employment" },
] as const;
export type SupportingDocumentCategory = (typeof supportingDocumentTypes)[number]["id"];
export const MAX_SUPPORTING_DOCUMENT_BYTES = 3 * 1024 * 1024;
export const MAX_APPLICATION_UPLOAD_BYTES = 15 * 1024 * 1024;
export const SUPPORTING_DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png";
export const MAX_REFERENCE_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_REFERENCE_UPLOAD_BYTES = 4 * 1024 * 1024;
export const referenceApplicationUploads = [
  { id: "resume", label: "Please upload your CV", description: "Maximum one file. Please make sure your CV is updated.", required: true, accept: ".pdf,.doc,.docx" },
  { id: "passport", label: "Please upload a copy of your valid passport", description: "A clear copy of your passport, valid for at least 2 years.", required: true, accept: SUPPORTING_DOCUMENT_ACCEPT },
  { id: "residence-id", label: "Please upload your updated and valid residence ID (front & back)", description: "Combine the front and back in one file. Both sides must be readable.", required: true, accept: SUPPORTING_DOCUMENT_ACCEPT },
  { id: "diploma", label: "Please upload your high school diploma", description: "Needed for the work permit application. Upload your high school diploma now if available.", required: false, accept: SUPPORTING_DOCUMENT_ACCEPT },
  { id: "nc2", label: "Please upload your valid NC2 certificate", description: "Needed for the work permit application. Check the position guide above and upload your certificate if available.", required: false, accept: SUPPORTING_DOCUMENT_ACCEPT },
  { id: "nbi", label: "Please upload your NBI clearance with apostille", description: "Needed for the work permit application. Combine your NBI clearance and apostille in one file, if available.", required: false, accept: SUPPORTING_DOCUMENT_ACCEPT },
  { id: "form18a", label: "Please upload your Form 18a", description: "Needed for the work permit application. Upload your completed Form 18a if available.", required: false, accept: SUPPORTING_DOCUMENT_ACCEPT },
  { id: "employment-certificate", label: "Please upload your certificate of employment(s)", description: "A certificate of employment or employment contract showing your experience.", required: false, accept: SUPPORTING_DOCUMENT_ACCEPT },
  { id: "driver-license", label: "Please upload your driver’s license(s) from the Philippines (front & back)", description: "Combine the front and back in one file, if available.", required: false, accept: SUPPORTING_DOCUMENT_ACCEPT },
] as const;
export type ReferenceUploadId = (typeof referenceApplicationUploads)[number]["id"];
export function documentLabel(category: string) {
  return supportingDocumentTypes.find((item) => item.id === category)?.label || "Supporting document";
}
