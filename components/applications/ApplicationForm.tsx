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
import { applicantGenders, discoverySources, type ApplicantDetails, type ApplicationInput, type DiscoverySource, type Job } from "@/lib/types";
import { BrandLockup } from "@/components/ui/Brand";
import { proposedJobs } from "@/data/jobs";
import { JobSalary } from "@/components/jobs/JobSalary";
import { minimumExperienceYears } from "@/data/employment";
import { NoPlacementFee } from "@/components/jobs/EmploymentBenefits";
import { MAX_APPLICATION_UPLOAD_BYTES, MAX_SUPPORTING_DOCUMENT_BYTES, SUPPORTING_DOCUMENT_ACCEPT, supportingDocumentTypes, type SupportingDocumentCategory } from "@/lib/document-uploads";
import { getJobFairRole } from "@/data/job-fair";
import styles from "./ApplicationForm.module.css";

type FormErrors = Partial<Record<keyof ApplicationInput | `applicantDetails.${keyof ApplicantDetails}` | "resume" | "documents", string>>;
const steps = [
  "Complete your application",
  "Review & submit",
];
const maxResumeBytes = 5 * 1024 * 1024;
function validate(
  values: ApplicationInput,
  step: number,
  resume: File | null,
): FormErrors {
  const errors: FormErrors = {};
  if (step === 0) {
    const details = values.applicantDetails;
    if (details) {
      if (!details.firstName.trim()) errors["applicantDetails.firstName"] = "Enter your first name as it appears on your passport.";
      if (!details.lastName.trim()) errors["applicantDetails.lastName"] = "Enter your last name as it appears on your passport.";
      if (`${details.firstName.trim()} ${details.lastName.trim()}`.length > 120)
        errors["applicantDetails.firstName"] = "Keep your combined first and last names within 120 characters.";
      if (details.nationality.trim().length < 2) errors["applicantDetails.nationality"] = "Enter your nationality.";
      if (details.currentAddress.trim().length < 2) errors["applicantDetails.currentAddress"] = "Enter your current address.";
      if (details.placeOfBirth.trim().length < 2) errors["applicantDetails.placeOfBirth"] = "Enter your place of birth.";
      const birthDate = new Date(`${details.dateOfBirth}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(details.dateOfBirth) || !Number.isFinite(birthDate.getTime()) ||
        birthDate.toISOString().slice(0, 10) !== details.dateOfBirth || details.dateOfBirth > new Date().toISOString().slice(0, 10))
        errors["applicantDetails.dateOfBirth"] = "Enter a valid date of birth that is not in the future.";
      if (details.gender && !applicantGenders.some((gender) => gender === details.gender)) errors["applicantDetails.gender"] = "Choose one of the listed options.";
    } else if (values.fullName.trim().length < 2) errors.fullName = "Enter your full name.";
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
    if (values.applicantDetails && !["Yes", "No"].includes(values.applicantDetails.englishProficiency))
      errors["applicantDetails.englishProficiency"] = "Tell us whether you can speak, read and write basic English.";
  }
  if (step === 2) {
    if ((values.nc2Certificate || "").trim().length > 200)
      errors.nc2Certificate = "Keep your certificate details within 200 characters.";
    if ((values.driverLicenseDetails || "").trim().length > 200)
      errors.driverLicenseDetails = "Keep your license details within 200 characters.";
    if (!resume) errors.resume = "Please upload your resume or CV.";
    else if (!resume.size)
      errors.resume = "Choose a CV that is not empty.";
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
    applicantDetails: {
      firstName: "", lastName: "", gender: "", nationality: "", telegram: "",
      currentAddress: "", dateOfBirth: "", placeOfBirth: "", fatherName: "", motherName: "",
      secondaryPosition: "", otherPosition: "", englishProficiency: "" as ApplicantDetails["englishProficiency"],
    },
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

  function updateDetails<K extends keyof ApplicantDetails>(key: K, value: ApplicantDetails[K]) {
    idempotencyRef.current = null;
    setValues((current) => {
      const applicantDetails = { ...current.applicantDetails!, [key]: value };
      return { ...current, applicantDetails,
        fullName: `${applicantDetails.firstName.trim()} ${applicantDetails.lastName.trim()}`.trim() };
    });
    setErrors((current) => ({ ...current, [`applicantDetails.${key}`]: undefined, fullName: undefined,
      ...(key === "firstName" || key === "lastName" ? { "applicantDetails.firstName": undefined, "applicantDetails.lastName": undefined } : {}) }));
  }

  function goTo(next: number) {
    setStep(next === 3 ? 3 : 0);
    setError("");
    setErrors({});
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function showErrors(nextErrors: FormErrors) {
    setErrors(nextErrors);
    requestAnimationFrame(() => {
      const invalid = formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']");
      if (invalid?.tagName === "FIELDSET") invalid.querySelector<HTMLInputElement>("input")?.focus();
      else if (invalid) invalid.focus();
      else formRef.current?.querySelector<HTMLElement>("#supporting-documents-error")?.focus();
    });
  }

  function continueStep() {
    const nextErrors = { ...validate(values, 0, resume), ...validate(values, 1, resume), ...validate(values, 2, resume) };
    const documentError = checkSupportingFiles();
    if (documentError) nextErrors.documents = documentError;
    if (Object.keys(nextErrors).length) {
      showErrors(nextErrors);
      return;
    }
    goTo(3);
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
    if (documentError) { setStep(0); showErrors({ documents: documentError }); return; }
    for (let index = 0; index < 4; index++) {
      const nextErrors = validate(values, index, resume);
      if (Object.keys(nextErrors).length) {
        setStep(index === 3 ? 3 : 0);
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
          setStep(Object.keys(response.fieldErrors).some((key) => key !== "consent") ? 0 : 3);
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
    const invalid = Boolean(errors.documents?.startsWith(`${label}:`));
    return (
      <div className={`${styles.field} ${styles.wide} ${styles.documentUpload}`} key={category}>
        <label htmlFor={`attachment-${category}`}>{label} <span>Optional</span></label>
        <input id={`attachment-${category}`} type="file" accept={SUPPORTING_DOCUMENT_ACCEPT} disabled={busy}
          ref={(element) => { documentRefs.current[category] = element; }} aria-invalid={invalid}
          aria-describedby={`attachment-${category}-help${invalid ? " supporting-documents-error" : ""}`}
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

  function detailInput(key: keyof ApplicantDetails, label: string, options: {
    optional?: boolean; wide?: boolean; type?: string; placeholder?: string; autoComplete?: string; textarea?: boolean;
  } = {}) {
    const errorKey = `applicantDetails.${key}` as const;
    const limits: Partial<Record<keyof ApplicantDetails, number>> = {
      firstName: 60, lastName: 60, nationality: 80, telegram: 80, currentAddress: 500,
      placeOfBirth: 160, fatherName: 120, motherName: 120, otherPosition: 160,
    };
    const props = {
      id: errorKey, name: errorKey, value: values.applicantDetails?.[key] || "",
      disabled: busy, "aria-invalid": Boolean(errors[errorKey]), "aria-required": !options.optional,
      "aria-describedby": errors[errorKey] ? `${errorKey}-error` : undefined,
      placeholder: options.placeholder, maxLength: limits[key], autoComplete: options.autoComplete,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateDetails(key, event.target.value as ApplicantDetails[typeof key]),
    };
    return (
      <div className={`${styles.field} ${options.wide ? styles.full : ""}`}>
        <label htmlFor={errorKey}>{label}<span>{options.optional ? "Optional" : <span aria-label="required">*</span>}</span></label>
        {options.textarea ? <textarea {...props} rows={3} /> :
          <input {...props} type={options.type || "text"} max={options.type === "date" ? new Date().toISOString().slice(0, 10) : undefined} />}
        {errors[errorKey] && <p id={`${errorKey}-error`} className={styles.fieldError}>{errors[errorKey]}</p>}
      </div>
    );
  }

  function choices(key: "gender" | "englishProficiency", label: string, options: readonly string[], optional = false) {
    const errorKey = `applicantDetails.${key}` as const;
    return (
      <fieldset className={`${styles.field} ${styles.full}`} role="radiogroup" aria-required={!optional}
        aria-invalid={Boolean(errors[errorKey])} aria-describedby={errors[errorKey] ? `${errorKey}-error` : undefined}>
        <legend className={styles.choiceLabel}>{label} <span>{optional ? "Optional" : <span aria-label="required">*</span>}</span></legend>
        <div className={styles.choiceGroup}>
          {options.map((option) => (
            <label key={option} className={`${styles.choiceCard} ${values.applicantDetails?.[key] === option ? styles.choiceSelected : ""}`}>
              <input className={styles.radio} type="radio" name={errorKey} value={option}
                checked={values.applicantDetails?.[key] === option} disabled={busy}
                onChange={() => updateDetails(key, option as ApplicantDetails[typeof key])} />
              <span className={styles.choiceCopy}>{option}</span>
            </label>
          ))}
        </div>
        {errors[errorKey] && <p id={`${errorKey}-error`} className={styles.fieldError}>{errors[errorKey]}</p>}
      </fieldset>
    );
  }

  return (
    <div className={styles.page}>
      <div className="container">
        <Link href={`/jobs/${job.slug}`} className={styles.back}><ArrowLeft size={16} /> Back to the opportunity</Link>
        <div className={styles.shell}>
          <header className={styles.masthead}>
            <div className={styles.mastheadBrand}><BrandLockup /></div>
            <div className={styles.mastheadCopy}>
              <p className="eyebrow">Your next chapter starts here</p>
              <h1>Great opportunities.<br /><span>Let’s start with you.</span></h1>
              <p>Tell us about yourself, share your experience and take the next step toward working in Croatia.</p>
            </div>
            <div className={styles.mastheadBadge}><NoPlacementFee /></div>
          </header>

          <div className={styles.layout}>
            <section className={styles.roleSummary} aria-label="Selected opportunity">
              <div className={styles.roleImage}>
                <Image src={job.image} alt={job.imageAlt} fill sizes="160px"
                  style={{ objectFit: "cover", objectPosition: job.imagePosition || "center" }} />
              </div>
              <div className={styles.roleSummaryContent}>
                <p className="eyebrow">You’re applying for</p>
                <h2>{job.title}</h2>
                <p><MapPin size={15} aria-hidden="true" /> {job.location} <span>· Minimum {minimumExperienceYears} years of relevant experience</span></p>
                <JobSalary job={job} compact />
                <Link href={`/jobs/${job.slug}#overview`} target="_blank" rel="noopener noreferrer">
                  View role details <ArrowUpRight size={15} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
                </Link>
              </div>
            </section>
            {job.isExample && <p className={styles.example}><strong>Development example vacancy.</strong> Use fictitious details for this demonstration application.</p>}

            <section className={styles.formSection}>
              {result ? (
                <div className={styles.success}>
                  <CheckCircle2 size={56} strokeWidth={1.5} />
                  <p className="eyebrow">Application received</p>
                  <h2 ref={headingRef} tabIndex={-1}>Your next chapter<br />is one step closer.</h2>
                  <p>Application submitted successfully for <strong>{result.jobTitle}</strong>.</p>
                  <div className={styles.reference}>
                    <span>Your application reference</span><strong>{result.reference}</strong>
                    <button type="button" onClick={async () => {
                      try { await navigator.clipboard.writeText(result.reference); setCopyNotice("Reference copied."); }
                      catch { setCopyNotice("Select and copy the reference above to save it."); }
                    }}>Copy reference <FileText size={14} /></button>
                    {copyNotice && <span role="status">{copyNotice}</span>}
                  </div>
                  <p>Save this reference for your records. The recruitment team will review your application and contact you about the next steps for this role.</p>
                  {job.isExample && <p className={styles.example}>This submission is stored as a development example.</p>}
                  <Link href="/jobs" className="button button-primary">Explore more opportunities <ArrowUpRight size={18} /></Link>
                </div>
              ) : (
                <>
                  <ol className={styles.steps} aria-label="Application progress">
                    {steps.map((label, index) => {
                      const current = step === 3 ? 1 : 0;
                      return <li key={label} className={`${index === current ? styles.current : ""} ${index < current ? styles.completed : ""}`}
                        aria-current={index === current ? "step" : undefined}>
                        <span>{index < current ? <Check size={16} /> : `0${index + 1}`}</span><div>{label}</div>
                      </li>;
                    })}
                  </ol>
                  <div className={styles.formHeading}>
                    <p className="eyebrow">{step === 3 ? "One last look" : "Welcome. We’re glad you’re here."}</p>
                    <h2 ref={headingRef} tabIndex={-1}>{step === 3 ? "Ready for your next step?" : "Tell us about yourself."}</h2>
                    <p>{step === 3 ? "Check your answers and documents before sending your application." : "Use your name and personal details as they appear on your passport. Fields marked * are required."}</p>
                  </div>
                  <form ref={formRef} aria-label={`${job.title} application form`} noValidate onSubmit={(event) => {
                    event.preventDefault(); if (step === 3) void submit(); else continueStep();
                  }}>
                    <div className={styles.honeypot} aria-hidden="true">
                      <label htmlFor="website">Website</label>
                      <input id="website" name="website" value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" />
                    </div>
                    <div className={styles.formBody} key={step}>
                      {step === 0 ? (
                        <>
                          <nav className={styles.sectionLinks} aria-label="Application sections">
                            <a href="#personal-details">01 Personal details</a><a href="#work-experience">02 Work experience</a>
                            <a href="#application-documents">03 Documents</a><a href="#important-notices">04 Before you continue</a>
                          </nav>
                          <section id="personal-details" className={styles.sectionCard} aria-labelledby="personal-details-heading">
                            <SectionHeading number="01" id="personal-details-heading" title="Personal details" description="Let’s get to know you and the best way to reach you." />
                            <div className={styles.grid}>
                              {detailInput("firstName", "First name", { placeholder: "As shown on your passport", autoComplete: "given-name" })}
                              {detailInput("lastName", "Last name", { placeholder: "As shown on your passport", autoComplete: "family-name" })}
                              {choices("gender", "Gender", applicantGenders, true)}
                              {input("email", "Email address", { placeholder: "you@example.com", type: "email", autoComplete: "email" })}
                              {detailInput("nationality", "Nationality", { placeholder: "e.g. Filipino" })}
                              {input("phone", "WhatsApp number", { placeholder: "+63 912 345 6789", type: "tel", autoComplete: "tel" })}
                              {detailInput("telegram", "Telegram number / username", { placeholder: "Your active Telegram contact", optional: true })}
                              {detailInput("currentAddress", "Current address", { placeholder: "Street, city, province / region and postal code", autoComplete: "street-address", wide: true, textarea: true })}
                              {input("country", "Country you currently live or work in", { placeholder: "e.g. Philippines", autoComplete: "country-name", wide: true })}
                              {detailInput("dateOfBirth", "Date of birth", { type: "date", autoComplete: "bday" })}
                              {detailInput("placeOfBirth", "Place of birth", { placeholder: "City / province and country" })}
                              {detailInput("fatherName", "Father’s full name", { optional: true, placeholder: "Full name" })}
                              {detailInput("motherName", "Mother’s full name", { optional: true, placeholder: "Full name" })}
                              <div className={`${styles.field} ${styles.full}`}>
                                <label htmlFor="discoverySource">Where did you discover us? <span>Optional</span></label>
                                <select id="discoverySource" name="discoverySource" value={values.discoverySource || ""} disabled={busy}
                                  aria-invalid={Boolean(errors.discoverySource)} aria-describedby={errors.discoverySource ? "discoverySource-error" : undefined}
                                  onChange={(event) => update("discoverySource", event.target.value as DiscoverySource | "")}>
                                  <option value="">Select an option</option>
                                  {discoverySources.map((source) => <option key={source} value={source}>{source}</option>)}
                                </select>
                                {errors.discoverySource && <p id="discoverySource-error" className={styles.fieldError}>{errors.discoverySource}</p>}
                              </div>
                            </div>
                          </section>

                          <section id="work-experience" className={styles.sectionCard} aria-labelledby="work-experience-heading">
                            <SectionHeading number="02" id="work-experience-heading" title="Your work experience" description="Choose roles that match your experience and tell us what you do best." />
                            <div className={styles.grid}>
                              <div className={styles.field}><label htmlFor="application-country">Country you’re applying to</label><input id="application-country" value="Croatia" readOnly /></div>
                              <div className={styles.field}>
                                <label htmlFor="primary-position">Primary job position</label><input id="primary-position" value={job.title} readOnly />
                                <p className={styles.formNote}>Looking for another role? <Link href="/jobs">Browse all opportunities.</Link></p>
                              </div>
                              <div className={`${styles.field} ${styles.full}`}>
                                <label htmlFor="applicantDetails.secondaryPosition">Another position you have experience in <span>Optional</span></label>
                                <select id="applicantDetails.secondaryPosition" name="applicantDetails.secondaryPosition" value={values.applicantDetails?.secondaryPosition || ""}
                                  disabled={busy} aria-invalid={Boolean(errors["applicantDetails.secondaryPosition"])}
                                  aria-describedby={errors["applicantDetails.secondaryPosition"] ? "secondary-position-error" : undefined}
                                  onChange={(event) => updateDetails("secondaryPosition", event.target.value)}>
                                  <option value="">Select another position</option>
                                  {proposedJobs.filter((role) => role.title !== job.title).map((role) => <option key={role.id} value={role.title}>{role.title}</option>)}
                                </select>
                                {errors["applicantDetails.secondaryPosition"] && <p id="secondary-position-error" className={styles.fieldError}>{errors["applicantDetails.secondaryPosition"]}</p>}
                              </div>
                              {detailInput("otherPosition", "Is your experienced role not listed? Tell us here.", { optional: true, wide: true, placeholder: "Another role you have worked in" })}
                              {input("recentJobTitle", "Most recent job title", { placeholder: "e.g. Fabricator" })}
                              {input("experienceYears", "Years of relevant experience", { type: "number", placeholder: "Minimum 3 years" })}
                              {input("skills", "What relevant skills do you bring?", { placeholder: "Your trade skills, equipment, tools and specialist experience", wide: true, textarea: true })}
                              {input("education", "Education / qualifications", { optional: true, wide: true, placeholder: "School, diploma, degree or relevant qualifications" })}
                              {input("summary", "Tell us a little more about your experience", { optional: true, wide: true, textarea: true, placeholder: "Your recent work, achievements and goals" })}
                              {Boolean(fairRole?.employers.length) && <div className={`${styles.field} ${styles.full}`}>
                                <label htmlFor="preferredEmployer">Preferred employer <span>Optional</span></label>
                                <select id="preferredEmployer" name="preferredEmployer" value={values.preferredEmployer || ""} disabled={busy}
                                  aria-invalid={Boolean(errors.preferredEmployer)} aria-describedby={errors.preferredEmployer ? "preferredEmployer-error" : undefined}
                                  onChange={(event) => update("preferredEmployer", event.target.value)}>
                                  <option value="">Open to all listed employers</option>
                                  {fairRole?.employers.map((employer) => <option key={employer.name} value={employer.name}>{employer.name}</option>)}
                                </select>
                                {errors.preferredEmployer && <p id="preferredEmployer-error" className={styles.fieldError}>{errors.preferredEmployer}</p>}
                              </div>}
                            </div>
                          </section>

                          <section id="application-documents" className={styles.sectionCard} aria-labelledby="application-documents-heading">
                            <SectionHeading number="03" id="application-documents-heading" title="Share your documents" description="Upload an updated CV. You can also include clear scans or photos of the supporting documents you have ready." />
                            <div className={styles.field}>
                              <label htmlFor="resume">Your CV / resume <span aria-label="required">*</span></label>
                              <div className={`${styles.upload} ${errors.resume ? styles.uploadError : ""}`}
                                onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) chooseFile(event.dataTransfer.files[0]); }}>
                                <Upload size={30} strokeWidth={1.6} aria-hidden="true" />
                                <strong>{resume ? "Your CV is ready" : "Choose a file or drop your CV here"}</strong>
                                <p>PDF, DOC or DOCX · Maximum 5 MB</p>
                                <input ref={fileRef} id="resume" type="file" aria-required="true" accept=".pdf,.doc,.docx"
                                  onChange={(event) => chooseFile(event.target.files?.[0])} aria-invalid={Boolean(errors.resume)}
                                  aria-describedby={errors.resume ? "resume-help resume-error" : "resume-help"} disabled={busy} />
                                <span id="resume-help" className={styles.fileHint}>Browse files</span>
                              </div>
                              {errors.resume && <p id="resume-error" className={styles.fieldError}>{errors.resume}</p>}
                              {resume && <div className={styles.file}><FileText size={20} aria-hidden="true" /><div><strong>{resume.name}</strong><span>{(resume.size / 1024 / 1024).toFixed(2)} MB</span></div>
                                <button type="button" disabled={busy} aria-label="Remove CV" onClick={() => { setResume(null); idempotencyRef.current = null; if (fileRef.current) fileRef.current.value = ""; }}><X size={18} /></button>
                              </div>}
                            </div>
                            <div className={styles.noticeCard}>
                              <FileText size={21} aria-hidden="true" /><div><strong>Supporting documents are optional.</strong><p>Add what you have ready. Keep your CV and all files together within 15 MB. For IDs, combine the front and back in one file.</p></div>
                            </div>
                            <div className={styles.uploadsGrid}>
                              {(["passport", "residence-id", "diploma", "employment-certificate", "nc2", "driver-license", "nbi", "form18a", "other"] as SupportingDocumentCategory[])
                                .filter((category) => category !== "driver-license" || fairRole?.drivingLicenseIsPlus).map((category) => supportingUpload(category))}
                            </div>
                            {errors.documents && <p className={styles.fieldError} id="supporting-documents-error" role="alert" tabIndex={-1}>{errors.documents}</p>}
                            <div className={styles.grid}>
                              {input("nc2Certificate", "NC2 / TESDA certificate details", { optional: true, wide: true, placeholder: "Certificate name or category; no certificate number needed" })}
                              {fairRole?.drivingLicenseIsPlus && input("driverLicenseDetails", "Driver’s license details", { optional: true, wide: true, placeholder: "License type / category and issuing country; no license number needed" })}
                            </div>
                            {fairRole && <p className={styles.formNote}><strong>For this role:</strong> {fairRole.nc2}{fairRole.drivingLicenseIsPlus ? " A driver’s license is a plus, and is optional." : ""}</p>}
                            <p className={styles.private}><LockKeyhole size={17} aria-hidden="true" /> Your uploads are private and available only to authorized recruitment staff.</p>
                          </section>

                          <section id="important-notices" className={styles.sectionCard} aria-labelledby="important-notices-heading">
                            <SectionHeading number="04" id="important-notices-heading" title="Before you continue" description="A few final details to help the recruitment team understand your application." />
                            <div className={styles.grid}>
                              {choices("englishProficiency", "Can you speak, read and write English at a basic level?", ["Yes", "No"])}
                              {input("coverLetter", "Anything else you’d like us to know?", { optional: true, wide: true, textarea: true, placeholder: "A cover letter or any other information relevant to your application" })}
                            </div>
                            <div className={styles.feeNote}><NoPlacementFee /><p>There is no placement fee to apply through Jobs Street Croatia.</p></div>
                            <p className={styles.formNote}>Next, you’ll review your answers and read the privacy notice before sending your application.</p>
                          </section>
                        </>
                      ) : (
                        <div className={styles.sectionCard}>
                          <ReviewSection title="Personal details" onEdit={() => goTo(0)} items={[
                            ["Full name", values.fullName], ["Gender", values.applicantDetails?.gender || "Not provided"],
                            ["Nationality", values.applicantDetails?.nationality || "Not provided"], ["Email", values.email],
                            ["WhatsApp", values.phone], ["Telegram", values.applicantDetails?.telegram || "Not provided"],
                            ["Current address", values.applicantDetails?.currentAddress || "Not provided"], ["Current country", values.country],
                            ["Date of birth", values.applicantDetails?.dateOfBirth || "Not provided"], ["Place of birth", values.applicantDetails?.placeOfBirth || "Not provided"],
                            ["Father’s name", values.applicantDetails?.fatherName || "Not provided"], ["Mother’s name", values.applicantDetails?.motherName || "Not provided"],
                            ["Discovered us through", values.discoverySource || "Not provided"],
                          ]} />
                          <ReviewSection title="Work experience" onEdit={() => goTo(0)} items={[
                            ["Country applying to", "Croatia"], ["Primary position", job.title],
                            ["Another experienced position", values.applicantDetails?.secondaryPosition || "Not provided"],
                            ["Other position", values.applicantDetails?.otherPosition || "Not provided"],
                            ["Most recent role", values.recentJobTitle], ["Experience", `${values.experienceYears} years`], ["Skills", values.skills],
                            ["Education", values.education || "Not provided"], ["Professional summary", values.summary || "Not provided"],
                            ["Basic English", values.applicantDetails?.englishProficiency || "Not provided"],
                            ["Preferred employer", values.preferredEmployer || "Open to all listed employers"],
                          ]} />
                          <ReviewSection title="Documents & additional information" onEdit={() => goTo(0)} items={[
                            ["CV / resume", resume?.name || "Not selected"],
                            ...supportingDocumentTypes.filter(({ id }) => id !== "driver-license" || fairRole?.drivingLicenseIsPlus)
                              .map(({ id, label }): [string, string] => [label, supportingFiles[id]?.name || "Not attached"]),
                            ["NC2 certificate details", values.nc2Certificate || "Not provided"],
                            ...(fairRole?.drivingLicenseIsPlus ? [["Driver’s license details", values.driverLicenseDetails || "Not provided"] as [string, string]] : []),
                            ["Additional information", values.coverLetter || "Not provided"],
                          ]} />
                          <div className={styles.privacyNotice}><LockKeyhole size={21} aria-hidden="true" /><p>
                            Your answers and documents will be used to assess this application and contact you about this opportunity. Your files are stored privately and are available only to authorized staff.
                            Read our <Link href="/privacy" target="_blank" rel="noopener noreferrer">privacy notice<span className="sr-only"> (opens in a new tab)</span></Link> for data handling and deletion information.
                          </p></div>
                          <label className={styles.consent}><input id="consent" type="checkbox" aria-required="true" checked={values.consent}
                            onChange={(event) => update("consent", event.target.checked)} aria-invalid={Boolean(errors.consent)}
                            aria-describedby={errors.consent ? "consent-error" : undefined} disabled={busy} />
                            <span>I have read the privacy notice and consent to the processing of my information for this application. I confirm my details are accurate.{job.isExample && " I understand this is a development example vacancy."}</span>
                          </label>
                          {errors.consent && <p id="consent-error" className={styles.fieldError}>{errors.consent}</p>}
                        </div>
                      )}
                    </div>
                    {error && <div className={styles.error} role="alert">{error}</div>}
                    {busy && <div className={styles.progress} role="status"><div><span>{progress < 100 ? "Uploading your application" : "Confirming receipt…"}</span><span>{progress}%</span></div><progress value={progress} max={100} aria-label="Application upload progress" /></div>}
                    <div className={styles.actions}>
                      {step === 3 ? <button type="button" className={styles.previous} onClick={() => goTo(0)} disabled={busy}><ArrowLeft size={17} /> Edit application</button> : <span className={styles.required}>* Required information</span>}
                      <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Submitting…" : step === 3 ? "Submit application" : "Review my application"}<ArrowRight size={18} /></button>
                    </div>
                    <p className={styles.saveNote}><LockKeyhole size={14} aria-hidden="true" /> Your application is sent only when you choose “Submit application”.</p>
                  </form>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ number, title, description, id }: { number: string; title: string; description: string; id: string }) {
  return <div className={styles.sectionHeading}><span className={styles.sectionNumber} aria-hidden="true">{number}</span><div><h3 id={id} className={styles.sectionTitle}>{title}</h3><p className={styles.sectionIntro}>{description}</p></div></div>;
}

function ReviewSection({ title, items, onEdit }: { title: string; items: [string, string][]; onEdit: () => void }) {
  return <section className={styles.reviewSection}><div><h3>{title}</h3><button type="button" onClick={onEdit}>Edit <ArrowUpRight size={14} /></button></div><dl>{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>;
}
