export const supportingDocumentTypes = [
  { id: "diploma", label: "Diploma / education certificate" },
  { id: "nc2", label: "NC2 certificate" },
  { id: "nbi", label: "NBI clearance / apostille" },
  { id: "form18a", label: "Form 18a" },
  { id: "other", label: "Other supporting document" },
  { id: "driver-license", label: "Driver’s license copy" },
] as const;
export type SupportingDocumentCategory = (typeof supportingDocumentTypes)[number]["id"];
export const MAX_SUPPORTING_DOCUMENT_BYTES = 3 * 1024 * 1024;
export const MAX_APPLICATION_UPLOAD_BYTES = 15 * 1024 * 1024;
export const SUPPORTING_DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png";
export function documentLabel(category: string) {
  return supportingDocumentTypes.find((item) => item.id === category)?.label || "Supporting document";
}
