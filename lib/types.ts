import type { SupportingDocumentCategory } from "./document-uploads";
export type JobStatus = "published" | "draft" | "closed";
export interface Job {
  id: string;
  slug: string;
  title: string;
  category: string;
  location: string;
  employmentType: string;
  summary: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  benefits: string[];
  experience: string;
  image: string;
  imageAlt: string;
  imagePosition?: string;
  postedAt: string;
  status: JobStatus;
  isExample: boolean;
  featured: boolean;
  salary?: string;
  salaryStatus?: "proposed-net";
  schedule?: string;
  contract?: string;
  openings?: number;
}
export const applicationStatuses = [
  "New",
  "Under Review",
  "Shortlisted",
  "Interview",
  "Selected",
  "Rejected",
] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];
export const documentStatuses = ["ready", "in-progress", "not-yet"] as const;
export type DocumentStatus = (typeof documentStatuses)[number];
export interface DocumentReadiness {
  nc2: DocumentStatus;
  diploma: DocumentStatus;
  nbi: DocumentStatus;
  form18a: DocumentStatus;
}
export const discoverySources = [
  "Facebook",
  "TikTok",
  "Instagram",
  "Reddit",
  "Threads",
  "X (Twitter)",
  "YouTube",
  "LinkedIn",
  "Google search",
  "Friend or family",
  "Other",
] as const;
export type DiscoverySource = (typeof discoverySources)[number];
export const applicantGenders = ["Male", "Female", "Prefer not to say"] as const;
export interface ApplicantDetails {
  firstName: string;
  lastName: string;
  nationality: string;
  currentAddress: string;
  street?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  dateOfBirth: string;
  placeOfBirth: string;
  englishProficiency: "Yes" | "No";
  gender?: (typeof applicantGenders)[number] | "";
  telegram?: string;
  fatherName?: string;
  motherName?: string;
  secondaryPosition?: string;
  otherPosition?: string;
}
export interface ApplicationInput {
  applicationFormVersion?: 2;
  destinationCountry?: "Croatia";
  termsAccepted?: boolean;
  jobId: string;
  fullName: string;
  email: string;
  phone: string;
  country: string;
  discoverySource?: DiscoverySource | "";
  applicantDetails?: ApplicantDetails;
  recentJobTitle?: string;
  experienceYears?: number;
  skills?: string;
  education?: string;
  summary?: string;
  coverLetter?: string;
  consent: boolean;
  nc2Certificate?: string;
  driverLicenseDetails?: string;
  documentReadiness?: DocumentReadiness;
  preferredEmployer?: string;
}
export interface ApplicationDocument {
  id: string;
  category: SupportingDocumentCategory;
  name: string;
  key: string;
  mime: string;
  size: number;
}
export interface Application extends ApplicationInput {
  recentJobTitle: string;
  experienceYears: number;
  skills: string;
  education: string;
  summary: string;
  coverLetter: string;
  id: string;
  reference: string;
  jobTitle: string;
  status: ApplicationStatus;
  submittedAt: string;
  resumeName: string;
  resumeKey: string;
  resumeMime: string;
  documents?: ApplicationDocument[];
  isExample: boolean;
}
