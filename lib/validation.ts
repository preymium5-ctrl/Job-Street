import { z } from "zod";
import { applicantGenders, applicationStatuses, discoverySources, documentStatuses } from "./types";
import { minimumExperienceYears } from "../data/employment";

const shortText = (maximum = 160) =>
  z.string().trim().min(2, "Enter at least 2 characters.").max(maximum);
const applicantDetailsSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name.").max(60),
  lastName: z.string().trim().min(1, "Enter your last name.").max(60),
  nationality: shortText(80),
  currentAddress: shortText(500),
  dateOfBirth: z.iso.date({ error: "Enter a valid date of birth." }).refine(
    (value) => value <= new Date().toISOString().slice(0, 10),
    "Date of birth cannot be in the future.",
  ),
  placeOfBirth: shortText(160),
  englishProficiency: z.enum(["Yes", "No"], { error: "Select Yes or No." }),
  gender: z.enum([...applicantGenders, ""], { error: "Select a listed gender option." }).optional(),
  telegram: z.string().trim().max(80).optional(),
  fatherName: z.string().trim().max(120).optional(),
  motherName: z.string().trim().max(120).optional(),
  secondaryPosition: z.string().trim().max(160).optional(),
  otherPosition: z.string().trim().max(160).optional(),
}).strict();
export const applicationSchema = z
  .object({
    jobId: z.string().trim().min(1).max(100),
    fullName: shortText(120),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid email address.")
      .max(254),
    phone: z
      .string()
      .trim()
      .min(7)
      .max(30)
      .regex(/^[+\d\s().-]+$/, "Enter a valid contact number.")
      .refine(
        (value) => value.replace(/\D/g, "").length >= 7,
        "Enter at least 7 digits.",
      ),
    country: shortText(80),
    discoverySource: z.enum([...discoverySources, ""], { error: "Choose an option from the list." }).optional(),
    applicantDetails: applicantDetailsSchema.optional(),
    recentJobTitle: shortText(160),
    experienceYears: z.number().min(minimumExperienceYears, "At least 3 years of relevant work experience is required.").max(60),
    skills: shortText(2000),
    education: z.string().trim().max(2000).default(""),
    summary: z.string().trim().max(4000).default(""),
    coverLetter: z.string().trim().max(6000).default(""),
    nc2Certificate: z.string().trim().max(200).default(""),
    driverLicenseDetails: z.string().trim().max(200).optional(),
    preferredEmployer: z.string().trim().max(160).default(""),
    documentReadiness: z.object({
      nc2: z.enum(documentStatuses),
      diploma: z.enum(documentStatuses),
      nbi: z.enum(documentStatuses),
      form18a: z.enum(documentStatuses),
    }).strict().optional(),
    consent: z.literal(true, {
      error: "Acknowledge the privacy notice to submit.",
    }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.applicantDetails) {
      const combinedName = `${value.applicantDetails.firstName} ${value.applicantDetails.lastName}`;
      if (combinedName.length > 120)
        context.addIssue({ code: "custom", path: ["applicantDetails", "firstName"], message: "Keep your first and last names together within 120 characters." });
      else if (value.fullName !== combinedName)
        context.addIssue({ code: "custom", path: ["applicantDetails", "firstName"], message: "Your full name must match your first and last names." });
    }
    if (value.documentReadiness?.nc2 === "ready" && value.nc2Certificate.length < 2)
      context.addIssue({ code: "custom", path: ["nc2Certificate"], message: "Enter the name or category of your NC2 certificate." });
  });
const imageSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    if (/^\/images\/[a-zA-Z0-9_./-]+$/.test(value) && !value.includes(".."))
      return true;
    if (/^\/api\/images\/[a-f0-9-]+\.jpg$/.test(value)) return true;
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" && url.hostname === "images.unsplash.com"
      );
    } catch {
      return false;
    }
  }, "Use a local image, uploaded image, or an Unsplash HTTPS URL.");
const bulletList = z.array(shortText(1000)).min(1).max(30);
export const jobSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    slug: z
      .string()
      .min(2)
      .max(180)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Use lowercase words separated by hyphens.",
      ),
    title: shortText(160),
    category: shortText(100),
    location: shortText(160),
    employmentType: shortText(100),
    summary: shortText(800),
    description: shortText(15000),
    responsibilities: bulletList,
    requirements: bulletList,
    benefits: z.array(shortText(1000)).max(30),
    experience: shortText(300),
    image: imageSchema,
    imageAlt: shortText(300),
    imagePosition: z
      .string()
      .max(80)
      .regex(
        /^(?:center|top|bottom|left|right|\d{1,3}%)(?: (?:center|top|bottom|left|right|\d{1,3}%))?$/,
      )
      .optional(),
    postedAt: z
      .string()
      .refine(
        (value) =>
          /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
          Number.isFinite(Date.parse(value)),
        "Enter a valid date.",
      ),
    status: z.enum(["published", "draft", "closed"]),
    isExample: z.boolean(),
    featured: z.boolean(),
    salary: z.string().trim().max(300).optional(),
    salaryStatus: z.literal("proposed-net").optional(),
    schedule: z.string().trim().max(300).optional(),
    contract: z.string().trim().max(300).optional(),
    openings: z.number().int().min(1).max(10000).optional(),
  })
  .strict();
export const statusSchema = z
  .object({ status: z.enum(applicationStatuses) })
  .strict();
export function fieldErrors(error: z.ZodError) {
  return Object.fromEntries(
    error.issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}
