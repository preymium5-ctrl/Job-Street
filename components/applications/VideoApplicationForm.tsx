"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Camera, CheckCircle2, FileText, LockKeyhole, Video } from "lucide-react";
import type { Job } from "@/lib/types";
import { isAdditionalApplicationJob } from "@/data/application-jobs";
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES, MIN_VIDEO_SECONDS, PHOTO_ACCEPT, photoMimeType, VIDEO_ACCEPT, videoApplicationSchema, videoMimeType } from "@/lib/video-application";
import { readVideoDuration, uploadVideo, VideoUploadError } from "@/lib/video-upload-client";
import { fieldErrors } from "@/lib/validation";
import { BrandLockup } from "@/components/ui/Brand";
import { TelegramIcon, WhatsAppIcon } from "@/components/ui/ContactIcons";
import { RecruitmentAdvisory } from "@/components/layout/RecruitmentAdvisory";
import { ApplicationUpload } from "./ApplicationUpload";
import styles from "./ApplicationForm.module.css";

type Values = {
  fullName: string; age: string; nationality: string; jobId: string; experienceYears: string;
  whatsapp: string; telegram: string; consent: boolean;
};
type Field = keyof Values | "video" | "photo";
type Errors = Partial<Record<Field, string>>;
type Upload = { fileKey: string; sessionId: string; uploadUrl: string; photoUploadUrl: string; uploaded: boolean; photoUploaded: boolean };

const empty: Values = { fullName: "", age: "", nationality: "", jobId: "", experienceYears: "", whatsapp: "", telegram: "", consent: false };
const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
const formatLength = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")} min`;

function photoProblem(file: File | undefined): string | undefined {
  if (!file) return "Attach a clear, recent photo of yourself.";
  if (!file.size) return "Choose a photo that is not empty.";
  if (!photoMimeType(file.name)) return "Choose a JPG or PNG photo.";
  if (file.size > MAX_PHOTO_BYTES) return `This photo is ${(file.size / 1024 / 1024).toFixed(1)} MB. Choose a photo no larger than 10 MB.`;
}

function videoProblem(file: File | undefined, duration: number | null | undefined): string | undefined {
  if (!file) return "Attach a video of at least one minute showing you doing the actual work.";
  if (!file.size) return "Choose a video that is not empty.";
  if (!videoMimeType(file.name)) return "Choose an MP4, MOV, M4V, WEBM or 3GP video.";
  if (file.size > MAX_VIDEO_BYTES) return `This video is ${(file.size / 1024 / 1024).toFixed(1)} MB. Choose a video no larger than 100 MB.`;
  if (typeof duration === "number" && duration < MIN_VIDEO_SECONDS)
    return `This video is only ${Math.round(duration)} seconds long. Record at least one minute of yourself doing the actual work.`;
}

