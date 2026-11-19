import { z } from "zod";

/** Shared by the browser form and the server. Keep free of Node-only imports. */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MIN_VIDEO_SECONDS = 60;
/** Google resumable uploads require parts in multiples of 256 KiB. */
export const VIDEO_CHUNK_BYTES = 8 * 1024 * 1024;
export const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,video/3gpp,video/x-m4v,.mp4,.mov,.m4v,.webm,.3gp";

const videoTypes: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp",
};

/** Browsers sometimes report an empty or generic type, so the extension decides. */
export function videoMimeType(name: string): string | undefined {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase();
  return extension ? videoTypes[extension] : undefined;
}

const text = (label: string, max: number) => z.string().trim()
  .min(2, `Enter your ${label}.`).max(max, `Keep your ${label} within ${max} characters.`)
  .refine((value) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), `Remove unsupported characters from your ${label}.`);
const phone = (label: string) => z.string().trim()
  .max(30, `Keep your ${label} within 30 characters.`)
  .refine((value) => /^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 7,
    `Enter your ${label} with the country code, for example +63 912 345 6789.`);
// A blank box must not silently become 0.
const wholeNumber = (message: string, min: number, max: number) => z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? undefined : value,
  z.coerce.number({ error: message }).int(message).min(min, message).max(max, message));

export const videoApplicationSchema = z.object({
  fullName: text("complete name", 120),
  age: wholeNumber("Enter your age in years (18–65).", 18, 65),
  nationality: text("nationality", 60),
  jobId: z.string().trim().min(1, "Select the position you are applying for.").max(100),
  experienceYears: wholeNumber("Enter your total years of experience for this position (0–50).", 0, 50),
  whatsapp: phone("WhatsApp number"),
  telegram: phone("Telegram number"),
  consent: z.literal(true, { error: "Agree to the terms and privacy policy to continue." }),
}).strict();

export type VideoApplicationInput = z.input<typeof videoApplicationSchema>;
export type VideoApplicationDetails = z.output<typeof videoApplicationSchema>;

export const videoFileSchema = z.object({
  name: z.string().min(1).max(200).refine((value) => !/[\\/\x00-\x1f\x7f]/.test(value) && Boolean(videoMimeType(value)),
    "Choose an MP4, MOV, M4V, WEBM or 3GP video."),
  size: z.number().int().min(1, "Choose a video that is not empty.").max(MAX_VIDEO_BYTES, "Choose a video no larger than 100 MB."),
  durationSeconds: z.number().min(MIN_VIDEO_SECONDS, "Your video must be at least one minute long.").max(24 * 60 * 60).nullable(),
}).strict();

export type VideoFileInput = z.infer<typeof videoFileSchema>;

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PHOTO_ACCEPT = "image/jpeg,image/png,.jpg,.jpeg,.png";
const photoTypes: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

export function photoMimeType(name: string): string | undefined {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase();
  return extension ? photoTypes[extension] : undefined;
}

export const photoFileSchema = z.object({
  name: z.string().min(1).max(200).refine((value) => !/[\\/\x00-\x1f\x7f]/.test(value) && Boolean(photoMimeType(value)),
    "Choose a JPG or PNG photo."),
  size: z.number().int().min(1, "Choose a photo that is not empty.").max(MAX_PHOTO_BYTES, "Choose a photo no larger than 10 MB."),
}).strict();

export type PhotoFileInput = z.infer<typeof photoFileSchema>;

export const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
