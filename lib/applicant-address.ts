export function formatApplicantAddress(address?: {
  street?: string;
  city?: string;
  province?: string;
  postalCode?: string;
}): string {
  return [address?.street, address?.city, address?.province, address?.postalCode]
    .map((part) => part?.trim() || "")
    .filter(Boolean)
    .join(", ");
}
