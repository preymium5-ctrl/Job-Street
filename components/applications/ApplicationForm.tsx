"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  FileText,
  LockKeyhole,
  MapPin,
  Upload,
  X,
} from "lucide-react";
import { discoverySources, type ApplicationInput, type DiscoverySource, type Job } from "@/lib/types";
import { JobSalary } from "@/components/jobs/JobSalary";
import { minimumExperienceYears } from "@/data/employment";
import { NoPlacementFee } from "@/components/jobs/EmploymentBenefits";
import { MAX_APPLICATION_UPLOAD_BYTES, MAX_SUPPORTING_DOCUMENT_BYTES, SUPPORTING_DOCUMENT_ACCEPT, supportingDocumentTypes, type SupportingDocumentCategory } from "@/lib/document-uploads";
import { JobFairRoleInfo } from "@/components/job-fair/JobFairRoleInfo";
import { fairDocumentTiming, getJobFairRole } from "@/data/job-fair";
import styles from "./ApplicationForm.module.css";

type FormErrors = Partial<Record<keyof ApplicationInput | "resume" | "documents", string>>;
const steps = [
  "Your details",
  "Your experience",
  "Your documents",
  "Review & submit",
];
const fields: (keyof ApplicationInput)[][] = [
  ["fullName", "email", "phone", "country", "discoverySource"],
  ["recentJobTitle", "experienceYears", "skills", "education", "summary"],
  ["coverLetter", "nc2Certificate", "driverLicenseDetails", "preferredEmployer"],
  ["consent"],
];
const maxResumeBytes = 5 * 1024 * 1024;
function validate(
  values: ApplicationInput,
  step: number,
  resume: File | null,
): FormErrors {
  const errors: FormErrors = {};
  if (step === 0) {
    if (values.fullName.trim().length < 2)
      errors.fullName = "Enter your full name (at least 2 characters).";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()))
      errors.email = "Enter a valid email address.";
    if (
      values.phone.replace(/[^0-9]/g, "").length < 7 ||
      !/^[+\d\s().-]+$/.test(values.phone.trim())
    )
      errors.phone = "Enter a valid contact number with country code.";
    if (values.country.trim().length < 2)
      errors.country = "Enter your country of residence.";
    if (
      values.discoverySource !== undefined &&
      values.discoverySource !== "" &&
      !discoverySources.some((source) => source === values.discoverySource)
    )
      errors.discoverySource = "Select a listed option or leave this field blank.";
  }
  if (step === 1) {
    if (values.recentJobTitle.trim().length < 2)
      errors.recentJobTitle = "Enter your most recent role, or ‘New entrant’.";
    if (
      !Number.isFinite(values.experienceYears) ||
      values.experienceYears < minimumExperienceYears ||
      values.experienceYears > 60
    )
      errors.experienceYears = "At least 3 years of relevant work experience is required. Enter a value from 3 to 60.";
    if (values.skills.trim().length < 2)
      errors.skills = "Tell us about your relevant skills.";
  }
  if (step === 2) {
    if ((values.nc2Certificate || "").trim().length > 200)
      errors.nc2Certificate = "Keep your certificate details within 200 characters.";
    if ((values.driverLicenseDetails || "").trim().length > 200)
      errors.driverLicenseDetails = "Keep your license details within 200 characters.";
    if (!resume) errors.resume = "Please upload your resume or CV.";
    else if (resume.size > maxResumeBytes)
      errors.resume = "Your file must be 5 MB or smaller.";
    else if (!/\.(pdf|doc|docx)$/i.test(resume.name))
      errors.resume = "Choose a PDF, DOC or DOCX document.";
  }
  if (step === 3 && !values.consent)
    errors.consent = "Please acknowledge the privacy notice to submit.";
  return errors;
}

