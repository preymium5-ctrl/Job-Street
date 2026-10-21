"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CheckCircle2, ClipboardCheck, FileText, LockKeyhole } from "lucide-react";
import type { ApplicantDetails, ApplicationInput, Job } from "@/lib/types";
import { formatApplicantAddress } from "@/lib/applicant-address";
import { applicationSchema, fieldErrors } from "@/lib/validation";
import { additionalPositionOptions, currentWorkCountries, destinationCountries } from "@/data/application-options";
import { isAdditionalApplicationJob } from "@/data/application-jobs";
import { MAX_REFERENCE_FILE_BYTES, MAX_REFERENCE_UPLOAD_BYTES, getReferenceApplicationUploads, type ReferenceUploadId, type SupportingDocumentCategory } from "@/lib/document-uploads";
import { BrandLockup } from "@/components/ui/Brand";
import { TelegramIcon, WhatsAppIcon } from "@/components/ui/ContactIcons";
import { ApplicationRequirements } from "./ApplicationRequirements";
import { ApplicationUpload } from "./ApplicationUpload";
import styles from "./ApplicationForm.module.css";

type FormErrors = Partial<Record<keyof ApplicationInput | `applicantDetails.${keyof ApplicantDetails}` | `document:${SupportingDocumentCategory}` | "resume" | "documents", string>>;
type UploadFiles = Partial<Record<ReferenceUploadId, File>>;
const addressFields = ["street", "city", "province", "postalCode"] as const;
const positionHelp = "Please select only a position for which you already have relevant work experience.";

function validateUpload(id: ReferenceUploadId, file: File | undefined, uploads: ReturnType<typeof getReferenceApplicationUploads>): string | undefined {
  const definition = uploads.find((upload) => upload.id === id)!;
  if (!file) return definition.required ? "Attach this required document." : undefined;
  if (!file.size) return "Choose a file that is not empty.";
  if (file.size > MAX_REFERENCE_FILE_BYTES) return "Choose a file no larger than 3 MB.";
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!extension || !definition.accept.split(",").includes(extension))
    return id === "resume" ? "Choose a PDF, DOC or DOCX file." : "Choose a PDF, DOC, DOCX, JPG, JPEG or PNG file.";
}

function uploadErrorKey(id: ReferenceUploadId): "resume" | `document:${SupportingDocumentCategory}` {
  return id === "resume" ? "resume" : `document:${id}`;
}