export default function VideoApplicationForm({ jobs }: { jobs: Job[] }) {
  const [values, setValues] = useState<Values>(empty);
  const [file, setFile] = useState<File>();
  const [duration, setDuration] = useState<number | null>();
  const [photo, setPhoto] = useState<File>();
  const [photoPreview, setPhotoPreview] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"uploading" | "confirming">("uploading");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ reference: string; jobTitle: string } | null>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const [website, setWebsite] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const uploadRef = useRef<Upload | null>(null);
  const submittingRef = useRef(false);
  const fileRef = useRef<File | undefined>(undefined);

  useEffect(() => {
    if (!photo || photoProblem(photo)) { setPhotoPreview(""); return; }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function choosePhoto(next?: File) {
    uploadRef.current = null;
    setPhoto(next);
    setErrors((current) => ({ ...current, photo: next ? photoProblem(next) : undefined }));
  }

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function chooseFile(next?: File) {
    fileRef.current = next;
    setFile(next);
    setDuration(undefined);
    setErrors((current) => ({ ...current, video: next ? videoProblem(next, undefined) : undefined }));
    if (!next || videoProblem(next, undefined)) return;
    const length = await readVideoDuration(next);
    // Ignore a slow metadata read for a file the applicant has already replaced.
    if (fileRef.current !== next) return;
    setDuration(length);
    setErrors((current) => ({ ...current, video: videoProblem(next, length) }));
  }

  function details() {
    return { ...values, age: values.age.trim(), experienceYears: values.experienceYears.trim() };
  }

  function validate(length: number | null | undefined): Errors {
    const parsed = videoApplicationSchema.safeParse(details());
    const next: Errors = parsed.success ? {} : fieldErrors(parsed.error) as Errors;
    const problem = videoProblem(file, length);
    if (problem) next.video = problem;
    const photoIssue = photoProblem(photo);
    if (photoIssue) next.photo = photoIssue;
    return next;
  }

  function showErrors(next: Errors) {
    setErrors(next);
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
  }

  async function api(body: Record<string, unknown>) {
    const response = await fetch("/api/video-applications", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, website }),
    });
    let answer: { error?: string; code?: string; fieldErrors?: Errors; sessionId?: string; uploadUrl?: string; photoUploadUrl?: string; reference?: string; jobTitle?: string } = {};
    try { answer = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      if (answer.fieldErrors) showErrors(answer.fieldErrors);
      if (answer.code === "NOT_FOUND" || answer.code === "CONFLICT") uploadRef.current = null;
      throw new Error(answer.error || "We couldn’t submit your application. Please try again.");
    }
    return answer;
  }

  async function submit() {
    if (submittingRef.current) return;
    let length = duration;
    // The length check normally finishes on selection; wait for it if Submit is faster.
    if (file && length === undefined && !videoProblem(file, undefined)) {
      length = await readVideoDuration(file);
      if (fileRef.current === file) setDuration(length);
    }
    const next = validate(length);
    if (Object.keys(next).length) { showErrors(next); return; }
    if (!file || !photo) return;
    submittingRef.current = true; setBusy(true); setError("");
    const video = { name: file.name, size: file.size, durationSeconds: length ?? null };
    const photoInfo = { name: photo.name, size: photo.size };
    const filesKey = `${fileKey(file)}|${fileKey(photo)}`;
    const totalBytes = photo.size + file.size;
    try {
      if (uploadRef.current?.fileKey !== filesKey) {
        setStage("uploading"); setProgress(0);
        const started = await api({ action: "start", details: details(), video, photo: photoInfo });
        if (!started.sessionId || !started.uploadUrl || !started.photoUploadUrl) throw new Error("We couldn’t start your upload. Please try again.");
        uploadRef.current = { fileKey: filesKey, sessionId: started.sessionId, uploadUrl: started.uploadUrl,
          photoUploadUrl: started.photoUploadUrl, uploaded: false, photoUploaded: false };
      }
      const upload = uploadRef.current!;
      setStage("uploading");
      try {
        // The small photo goes first; one progress bar covers both files.
        if (!upload.photoUploaded) {
          await uploadVideo(upload.photoUploadUrl, photo, (percent) => setProgress(Math.floor((percent / 100) * photo.size / totalBytes * 100)));
          upload.photoUploaded = true;
        }
        if (!upload.uploaded) {
          await uploadVideo(upload.uploadUrl, file, (percent) => setProgress(Math.floor((photo.size + (percent / 100) * file.size) / totalBytes * 100)));
          upload.uploaded = true;
        }
      } catch (uploadError) {
        if (uploadError instanceof VideoUploadError && uploadError.expired) uploadRef.current = null;
        throw uploadError;
      }
      setStage("confirming");
      const saved = await api({ action: "complete", sessionId: upload.sessionId, details: details(), video, photo: photoInfo });
      if (!saved.reference || !saved.jobTitle) throw new Error("We couldn’t confirm your application. Select Submit to try again.");
      setResult({ reference: saved.reference, jobTitle: saved.jobTitle });
      uploadRef.current = null;
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We couldn’t submit your application. Please try again.");
    } finally {
      setBusy(false); submittingRef.current = false;
    }
  }

  function input(key: Exclude<keyof Values, "consent" | "jobId">, label: string, options: {
    type?: string; placeholder?: string; autoComplete?: string; help?: string; icon?: ReactNode; inputMode?: "numeric" | "tel"; min?: number; max?: number; maxLength?: number;
  } = {}) {
    const describedBy = [options.help ? `${key}-help` : undefined, errors[key] ? `${key}-error` : undefined].filter(Boolean).join(" ") || undefined;
    return <div className={styles.field}>
      <label htmlFor={key}>{options.icon}{label}<span aria-label="required">*</span></label>
      <input id={key} name={key} type={options.type || "text"} value={values[key]} placeholder={options.placeholder}
        autoComplete={options.autoComplete} inputMode={options.inputMode} min={options.min} max={options.max} maxLength={options.maxLength}
        disabled={busy} required aria-required="true" aria-invalid={Boolean(errors[key])} aria-describedby={describedBy}
        onChange={(event) => update(key, event.target.value)} />
      {options.help && <p id={`${key}-help`} className={styles.formNote}>{options.help}</p>}
      {errors[key] && <p id={`${key}-error`} className={styles.fieldError}>{errors[key]}</p>}
    </div>;
  }

  const listed = jobs.filter((job) => !isAdditionalApplicationJob(job));
  const additional = jobs.filter(isAdditionalApplicationJob);

  return <div className={styles.page}><div className="container">
    <Link href="/" className={styles.back}><ArrowLeft size={16} /> Back to home</Link>
    <div className={styles.shell} role="region" aria-label="Video application">
      <header className={styles.masthead}>
        <div className={styles.mastheadBrand}><BrandLockup /></div>
        <p className={styles.mastheadLabel}>Video application form</p>
      </header>
      <section className={styles.formSection}>
        {result ? <div className={styles.success}>
          <CheckCircle2 size={56} strokeWidth={1.5} /><p className="eyebrow">Application received</p>
          <h1 ref={headingRef} tabIndex={-1}>Your video is<br />with our recruiters.</h1>
          <p>Video application submitted successfully for <strong>{result.jobTitle}</strong>.</p>
          <div className={styles.reference}><span>Your application reference</span><strong>{result.reference}</strong>
            <button type="button" onClick={async () => {
              try { await navigator.clipboard.writeText(result.reference); setCopyNotice("Reference copied."); }
              catch { setCopyNotice("Select and copy the reference above to save it."); }
            }}>Copy reference <FileText size={14} /></button>{copyNotice && <span role="status">{copyNotice}</span>}
          </div>
          <p>Save this reference for your records. The recruitment team will review your video and contact you on WhatsApp or Telegram about the next steps.</p>
          <Link href="/jobs" className="button button-primary">Explore more opportunities <ArrowUpRight size={18} /></Link>
        </div> : <>
          <div className={styles.formHeading}>
            <h1 ref={headingRef} tabIndex={-1}>Video application</h1>
            <p>A quick way to apply: tell us who you are and show us your skills in a short video of you doing the actual work.</p>
          </div>
          <form ref={formRef} aria-label="Video application form" noValidate onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <div className={styles.honeypot} aria-hidden="true"><label htmlFor="website">Website</label><input id="website" value={website}
              onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" /></div>
            <p className={styles.required}><span aria-hidden="true">*</span> Required information</p>
            <div className={styles.formBody}>
              <section className={styles.sectionCard} aria-labelledby="about-heading">
                <div className={styles.sectionHeading}><h2 id="about-heading" className={styles.sectionTitle}>About you</h2></div>
                <div className={styles.grid}>
                  <div className={styles.full}>{input("fullName", "Your complete name", { placeholder: "First name, middle name and last name", autoComplete: "name", maxLength: 120 })}</div>
                  {input("age", "Age", { type: "number", inputMode: "numeric", placeholder: "e.g. 32", min: 18, max: 65 })}
                  {input("nationality", "Nationality", { placeholder: "e.g. Filipino", autoComplete: "country-name", maxLength: 60 })}
                </div>
              </section>
              <section className={styles.sectionCard} aria-labelledby="position-heading">
                <div className={styles.sectionHeading}><h2 id="position-heading" className={styles.sectionTitle}>Position</h2></div>
                <div className={styles.questionStack}>
                  <div className={styles.field}>
                    <label htmlFor="jobId">Position applying for<span aria-label="required">*</span></label>
                    <select id="jobId" name="jobId" value={values.jobId} disabled={busy} required aria-required="true"
                      aria-invalid={Boolean(errors.jobId)} aria-describedby={errors.jobId ? "jobId-error" : undefined}
                      onChange={(event) => update("jobId", event.target.value)}>
                      <option value="">Select a position</option>
                      <optgroup label="Our listed jobs">{listed.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}</optgroup>
                      {additional.length > 0 && <optgroup label="Other jobs we’re offering">{additional.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}</optgroup>}
                    </select>
                    {errors.jobId && <p id="jobId-error" className={styles.fieldError}>{errors.jobId}</p>}
                  </div>
                  {input("experienceYears", "Total years of experience for this position", { type: "number", inputMode: "numeric", placeholder: "e.g. 5", min: 0, max: 50,
                    help: "Count only your experience in the position you selected." })}
                </div>
              </section>
              <section className={styles.sectionCard} aria-labelledby="contact-heading">
                <div className={styles.sectionHeading}><h2 id="contact-heading" className={styles.sectionTitle}>Contact numbers</h2></div>
                <div className={styles.grid}>
                  {input("whatsapp", "WhatsApp number", { type: "tel", inputMode: "tel", placeholder: "+63 912 345 6789", autoComplete: "tel", maxLength: 30,
                    help: "Include the country code.", icon: <WhatsAppIcon className={styles.whatsappIcon} /> })}
                  {input("telegram", "Telegram number", { type: "tel", inputMode: "tel", placeholder: "+63 912 345 6789", maxLength: 30,
                    help: "Include the country code.", icon: <TelegramIcon className={styles.telegramIcon} /> })}
                </div>
              </section>
              <section className={styles.sectionCard} aria-labelledby="photo-heading">
                <div className={styles.uploadHeading}><h2 className={styles.sectionTitle} id="photo-heading"><Camera size={22} aria-hidden="true" /> Your photo</h2>
                  <p className={styles.sectionIntro}>Upload a clear, recent photo of yourself. Face the camera in good light, with no sunglasses, hats or filters.</p>
                </div>
                <ApplicationUpload id="photo" label="Your photo" required accept={PHOTO_ACCEPT}
                  description="A clear, recent photo showing your face."
                  limitsText="JPG, JPEG, PNG · Maximum 10 MB"
                  file={photo || null} disabled={busy} error={errors.photo}
                  onChange={(next) => choosePhoto(next)} onRemove={() => choosePhoto(undefined)} />
                {/* A local blob preview cannot go through next/image optimization. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {photoPreview && <img src={photoPreview} alt="Preview of your selected photo" width={140} height={140}
                  style={{ display: "block", width: 140, height: 140, objectFit: "cover", borderRadius: 12, marginTop: 12 }} />}
              </section>
              <section className={styles.sectionCard} aria-labelledby="video-heading">
                <div className={styles.uploadHeading}><h2 className={styles.sectionTitle} id="video-heading"><Video size={22} aria-hidden="true" /> Work video</h2>
                  <p className={styles.sectionIntro}>Record a video of at least one minute showing yourself doing the actual work for the position you selected. Film in good light and keep your hands, tools and finished work visible.</p>
                </div>
                <ApplicationUpload id="video" label="Your work video" required accept={VIDEO_ACCEPT}
                  description="At least 1 minute long, showing you doing the actual work."
                  limitsText="MP4, MOV, M4V, WEBM, 3GP · Maximum 100 MB · At least 1 minute"
                  fileDetail={typeof duration === "number" ? formatLength(duration) : undefined}
                  file={file || null} disabled={busy} error={errors.video}
                  onChange={(next) => { uploadRef.current = null; void chooseFile(next); }}
                  onRemove={() => { uploadRef.current = null; void chooseFile(undefined); }} />
                <p className={styles.private}><LockKeyhole size={17} aria-hidden="true" /> Your photo and video are private and available only to authorized recruitment staff.</p>
              </section>
              <section className={styles.sectionCard} aria-labelledby="terms-heading">
                <div className={styles.sectionHeading}><h2 id="terms-heading" className={styles.sectionTitle}>Terms and privacy</h2></div>
                <label className={styles.consent}><input id="consent" type="checkbox" required aria-required="true" checked={values.consent} disabled={busy}
                  aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? "consent-error" : undefined}
                  onChange={(event) => update("consent", event.target.checked)} />
                  <span>I agree to the <Link href="/terms" target="_blank" rel="noopener noreferrer">terms and conditions</Link> and <Link href="/privacy" target="_blank" rel="noopener noreferrer">privacy policy</Link> of Jobs Street Croatia, and to be contacted on WhatsApp or Telegram about my application.</span>
                </label>
                {errors.consent && <p id="consent-error" className={styles.fieldError}>{errors.consent}</p>}
                <p className={styles.feeNote}>No placement fee.</p>
                <RecruitmentAdvisory />
              </section>
            </div>
            {error && <div className={styles.error} role="alert">{error}</div>}
            {busy && <div className={styles.progress} role="status"><div>
              <span>{stage === "uploading" ? "Uploading your photo and video — keep this page open" : "Confirming receipt…"}</span>
              <span>{stage === "uploading" ? `${progress}%` : ""}</span></div>
              <progress value={stage === "uploading" ? progress : 100} max={100} aria-label="Upload progress" /></div>}
            <div className={styles.actions}>
              <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Submitting…" : "Submit"}</button>
            </div>
            <p className={styles.saveNote}><LockKeyhole size={14} aria-hidden="true" /> If your connection drops, select Submit again to continue the upload where it stopped.</p>
            <div className={styles.policyLinks}><Link href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link><span aria-hidden="true">|</span><Link href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link></div>
          </form>
        </>}
      </section>
    </div>
  </div></div>;
}