export default function ApplicationForm({ job }: { job: Job }) {
  const fairRole = getJobFairRole(job);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<ApplicationInput>({
    jobId: job.id,
    fullName: "",
    email: "",
    phone: "",
    country: "",
    discoverySource: "",
    recentJobTitle: "",
    experienceYears: Number.NaN,
    skills: "",
    education: "",
    summary: "",
    coverLetter: "",
    nc2Certificate: "",
    ...(fairRole?.drivingLicenseIsPlus ? { driverLicenseDetails: "" } : {}),
    preferredEmployer: "",
    consent: false,
  });
  const [resume, setResume] = useState<File | null>(null);
  const [supportingFiles, setSupportingFiles] = useState<Partial<Record<SupportingDocumentCategory, File>>>({});
  const documentRefs = useRef<Partial<Record<SupportingDocumentCategory, HTMLInputElement | null>>>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{
    reference: string;
    jobTitle: string;
  } | null>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const idempotencyRef = useRef<string | null>(null);
  const [website, setWebsite] = useState("");

  function update<K extends keyof ApplicationInput>(
    key: K,
    value: ApplicationInput[K],
  ) {
    idempotencyRef.current = null;
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function goTo(next: number) {
    setStep(next);
    setError("");
    setErrors({});
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function showErrors(nextErrors: FormErrors) {
    setErrors(nextErrors);
    requestAnimationFrame(() =>
      formRef.current
        ?.querySelector<HTMLElement>("[aria-invalid='true']")
        ?.focus(),
    );
  }

  function continueStep() {
    const nextErrors = validate(values, step, resume);
    const documentError = checkSupportingFiles(step === 1 ? "diploma" : undefined);
    if ((step === 1 || step === 2) && documentError) nextErrors.documents = documentError;
    if (Object.keys(nextErrors).length) {
      showErrors(nextErrors);
      return;
    }
    goTo(step + 1);
  }

  function chooseFile(file: File | undefined) {
    idempotencyRef.current = null;
    const next = file || null;
    setResume(next);
    const check = next ? validate(values, 2, next) : {};
    setErrors((current) => ({ ...current, resume: check.resume }));
  }

  async function submit() {
    if (submittingRef.current) return;
    const documentError = checkSupportingFiles();
    if (documentError) { setStep(2); showErrors({ documents: documentError }); return; }
    for (let index = 0; index < 4; index++) {
      const nextErrors = validate(values, index, resume);
      if (Object.keys(nextErrors).length) {
        setStep(index);
        showErrors(nextErrors);
        return;
      }
    }
    if (!resume) return;
    submittingRef.current = true;
    setBusy(true);
    setError("");
    setProgress(0);
    idempotencyRef.current ||= crypto.randomUUID();
    const body = new FormData();
    body.append("payload", JSON.stringify(values));
    body.append("resume", resume);
    for (const { id } of supportingDocumentTypes) {
      const file = supportingFiles[id];
      if (file) body.append(`document:${id}`, file);
    }
    body.append("website", website);
    body.append("idempotencyKey", idempotencyRef.current);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/applications");
    xhr.timeout = 120000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        setProgress(Math.round((event.loaded / event.total) * 100));
    };
    const fail = (message: string) => {
      setError(message);
      setBusy(false);
      submittingRef.current = false;
    };
    xhr.onerror = () =>
      fail(
        "We couldn’t connect. Your application has not been confirmed. Check your connection and try again.",
      );
    xhr.ontimeout = () =>
      fail(
        "The request timed out. Please try again; your reference will be recovered if the submission was received.",
      );
    xhr.onload = () => {
      let response: {
        error?: string;
        fieldErrors?: FormErrors;
        reference?: string;
        jobTitle?: string;
      };
      try {
        response = JSON.parse(xhr.responseText);
      } catch {
        fail("We couldn’t confirm your application. Please try again.");
        return;
      }
      if (
        xhr.status >= 200 &&
        xhr.status < 300 &&
        response.reference &&
        response.jobTitle
      ) {
        setResult({
          reference: response.reference,
          jobTitle: response.jobTitle,
        });
        setBusy(false);
        requestAnimationFrame(() => headingRef.current?.focus());
      } else {
        if (response.fieldErrors) {
          const invalidStep = fields.findIndex((keys) =>
            keys.some((key) => response.fieldErrors?.[key]),
          );
          if (invalidStep >= 0) setStep(invalidStep);
          else if (response.fieldErrors.resume || response.fieldErrors.documents) setStep(2);
          showErrors(response.fieldErrors);
        }
        fail(
          response.error ||
            "We couldn’t submit your application. Please review your details and try again.",
        );
      }
    };
    xhr.send(body);
  }

  function checkSupportingFiles(only?: SupportingDocumentCategory) {
    for (const { id, label } of supportingDocumentTypes) {
      if (only && id !== only) continue;
      const file = supportingFiles[id];
      if (file && (!file.size || file.size > MAX_SUPPORTING_DOCUMENT_BYTES)) return `${label}: choose a file no larger than 3 MB.`;
      if (file && !/\.(pdf|doc|docx|jpe?g|png)$/i.test(file.name)) return `${label}: choose a PDF, DOC, DOCX, JPG, or PNG file.`;
    }
    if (!only && Object.values(supportingFiles).reduce((sum, file) => sum + (file?.size || 0), resume?.size || 0) > MAX_APPLICATION_UPLOAD_BYTES)
      return "Keep the CV and supporting documents together within 15 MB.";
  }

  function supportingUpload(category: SupportingDocumentCategory) {
    const label = supportingDocumentTypes.find((item) => item.id === category)!.label;
    const file = supportingFiles[category];
    return (
      <div className={`${styles.field} ${styles.wide} ${styles.documentUpload}`} key={category}>
        <label htmlFor={`attachment-${category}`}>{label} <span>Optional</span></label>
        <input id={`attachment-${category}`} type="file" accept={SUPPORTING_DOCUMENT_ACCEPT} disabled={busy}
          ref={(element) => { documentRefs.current[category] = element; }} aria-invalid={Boolean(errors.documents)}
          aria-describedby={`attachment-${category}-help${errors.documents ? " supporting-documents-error" : ""}`}
          onChange={(event) => { idempotencyRef.current = null; const next = event.target.files?.[0];
            setSupportingFiles((current) => ({ ...current, [category]: next })); setErrors((current) => ({ ...current, documents: undefined })); }} />
        <p className={styles.documentNote} id={`attachment-${category}-help`}>PDF, DOC, DOCX, JPG or PNG · Up to 3 MB</p>
        {file && <div className={styles.file}><FileText size={18} /><div><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB</span></div>
          <button type="button" disabled={busy} aria-label={`Remove ${label}`} onClick={() => {
            idempotencyRef.current = null; setSupportingFiles((current) => ({ ...current, [category]: undefined }));
            const element = documentRefs.current[category]; if (element) element.value = "";
            setErrors((current) => ({ ...current, documents: undefined }));
          }}><X size={18} /></button></div>}
      </div>
    );
  }

  function input(
    key: keyof ApplicationInput,
    label: string,
    options: {
      placeholder?: string;
      type?: string;
      autoComplete?: string;
      optional?: boolean;
      wide?: boolean;
      textarea?: boolean;
    } = {},
  ) {
    const props = {
      id: key,
      name: key,
      value: String(values[key] ?? ""),
      "aria-invalid": Boolean(errors[key]),
      "aria-required": !options.optional,
      "aria-describedby": errors[key] ? `${key}-error` : undefined,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) =>
        update(
          key,
          key === "experienceYears"
            ? event.target.value === ""
              ? Number.NaN
              : Number(event.target.value)
            : event.target.value,
        ),
      placeholder: options.placeholder,
      disabled: busy,
    };
    const limits: Partial<Record<keyof ApplicationInput, number>> = {
      fullName: 120,
      email: 254,
      phone: 30,
      country: 80,
      recentJobTitle: 160,
      skills: 2000,
      education: 2000,
      summary: 4000,
      coverLetter: 6000,
      nc2Certificate: 200,
      driverLicenseDetails: 200,
    };
    return (
      <div className={`${styles.field} ${options.wide ? styles.full : ""}`}>
        <label htmlFor={key}>
          {label}
          {options.optional ? (
            <span>Optional</span>
          ) : (
            <span aria-label="required">*</span>
          )}
        </label>
        {options.textarea ? (
          <textarea {...props} rows={4} maxLength={limits[key]} />
        ) : (
          <input
            {...props}
            value={
              key === "experienceYears" &&
              !Number.isFinite(values.experienceYears)
                ? ""
                : props.value
            }
            type={options.type || "text"}
            autoComplete={options.autoComplete}
            min={key === "experienceYears" ? minimumExperienceYears : undefined}
            max={key === "experienceYears" ? 60 : undefined}
            maxLength={limits[key]}
          />
        )}
        {errors[key] && (
          <p id={`${key}-error`} className={styles.fieldError}>
            {errors[key]}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className="container">
        <Link href={`/jobs/${job.slug}`} className={styles.back}>
          <ArrowLeft size={16} /> Back to the opportunity
        </Link>
        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            <p className="eyebrow">Jobs Street Croatia / Application</p>
            <h1>
              Make your
              <br />
              <span>next move.</span>
            </h1>
            <div className={styles.jobImage}>
              <Image
                src={job.image}
                alt={job.imageAlt}
                fill
                sizes="(max-width: 800px) 100vw, 36vw"
                style={{
                  objectFit: "cover",
                  objectPosition: job.imagePosition || "center",
                }}
              />
            </div>
            <div className={styles.jobMeta}>
              <span>{job.category}</span>
              <h2>{job.title}</h2>
              <p>
                <MapPin size={15} />
                {job.location}
              </p>
            </div>
            <JobSalary job={job} />
            <NoPlacementFee />
            <section className={styles.jobDescription} aria-label="Job details">
              <h3>Job description</h3>
              <p>{job.description}</p>
              <p className={styles.roleExperience}><strong>Experience</strong>{job.experience}</p>
              <details open>
                <summary>Key responsibilities</summary>
                <ul>{job.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul>
              </details>
              <details open>
                <summary>Qualifications & requirements</summary>
                <ul>{job.requirements.map((item) => <li key={item}>{item}</li>)}{fairRole?.drivingLicenseIsPlus && <li>A driver’s license is a plus (optional).</li>}</ul>
              </details>
              <Link href={`/jobs/${job.slug}#overview`} target="_blank" rel="noopener noreferrer">View all job details <ArrowUpRight size={15} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></Link>
            </section>
            <JobFairRoleInfo job={job} compact />
            {job.salaryStatus === "proposed-net" && (
              <div className={styles.example}>
                <strong>{job.openings} positions available</strong>
              </div>
            )}
            {job.isExample && (
              <div className={styles.example}>
                <strong>Development example vacancy</strong>
                <p>
                  This is a demonstration role, not an employer’s live
                  recruitment campaign. Submit only fictitious information when
                  trying this application.
                </p>
              </div>
            )}
            <p className={styles.private}>
              <LockKeyhole size={16} /> Your resume is private and available
              only to authorized recruitment staff.
            </p>
          </aside>
          <section className={styles.formSection}>
            {result ? (
              <div className={styles.success}>
                <CheckCircle2 size={52} strokeWidth={1.2} />
                <p className="eyebrow">Application received</p>
                <h2 ref={headingRef} tabIndex={-1}>
                  Your next step
                  <br />
                  starts with you.
                </h2>
                <p>
                  Application submitted successfully for{" "}
                  <strong>{result.jobTitle}</strong>.
                </p>
                <div className={styles.reference}>
                  <span>Your application reference</span>
                  <strong>{result.reference}</strong>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(result.reference);
                        setCopyNotice("Reference copied.");
                      } catch {
                        setCopyNotice(
                          "Select and copy the reference above to save it.",
                        );
                      }
                    }}
                  >
                    Copy reference <FileText size={14} />
                  </button>
                  {copyNotice && <span role="status">{copyNotice}</span>}
                </div>
                <p>
                  Save this reference for your records. The recruitment team can
                  use it to locate your application. Review and next steps vary
                  by employer and role.
                </p>
                {job.isExample && (
                  <p className={styles.example}>
                    This submission is stored as a development example and is
                    not part of live employer recruitment.
                  </p>
                )}
                <Link href="/jobs" className="button button-primary">
                  Explore more opportunities <ArrowUpRight size={18} />
                </Link>
              </div>
            ) : (
              <>
                <ol className={styles.steps} aria-label="Application progress">
                  {steps.map((label, index) => (
                    <li
                      key={label}
                      className={`${index === step ? styles.current : ""} ${index < step ? styles.completed : ""}`}
                      aria-current={index === step ? "step" : undefined}
                    >
                      <span>
                        {index < step ? <Check size={16} /> : `0${index + 1}`}
                      </span>
                      <div>{label}</div>
                    </li>
                  ))}
                </ol>
                <div className={styles.formHeading}>
                  <p className="eyebrow">Step 0{step + 1} / 04</p>
                  <h2 ref={headingRef} tabIndex={-1}>
                    {
                      [
                        "Your application.",
                        "Bring your experience.",
                        "Share your documents.",
                        "Ready for your next step?",
                      ][step]
                    }
                  </h2>
                  <p>
                    {
                      [
                        `Applying for ${job.title}${fairRole ? " as a Filipino applicant" : ""}. Start with the details we’ll use to contact you.`,
                        "Show us the skills and experience you bring to this role.",
                        "Upload your CV and attach any supporting documents you would like to include.",
                        "Take a moment to check your details before sending.",
                      ][step]
                    }
                  </p>
                </div>
                <form
                  ref={formRef}
                  aria-label={`${job.title} application form`}
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (step < 3) continueStep();
                    else void submit();
                  }}
                >
                  <div className={styles.honeypot} aria-hidden="true">
                    <label htmlFor="website">Website</label>
                    <input
                      id="website"
                      name="website"
                      value={website}
                      onChange={(event) => setWebsite(event.target.value)}
                      tabIndex={-1}
                      autoComplete="off"
                    />
                  </div>
                  <div className={styles.formBody} key={step}>
                    {step === 0 && (
                      <div className={styles.grid}>
                        {input("fullName", "Full name", {
                          placeholder: "As you’d like to be addressed",
                          autoComplete: "name",
                          wide: true,
                        })}
                        {input("email", "Email address", {
                          placeholder: "you@example.com",
                          type: "email",
                          autoComplete: "email",
                        })}
                        {input("phone", "Contact number", {
                          placeholder: "+63 912 345 6789",
                          type: "tel",
                          autoComplete: "tel",
                        })}
                        {input("country", "Country of residence", {
                          placeholder: "e.g. Philippines",
                          autoComplete: "country-name",
                          wide: true,
                        })}
                        <div className={`${styles.field} ${styles.full}`}>
                          <label htmlFor="discoverySource">
                            Where did you discover us? <span>Optional</span>
                          </label>
                          <select
                            id="discoverySource"
                            name="discoverySource"
                            value={values.discoverySource || ""}
                            disabled={busy}
                            aria-invalid={Boolean(errors.discoverySource)}
                            aria-describedby={errors.discoverySource ? "discoverySource-error" : undefined}
                            onChange={(event) => update("discoverySource", event.target.value as DiscoverySource | "")}
                          >
                            <option value="">Select an option</option>
                            {discoverySources.map((source) => (
                              <option key={source} value={source}>{source}</option>
                            ))}
                          </select>
                          {errors.discoverySource && (
                            <p id="discoverySource-error" className={styles.fieldError}>
                              {errors.discoverySource}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    {step === 1 && (
                      <div className={styles.grid}>
                        {input("recentJobTitle", "Most recent job title", {
                          placeholder: "e.g. Warehouse Associate",
                        })}
                        {input(
                          "experienceYears",
                          "Years of relevant experience (minimum 3)",
                          { type: "number" },
                        )}
                        {input("skills", "Relevant skills", {
                          placeholder: "What are you particularly good at?",
                          wide: true,
                          textarea: true,
                        })}
                        {input("education", "Education / certifications", {
                          placeholder:
                            "Qualifications relevant to this position",
                          optional: true,
                          wide: true,
                        })}
                        {supportingUpload("diploma")}
                        {errors.documents && <p className={styles.fieldError} id="supporting-documents-error" role="alert">{errors.documents}</p>}
                        {input("summary", "Professional summary", {
                          placeholder:
                            "A few sentences about your experience and ambitions",
                          optional: true,
                          wide: true,
                          textarea: true,
                        })}
                      </div>
                    )}
                    {step === 2 && (
                      <>
                        <div className={styles.field}>
                          <label htmlFor="resume">
                            Resume / CV <span aria-label="required">*</span>
                          </label>
                          <div
                            className={`${styles.upload} ${errors.resume ? styles.uploadError : ""}`}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (!busy)
                                chooseFile(event.dataTransfer.files[0]);
                            }}
                          >
                            <Upload size={27} strokeWidth={1.3} />
                            <strong>
                              {resume
                                ? "Your resume is ready"
                                : "Drop your resume here"}
                            </strong>
                            <p>PDF, DOC or DOCX · Up to 5 MB</p>
                            <input
                              ref={fileRef}
                              id="resume"
                              type="file"
                              aria-required="true"
                              accept=".pdf,.doc,.docx"
                              onChange={(event) =>
                                chooseFile(event.target.files?.[0])
                              }
                              aria-invalid={Boolean(errors.resume)}
                              aria-describedby={
                                errors.resume ? "resume-error" : "resume-help"
                              }
                              disabled={busy}
                            />
                            <span id="resume-help" className={styles.fileHint}>
                              Choose a document
                            </span>
                          </div>
                          {errors.resume && (
                            <p id="resume-error" className={styles.fieldError}>
                              {errors.resume}
                            </p>
                          )}
                          {resume && (
                            <div className={styles.file}>
                              <FileText size={18} />
                              <div>
                                <strong>{resume.name}</strong>
                                <span>
                                  {(resume.size / 1024 / 1024).toFixed(2)} MB
                                </span>
                              </div>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setResume(null);
                                  idempotencyRef.current = null;
                                  if (fileRef.current)
                                    fileRef.current.value = "";
                                }}
                                aria-label="Remove resume"
                              >
                                <X size={18} />
                              </button>
                            </div>
                          )}
                        </div>
                        <section className={styles.requirements} aria-labelledby="supporting-documents-heading">
                          <h3 id="supporting-documents-heading">Supporting documents</h3>
                          <p className={styles.documentNote}>Attach the documents you have available. These uploads are optional. Keep your CV and all attachments together within 15 MB.</p>
                          {supportingDocumentTypes.filter(({ id }) => id !== "driver-license").map(({ id }) => supportingUpload(id))}
                          {errors.documents && <p className={styles.fieldError} id="supporting-documents-error" role="alert">{errors.documents}</p>}
                        </section>
                        <section
                          className={styles.requirements}
                          aria-labelledby="requirements-heading"
                        >
                          <h3 id="requirements-heading">
                            Requirements for {job.title}
                          </h3>
                          {fairRole ? (
                            <>
                              <p className={styles.roleGuidance}>
                                <strong>NC2 guidance:</strong> {fairRole.nc2}
                              </p>
                              {fairRole.focus && (
                                <p className={styles.roleGuidance}>
                                  {fairRole.focus}
                                </p>
                              )}
                              <p className={styles.documentNote}>
                                {fairDocumentTiming}
                              </p>
                            </>
                          ) : (
                            <p className={styles.documentNote}>
                              The recruitment team will confirm which documents
                              this role needs.
                            </p>
                          )}
                          <div className={styles.certificate}>
                            {input("nc2Certificate", "NC2 certificate category / details", {
                              optional: true,
                              placeholder: fairRole?.nc2 || "e.g. Electrical Installation and Maintenance NC II",
                              wide: true,
                            })}
                            <p className={styles.documentNote}>
                              Name the certificate you hold or are working toward.
                              You can attach a certificate above if it is available.
                              Certificate numbers are not needed.
                            </p>
                          </div>
                          {fairRole?.drivingLicenseIsPlus && (
                            <div className={styles.certificate}>
                              {input("driverLicenseDetails", "Driver’s license details", {
                                optional: true,
                                placeholder: "License type / category and issuing country",
                                wide: true,
                              })}
                              <p className={styles.documentNote}>
                                A driver’s license is a plus. You can apply without one.
                                A license number is not needed.
                              </p>
                              {supportingUpload("driver-license")}
                            </div>
                          )}
                          {Boolean(fairRole?.employers.length) && (
                            <div className={styles.field}>
                              <label htmlFor="preferredEmployer">
                                Preferred employer <span>Optional</span>
                              </label>
                              <select
                                id="preferredEmployer"
                                name="preferredEmployer"
                                value={values.preferredEmployer || ""}
                                disabled={busy}
                                aria-invalid={Boolean(errors.preferredEmployer)}
                                aria-describedby={errors.preferredEmployer ? "employer-help preferredEmployer-error" : "employer-help"}
                                onChange={(event) => update("preferredEmployer", event.target.value)}
                              >
                                <option value="">Open to all listed employers</option>
                                {fairRole?.employers.map((employer) => (
                                  <option key={employer.name} value={employer.name}>
                                    {employer.name}
                                  </option>
                                ))}
                              </select>
                              <p id="employer-help" className={styles.documentNote}>
                                Choose from the employers listed for this role.
                                Your preference will be reviewed by the recruitment team.
                              </p>
                              {errors.preferredEmployer && (
                                <p id="preferredEmployer-error" className={styles.fieldError}>
                                  {errors.preferredEmployer}
                                </p>
                              )}
                            </div>
                          )}
                        </section>
                        <div className={styles.cover}>
                          {input(
                            "coverLetter",
                            "Cover letter / additional information",
                            {
                              optional: true,
                              wide: true,
                              textarea: true,
                              placeholder:
                                "What would you like the recruitment team to know?",
                            },
                          )}
                        </div>
                        <p className={styles.documentNote}>
                          Your CV and supporting documents are private. Attach only
                          documents relevant to your application.
                        </p>
                      </>
                    )}
                    {step === 3 && (
                      <>
                        <div className={styles.reviewJob}>
                          <span>Applying for</span>
                          <h3>{job.title}</h3>
                          <p>
                            {job.location}
                          </p>
                          <JobSalary job={job} compact />
                          {job.salaryStatus === "proposed-net" && <p>{job.openings} positions available.</p>}
                        </div>
                        <ReviewSection
                          title="Personal details"
                          onEdit={() => goTo(0)}
                          items={[
                            ["Full name", values.fullName],
                            ["Email", values.email],
                            ["Phone", values.phone],
                            ["Country of residence", values.country],
                            ["Where did you discover us?", values.discoverySource || "Not provided"],
                          ]}
                        />
                        <ReviewSection
                          title="Professional background"
                          onEdit={() => goTo(1)}
                          items={[
                            ["Recent role", values.recentJobTitle],
                            ["Experience", `${values.experienceYears} years`],
                            ["Skills", values.skills],
                            ["Education", values.education || "Not provided"],
                            ["Summary", values.summary || "Not provided"],
                          ]}
                        />
                        <ReviewSection
                          title="Documents"
                          onEdit={() => goTo(2)}
                          items={[
                            ["Resume", resume?.name || "Not selected"],
                            ...supportingDocumentTypes.filter(({ id }) => id !== "driver-license" || fairRole?.drivingLicenseIsPlus).map(({ id, label }): [string, string] => [label, supportingFiles[id]?.name || "Not attached"]),
                            ["NC2 certificate", values.nc2Certificate || "Not provided"],
                            ...(fairRole?.drivingLicenseIsPlus ? [["Driver’s license details", values.driverLicenseDetails || "Not provided"] as [string, string]] : []),
                            ...(fairRole
                              ? [[
                                  "Preferred employer",
                                  values.preferredEmployer || "Open to all listed employers",
                                ] as [string, string]]
                              : []),
                            [
                              "Cover letter",
                              values.coverLetter || "Not provided",
                            ],
                          ]}
                        />
                        <div className={styles.privacyNotice}>
                          <LockKeyhole size={20} />
                          <p>
                            Your details and uploaded documents will be used to assess this
                            application and contact you about this opportunity.
                            Application details are saved for recruitment review.
                            Your files are stored privately
                            and are available only to authorized staff. Read
                            our <Link href="/privacy">privacy notice</Link> for
                            data handling and deletion information.
                          </p>
                        </div>
                        <label className={styles.consent}>
                          <input
                            id="consent"
                            type="checkbox"
                            aria-required="true"
                            checked={values.consent}
                            onChange={(event) =>
                              update("consent", event.target.checked)
                            }
                            aria-invalid={Boolean(errors.consent)}
                            aria-describedby={
                              errors.consent ? "consent-error" : undefined
                            }
                            disabled={busy}
                          />
                          <span>
                            I have read the privacy notice and consent to the
                            processing of my information for this application. I
                            confirm my details are accurate.
                            {job.isExample &&
                              " I understand this is a development example vacancy."}
                          </span>
                        </label>
                        {errors.consent && (
                          <p id="consent-error" className={styles.fieldError}>
                            {errors.consent}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  {error && (
                    <div className={styles.error} role="alert">
                      {error}
                    </div>
                  )}
                  {busy && (
                    <div className={styles.progress} role="status">
                      <div>
                        <span>
                          {progress < 100
                            ? "Uploading your application"
                            : "Confirming receipt…"}
                        </span>
                        <span>{progress}%</span>
                      </div>
                      <progress
                        value={progress}
                        max={100}
                        aria-label="Application upload progress"
                      />
                    </div>
                  )}
                  <div className={styles.actions}>
                    {step > 0 ? (
                      <button
                        type="button"
                        className={styles.previous}
                        onClick={() => goTo(step - 1)}
                        disabled={busy}
                      >
                        <ArrowLeft size={17} /> Previous step
                      </button>
                    ) : (
                      <span className={styles.required}>
                        * Required information
                      </span>
                    )}
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={busy}
                    >
                      {busy
                        ? "Submitting…"
                        : step === 3
                          ? "Submit application"
                          : "Continue"}
                      <ArrowRight size={18} />
                    </button>
                  </div>
                  <p className={styles.saveNote}>
                    Your application is sent only when you choose “Submit
                    application”.
                  </p>
                </form>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ReviewSection({
  title,
  items,
  onEdit,
}: {
  title: string;
  items: [string, string][];
  onEdit: () => void;
}) {
  return (
    <section className={styles.reviewSection}>
      <div>
        <h3>{title}</h3>
        <button type="button" onClick={onEdit}>
          Edit <ArrowUpRight size={14} />
        </button>
      </div>
      <dl>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