export default function ApplicationForm({ job: initialJob, jobs }: { job: Job; jobs?: Job[] }) {
  const availableJobs = jobs?.filter((job) => job.status === "published") || [initialJob];
  const [values, setValues] = useState<ApplicationInput>({
    applicationFormVersion: 2, destinationCountry: destinationCountries.find((country) => country === initialJob.location) || "Croatia", termsAccepted: false,
    jobId: initialJob.id, fullName: "", email: "", phone: "", country: "", consent: false,
    applicantDetails: {
      firstName: "", lastName: "", gender: "", telegram: "", currentAddress: "",
      street: "", city: "", province: "", postalCode: "", dateOfBirth: "", placeOfBirth: "",
      fatherName: "", motherName: "", secondaryPosition: "", otherPosition: "",
      englishProficiency: "" as ApplicantDetails["englishProficiency"],
    },
  });
  const job = availableJobs.find((candidate) => candidate.id === values.jobId) || initialJob;
  const uploads = getReferenceApplicationUploads({ country: values.country, destinationCountry: values.destinationCountry, jobTitle: job.title });
  const [files, setFiles] = useState<UploadFiles>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ reference: string; jobTitle: string } | null>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const [website, setWebsite] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submittingRef = useRef(false);
  const idempotencyRef = useRef<string | null>(null);
  const totalBytes = Object.values(files).reduce((sum, file) => sum + (file?.size || 0), 0);
  const requiredUploads = uploads.filter((upload) => upload.required);
  const requiredReady = requiredUploads.filter((upload) => !validateUpload(upload.id, files[upload.id], uploads)).length;

  function update<K extends keyof ApplicationInput>(key: K, value: ApplicationInput[K]) {
    idempotencyRef.current = null;
    const selectedJob = key === "jobId" ? availableJobs.find((candidate) => candidate.id === value) : undefined;
    const destination = selectedJob && destinationCountries.find((country) => country === selectedJob.location);
    setValues((current) => ({ ...current, [key]: value, ...(destination ? { destinationCountry: destination } : {}) }));
    setErrors((current) => ({ ...current, [key]: undefined,
      ...(key === "country" ? { "document:residence-id": undefined } : {}),
      ...(key === "jobId" ? { "document:driver-license": undefined } : {}) }));
  }

  function updateDetails<K extends keyof ApplicantDetails>(key: K, value: ApplicantDetails[K]) {
    idempotencyRef.current = null;
    setValues((current) => {
      const applicantDetails = { ...current.applicantDetails!, [key]: value };
      if (addressFields.some((field) => field === key)) applicantDetails.currentAddress = formatApplicantAddress(applicantDetails);
      return { ...current, applicantDetails, fullName: `${applicantDetails.firstName.trim()} ${applicantDetails.lastName.trim()}`.trim() };
    });
    setErrors((current) => ({ ...current, [`applicantDetails.${key}`]: undefined,
      ...(key === "firstName" || key === "lastName" ? { fullName: undefined, "applicantDetails.firstName": undefined, "applicantDetails.lastName": undefined } : {}) }));
  }

  function chooseFile(id: ReferenceUploadId, file?: File) {
    idempotencyRef.current = null;
    setFiles((current) => ({ ...current, [id]: file }));
    setErrors((current) => ({ ...current, [uploadErrorKey(id)]: file ? validateUpload(id, file, uploads) : undefined, documents: undefined }));
  }

  function validateAll(): FormErrors {
    const parsed = applicationSchema.safeParse(values);
    const next: FormErrors = parsed.success ? {} : fieldErrors(parsed.error);
    for (const upload of uploads) {
      const message = validateUpload(upload.id, files[upload.id], uploads);
      if (message) next[uploadErrorKey(upload.id)] = message;
    }
    if (totalBytes > MAX_REFERENCE_UPLOAD_BYTES) next.documents = "Keep all files together within 4 MB; aim for under 1 MB each.";
    return next;
  }

  function showErrors(next: FormErrors) {
    setErrors(next);
    requestAnimationFrame(() => {
      const invalid = formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']");
      if (invalid?.tagName === "FIELDSET") invalid.querySelector<HTMLInputElement>("input")?.focus();
      else if (invalid) invalid.focus();
      else formRef.current?.querySelector<HTMLElement>("#documents-error")?.focus();
    });
  }

  function submit() {
    if (submittingRef.current) return;
    const next = validateAll();
    if (Object.keys(next).length) { showErrors(next); return; }
    const resume = files.resume;
    if (!resume) return;
    submittingRef.current = true; setBusy(true); setError(""); setProgress(0);
    idempotencyRef.current ||= crypto.randomUUID();
    const body = new FormData();
    body.append("payload", JSON.stringify(values)); body.append("resume", resume);
    for (const upload of uploads) {
      if (upload.id !== "resume" && files[upload.id]) body.append(`document:${upload.id}`, files[upload.id]!);
    }
    body.append("website", website); body.append("idempotencyKey", idempotencyRef.current);
    const xhr = new XMLHttpRequest(); xhr.open("POST", "/api/applications"); xhr.timeout = 120000;
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
    const fail = (message: string) => { setError(message); setBusy(false); submittingRef.current = false; };
    xhr.onerror = () => fail("We couldn’t connect. Your application has not been confirmed. Check your connection and try again.");
    xhr.ontimeout = () => fail("The request timed out. Please try again; your reference will be recovered if the submission was received.");
    xhr.onload = () => {
      let response: { error?: string; fieldErrors?: FormErrors; reference?: string; jobTitle?: string };
      try { response = JSON.parse(xhr.responseText); }
      catch { fail("We couldn’t confirm your application. Please try again."); return; }
      if (xhr.status >= 200 && xhr.status < 300 && response.reference && response.jobTitle) {
        setResult({ reference: response.reference, jobTitle: response.jobTitle }); setBusy(false);
        requestAnimationFrame(() => headingRef.current?.focus());
      } else {
        if (response.fieldErrors) showErrors(response.fieldErrors);
        fail(response.error || "We couldn’t submit your application. Please review your details and try again.");
      }
    };
    xhr.send(body);
  }

  function profileText(key: keyof ApplicantDetails, label: string, options: {
    optional?: boolean; type?: string; placeholder?: string; autoComplete?: string; help?: string; icon?: ReactNode;
  } = {}) {
    const errorKey = `applicantDetails.${key}` as const;
    const limits: Partial<Record<keyof ApplicantDetails, number>> = {
      firstName: 60, lastName: 60, telegram: 80, street: 140, city: 60, province: 60,
      postalCode: 20, placeOfBirth: 120, fatherName: 120, motherName: 120, otherPosition: 160,
    };
    return <div className={styles.field}>
      <label htmlFor={errorKey}>{options.icon}{label}<span>{options.optional ? "Optional" : <span aria-label="required">*</span>}</span></label>
      <input id={errorKey} name={errorKey} type={options.type || "text"} value={values.applicantDetails?.[key] || ""}
        placeholder={options.placeholder} autoComplete={options.autoComplete} maxLength={limits[key]} disabled={busy}
        max={options.type === "date" ? new Date().toISOString().slice(0, 10) : undefined}
        required={!options.optional} aria-required={!options.optional} aria-invalid={Boolean(errors[errorKey])}
        aria-describedby={[options.help ? `${errorKey}-help` : undefined, errors[errorKey] ? `${errorKey}-error` : undefined].filter(Boolean).join(" ") || undefined}
        onChange={(event) => updateDetails(key, event.target.value as ApplicantDetails[typeof key])} />
      {options.help && <p id={`${errorKey}-help`} className={styles.formNote}>{options.help}</p>}
      {errors[errorKey] && <p id={`${errorKey}-error`} className={styles.fieldError}>{errors[errorKey]}</p>}
    </div>;
  }

  function contactInput(key: "email" | "phone", label: string, placeholder: string, help?: string, icon?: ReactNode) {
    return <div className={styles.field}>
      <label htmlFor={key}>{icon}{label}<span aria-label="required">*</span></label>
      <input id={key} name={key} type={key === "email" ? "email" : "tel"} value={values[key]} placeholder={placeholder}
        autoComplete={key === "email" ? "email" : "tel"} maxLength={key === "email" ? 254 : 30} disabled={busy}
        required aria-required="true" aria-invalid={Boolean(errors[key])}
        aria-describedby={[help ? `${key}-help` : undefined, errors[key] ? `${key}-error` : undefined].filter(Boolean).join(" ") || undefined}
        onChange={(event) => update(key, event.target.value)} />
      {help && <p id={`${key}-help`} className={styles.formNote}>{help}</p>}
      {errors[key] && <p id={`${key}-error`} className={styles.fieldError}>{errors[key]}</p>}
    </div>;
  }

  function selectField(key: "country" | "jobId" | "destinationCountry" | "secondaryPosition", label: string,
    options: readonly { value: string; label: string; group?: string }[], help?: string, placeholder = true) {
    const nested = key === "secondaryPosition";
    const errorKey = nested ? `applicantDetails.${key}` as const : key;
    const value = nested ? values.applicantDetails?.[key] || "" : values[key];
    return <div className={styles.field}>
      <label htmlFor={errorKey}>{label}<span aria-label="required">*</span></label>
      <select id={errorKey} name={errorKey} value={value} disabled={busy} required aria-required="true" aria-invalid={Boolean(errors[errorKey])}
        aria-describedby={[help ? `${errorKey}-help` : undefined, errors[errorKey] ? `${errorKey}-error` : undefined].filter(Boolean).join(" ") || undefined}
        onChange={(event) => {
          if (key === "secondaryPosition") updateDetails(key, event.target.value);
          else if (key === "destinationCountry") update(key, event.target.value as ApplicationInput["destinationCountry"]);
          else update(key, event.target.value);
        }}>
        {placeholder && <option value="">Select an option</option>}
        {options.some((option) => option.group)
          ? [...new Set(options.map((option) => option.group))].map((group) => <optgroup key={group} label={group || "Jobs"}>
            {options.filter((option) => option.group === group).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </optgroup>)
          : options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {help && <p id={`${errorKey}-help`} className={styles.formNote}>{help}</p>}
      {errors[errorKey] && <p id={`${errorKey}-error`} className={styles.fieldError}>{errors[errorKey]}</p>}
    </div>;
  }

  function choices(key: "gender" | "englishProficiency", label: string, options: readonly string[]) {
    const errorKey = `applicantDetails.${key}` as const;
    return <fieldset className={styles.field} role="radiogroup" aria-required="true"
      aria-invalid={Boolean(errors[errorKey])} aria-describedby={errors[errorKey] ? `${errorKey}-error` : undefined}>
      <legend className={styles.choiceLabel}>{label} <span aria-label="required">*</span></legend>
      <div className={styles.choiceGroup}>{options.map((option) => <label key={option}
        className={`${styles.choiceCard} ${values.applicantDetails?.[key] === option ? styles.choiceSelected : ""}`}>
        <input className={styles.radio} type="radio" name={errorKey} value={option} checked={values.applicantDetails?.[key] === option}
          required disabled={busy} onChange={() => updateDetails(key, option as ApplicantDetails[typeof key])} />
        <span className={styles.choiceCopy}>{option}</span>
      </label>)}</div>
      {errors[errorKey] && <p id={`${errorKey}-error`} className={styles.fieldError}>{errors[errorKey]}</p>}
    </fieldset>;
  }

  const nameOptions = (options: readonly string[]) => options.map((option) => ({ value: option, label: option }));

  return <div className={styles.page}><div className="container">
    <Link href={`/jobs/${job.slug}`} className={styles.back}><ArrowLeft size={16} /> Back to opportunities</Link>
    <div className={styles.shell} role="region" aria-label="Application">
      <header className={styles.masthead}>
        <div className={styles.mastheadBrand}><BrandLockup /></div>
        <p className={styles.mastheadLabel}>Application form</p>
      </header>
      <div>
        {job.isExample && <p className={styles.example}><strong>Development example vacancy.</strong> Use fictitious details for this demonstration application.</p>}
        <section className={styles.formSection}>
          {result ? <div className={styles.success}>
            <CheckCircle2 size={56} strokeWidth={1.5} /><p className="eyebrow">Application received</p>
            <h1 ref={headingRef} tabIndex={-1}>Your next chapter<br />is one step closer.</h1>
            <p>Application submitted successfully for <strong>{result.jobTitle}</strong>.</p>
            <div className={styles.reference}><span>Your application reference</span><strong>{result.reference}</strong>
              <button type="button" onClick={async () => {
                try { await navigator.clipboard.writeText(result.reference); setCopyNotice("Reference copied."); }
                catch { setCopyNotice("Select and copy the reference above to save it."); }
              }}>Copy reference <FileText size={14} /></button>{copyNotice && <span role="status">{copyNotice}</span>}
            </div>
            <p>Save this reference for your records. The recruitment team will review your application and contact you about the next steps for this role.</p>
            <Link href="/jobs" className="button button-primary">Explore more opportunities <ArrowUpRight size={18} /></Link>
          </div> : <>
            <div className={styles.formHeading}>
              <h1 ref={headingRef} tabIndex={-1}>Welcome! Please tell us about yourself.</h1>
              <p>Please enter these details as they appear on your passport.</p>
            </div>
            <form ref={formRef} aria-label={`${job.title} application form`} noValidate onSubmit={(event) => { event.preventDefault(); submit(); }}>
              <div className={styles.honeypot} aria-hidden="true"><label htmlFor="website">Website</label><input id="website" value={website}
                onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" /></div>
              <p className={styles.required}><span aria-hidden="true">*</span> Required information</p>
              <div className={styles.formBody}>
                  <section id="personal-details" className={styles.sectionCard} aria-label="Personal details">
                    <div className={styles.grid}>
                      {profileText("firstName", "Your first name", { placeholder: "Enter your first name", autoComplete: "given-name" })}
                      {profileText("lastName", "Your last name", { placeholder: "Enter your last name", autoComplete: "family-name" })}
                      {choices("gender", "Enter your gender", ["Male", "Female"])}
                      {contactInput("email", "Email", "you@example.com")}
                      {contactInput("phone", "WhatsApp number", "+63 912 345 6789", "Enter your active WhatsApp number with the country code.", <WhatsAppIcon className={styles.whatsappIcon} />)}
                      {profileText("telegram", "Telegram number", { optional: true, type: "tel", placeholder: "Enter your Telegram number", help: "Enter your active Telegram number, if you use Telegram.", icon: <TelegramIcon className={styles.telegramIcon} /> })}
                      <fieldset className={`${styles.addressGroup} ${styles.full}`}><legend>Your current address / location</legend><div className={styles.grid}>
                        {profileText("street", "Street", { placeholder: "House / building number and street", autoComplete: "street-address" })}
                        {profileText("city", "City", { placeholder: "Enter your city", autoComplete: "address-level2" })}
                        {profileText("province", "Province", { placeholder: "Enter your province / state", autoComplete: "address-level1" })}
                        {profileText("postalCode", "Postal code", { placeholder: "Enter your postal code", autoComplete: "postal-code" })}
                      </div></fieldset>
                      {profileText("dateOfBirth", "Date of birth", { type: "date", autoComplete: "bday" })}
                      {profileText("placeOfBirth", "Your place of birth", { placeholder: "City / province and country" })}
                      {profileText("fatherName", "Your father’s full name", { optional: true })}
                      {profileText("motherName", "Your mother’s full name", { optional: true })}
                      <div className={styles.full}>{selectField("destinationCountry", "Please select a country where you would like to apply", nameOptions(destinationCountries), undefined, false)}</div>
                    </div>
                  </section>
                  <section id="work-experience" className={styles.sectionCard} aria-labelledby="work-heading">
                    <SectionHeading id="work-heading" title="Work Experience" />
                    <div className={styles.questionStack}>
                      {selectField("country", "Country where you are currently working", nameOptions(currentWorkCountries), "Select the country where you currently work or are based.")}
                      {selectField("jobId", "What job position are you primarily applying for?", [
                        ...availableJobs.filter((candidate) => !isAdditionalApplicationJob(candidate)),
                        ...availableJobs.filter(isAdditionalApplicationJob),
                      ].map((candidate) => ({ value: candidate.id, label: candidate.title, group: isAdditionalApplicationJob(candidate) ? "Other jobs we’re offering" : "Our listed jobs" })), positionHelp, false)}
                      {selectField("secondaryPosition", "Please select an additional role in which you have relevant experience", nameOptions(additionalPositionOptions), "Choose a role other than the one you are applying for. Select ‘No other position’ if none applies.")}
                      {profileText("otherPosition", "If the job you’re applying for is not listed above, please enter it here", { optional: true })}
                    </div>
                  </section>
                  <section id="application-documents" className={styles.sectionCard} aria-label="Documents that may be required and uploads">
                    <ApplicationRequirements />
                    <div className={styles.uploadHeading}><h2 className={styles.sectionTitle} id="documents-heading">Document Uploads</h2>
                      <p className={styles.sectionIntro}>Attach your updated CV / Resume and valid passport. A residence ID is required for applicants working outside the Philippines, and a driver’s license is required for driver applicants. You may upload other supporting documents if available.</p>
                    </div>
                    <div className={styles.uploadStatus} role="status" aria-live="polite"><ClipboardCheck size={22} aria-hidden="true" /><div><strong>{requiredReady} of {requiredUploads.length} required documents ready</strong>
                      <p>{(totalBytes / 1024 / 1024).toFixed(1)} MB of 4 MB used. Keep all files together within 4 MB; aim for under 1 MB each.</p></div>
                    </div>
                    <div className={styles.uploadsGrid}>{uploads.map((upload) => <ApplicationUpload key={upload.id}
                      id={upload.id === "resume" ? "resume" : `attachment-${upload.id}`} label={upload.label} description={upload.description}
                      required={upload.required} accept={upload.accept} file={files[upload.id] || null} disabled={busy}
                      error={errors[uploadErrorKey(upload.id)]} onChange={(file) => chooseFile(upload.id, file)} onRemove={() => chooseFile(upload.id)} />)}</div>
                    {errors.documents && <p className={styles.fieldError} id="documents-error" role="alert" tabIndex={-1}>{errors.documents}</p>}
                    <p className={styles.private}><LockKeyhole size={17} aria-hidden="true" /> Your files are private and available only to authorized recruitment staff.</p>
                  </section>
                  <section id="important-notices" className={styles.sectionCard} aria-labelledby="notices-heading">
                    <SectionHeading id="notices-heading" title="IMPORTANT NOTICES" />
                    {choices("englishProficiency", "We require all candidates to display basic proficiency in English. Are you able to speak, read, and write English at a basic level?", ["Yes", "No"])}
                    <p className={styles.feeNote}>No placement fee.</p>
                  </section>
                  <section id="application-terms" className={styles.sectionCard} aria-labelledby="terms-heading">
                    <SectionHeading id="terms-heading" title="Terms and Conditions" />
                    <label className={styles.consent}><input id="termsAccepted" type="checkbox" required aria-required="true" checked={Boolean(values.termsAccepted)} disabled={busy}
                      aria-invalid={Boolean(errors.termsAccepted)} aria-describedby={errors.termsAccepted ? "termsAccepted-error" : undefined}
                      onChange={(event) => update("termsAccepted", event.target.checked)} />
                      <span>I agree to the <Link href="/terms" target="_blank" rel="noopener noreferrer">terms and conditions</Link> provided by Jobs Street Croatia. By providing my contact details, I agree to receive messages about my application.</span>
                    </label>
                    {errors.termsAccepted && <p id="termsAccepted-error" className={styles.fieldError}>{errors.termsAccepted}</p>}
                    <label className={styles.consent}><input id="consent" type="checkbox" required aria-required="true" checked={values.consent} disabled={busy}
                      aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? "consent-error" : undefined}
                      onChange={(event) => update("consent", event.target.checked)} />
                      <span>I agree to the <Link href="/privacy" target="_blank" rel="noopener noreferrer">privacy policy</Link> provided by Jobs Street Croatia and understand that my information will be used in accordance with the policy.</span>
                    </label>
                    {errors.consent && <p id="consent-error" className={styles.fieldError}>{errors.consent}</p>}
                  </section>
              </div>
              {error && <div className={styles.error} role="alert">{error}</div>}
              {busy && <div className={styles.progress} role="status"><div><span>{progress < 100 ? "Uploading your application" : "Confirming receipt…"}</span><span>{progress}%</span></div><progress value={progress} max={100} aria-label="Application upload progress" /></div>}
              <div className={styles.actions}>
                <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Submitting…" : "Submit"}</button>
              </div>
              <p className={styles.saveNote}><LockKeyhole size={14} aria-hidden="true" /> Check your answers before submitting. Your application is sent only when you select Submit.</p>
              <div className={styles.policyLinks}><Link href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link><span aria-hidden="true">|</span><Link href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link></div>
            </form>
          </>}
        </section>
      </div>
    </div>
  </div></div>;
}

function SectionHeading({ title, id }: { title: string; id: string }) {
  return <div className={styles.sectionHeading}><h2 id={id} className={styles.sectionTitle}>{title}</h2></div>;
}
