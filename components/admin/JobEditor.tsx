"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ArrowRight, ImagePlus, X } from "lucide-react";
import type { Job } from "@/lib/types";
import { AdminApiError, adminRequest, errorMessage } from "./api";
import styles from "./Admin.module.css";

const blankJob: Omit<Job, "id"> = {
  slug: "",
  title: "",
  category: "",
  location: "",
  employmentType: "Full-time",
  summary: "",
  description: "",
  responsibilities: [],
  requirements: [],
  benefits: [],
  experience: "",
  image: "",
  imageAlt: "",
  imagePosition: "center",
  postedAt: new Date().toISOString().slice(0, 10),
  status: "draft",
  isExample: true,
  featured: false,
  salary: "",
  schedule: "",
  contract: "",
};

export default function JobEditor({
  job,
  onCancel,
  onSaved,
  onSessionExpired,
}: {
  job?: Job;
  onCancel: () => void;
  onSaved: (job: Job) => void;
  onSessionExpired: () => void;
}) {
  const [values, setValues] = useState<Omit<Job, "id">>(job || blankJob);
  const [responsibilities, setResponsibilities] = useState(
    job?.responsibilities.join("\n") || "",
  );
  const [requirements, setRequirements] = useState(
    job?.requirements.join("\n") || "",
  );
  const [benefits, setBenefits] = useState(job?.benefits.join("\n") || "");
  const [openingsMode, setOpeningsMode] = useState<"none" | "exact" | "range">(
    job?.openingsRange ? "range" : job?.openings !== undefined ? "exact" : "none",
  );
  const [exactOpenings, setExactOpenings] = useState(job?.openings?.toString() || "");
  const [minimumOpenings, setMinimumOpenings] = useState(job?.openingsRange?.min.toString() || "");
  const [maximumOpenings, setMaximumOpenings] = useState(job?.openingsRange?.max.toString() || "");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [photoNotice, setPhotoNotice] = useState("");
  const lock = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  function update<K extends keyof Omit<Job, "id">>(
    key: K,
    value: Omit<Job, "id">[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  }

  async function upload(file: File | undefined) {
    if (!file || uploading) return;
    if (
      !/^image\/(jpeg|png|webp)$/.test(file.type) ||
      file.size > 8 * 1024 * 1024
    ) {
      setError("Choose a JPG, PNG or WebP photo, up to 8 MB.");
      return;
    }
    setUploading(true);
    setError("");
    setPhotoNotice("");
    const body = new FormData();
    body.append("image", file);
    try {
      const result = await adminRequest<{ url: string }>("/api/admin/images", {
        method: "POST",
        body,
      });
      update("image", result.url);
      setPhotoNotice(
        "Photo uploaded. Save the opportunity to apply this image.",
      );
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401)
        onSessionExpired();
      else setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || uploading) return;
    const list = (text: string) =>
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    if (!list(responsibilities).length || !list(requirements).length) {
      setError("Add at least one responsibility and one requirement.");
      setFieldErrors({
        ...(!list(responsibilities).length
          ? { responsibilities: "Add at least one responsibility." }
          : {}),
        ...(!list(requirements).length
          ? { requirements: "Add at least one requirement." }
          : {}),
      });
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>("[aria-invalid='true']")
          ?.focus(),
      );
      return;
    }
    const validCount = (value: string) => value.trim() !== "" && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10000;
    if (openingsMode === "exact" && !validCount(exactOpenings)) {
      const message = "Enter a whole number of positions from 1 to 10,000.";
      setError(message);
      setFieldErrors({ openings: message });
      return;
    }
    if (openingsMode === "range" && (!validCount(minimumOpenings) || !validCount(maximumOpenings) || Number(minimumOpenings) > Number(maximumOpenings))) {
      const message = "Enter whole numbers from 1 to 10,000, with the minimum no higher than the maximum.";
      setError(message);
      setFieldErrors({ openingsRange: message });
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setFieldErrors({});
    const payload = {
      ...values,
      postedAt: new Date(values.postedAt).toISOString(),
      responsibilities: list(responsibilities),
      requirements: list(requirements),
      benefits: list(benefits),
      salary: values.salary || undefined,
      schedule: values.schedule || undefined,
      contract: values.contract || undefined,
      openings: openingsMode === "exact" ? Number(exactOpenings) : job ? null : undefined,
      openingsRange: openingsMode === "range" ? { min: Number(minimumOpenings), max: Number(maximumOpenings) } : job ? null : undefined,
    };
    try {
      const { job: saved } = await adminRequest<{ job: Job }>(
        job
          ? `/api/admin/jobs/${encodeURIComponent(job.id)}`
          : "/api/admin/jobs",
        {
          method: job ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      onSaved(saved);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401)
        onSessionExpired();
      else {
        setError(errorMessage(err));
        if (err instanceof AdminApiError && err.fieldErrors) {
          setFieldErrors(
            Object.fromEntries(
              Object.entries(err.fieldErrors).map(([key, message]) => [
                key.split(".")[0],
                message,
              ]),
            ),
          );
          requestAnimationFrame(() =>
            formRef.current
              ?.querySelector<HTMLElement>("[aria-invalid='true']")
              ?.focus(),
          );
        }
      }
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  const stringField = (
    key:
      | "title"
      | "slug"
      | "category"
      | "location"
      | "employmentType"
      | "summary"
      | "description"
      | "experience"
      | "image"
      | "imageAlt"
      | "imagePosition"
      | "postedAt"
      | "salary"
      | "schedule"
      | "contract",
    label: string,
    opts: {
      required?: boolean;
      textarea?: boolean;
      wide?: boolean;
      placeholder?: string;
      help?: string;
      max?: number;
    } = {},
  ) => (
    <label className={`${styles.field} ${opts.wide ? styles.full : ""}`}>
      {label}
      {opts.textarea ? (
        <textarea
          value={values[key] || ""}
          onChange={(event) => update(key, event.target.value)}
          required={opts.required}
          placeholder={opts.placeholder}
          rows={key === "description" ? 6 : 3}
          maxLength={opts.max || 10000}
          disabled={busy}
          aria-invalid={Boolean(fieldErrors[key])}
          aria-describedby={fieldErrors[key] ? `job-${key}-error` : undefined}
        />
      ) : (
        <input
          value={
            key === "postedAt"
              ? values.postedAt.slice(0, 10)
              : values[key] || ""
          }
          onChange={(event) => update(key, event.target.value)}
          required={opts.required}
          placeholder={opts.placeholder}
          type={key === "postedAt" ? "date" : "text"}
          pattern={key === "slug" ? "[a-z0-9]+(?:-[a-z0-9]+)*" : undefined}
          maxLength={opts.max || 300}
          disabled={busy}
          aria-invalid={Boolean(fieldErrors[key])}
          aria-describedby={fieldErrors[key] ? `job-${key}-error` : undefined}
        />
      )}
      {opts.help && <span className={styles.help}>{opts.help}</span>}
      {fieldErrors[key] && (
        <span id={`job-${key}-error`} className={styles.fieldError}>
          {fieldErrors[key]}
        </span>
      )}
    </label>
  );

  const canPreview =
    values.image.startsWith("/images/") ||
    values.image.startsWith("/api/images/") ||
    values.image.startsWith("https://images.unsplash.com/");
  return (
    <div className={styles.editor}>
      <div className={styles.editorHeading}>
        <div>
          <p className="eyebrow">Opportunity editor</p>
          <h2>
            {job ? "Refine the opportunity." : "Make room for possibility."}
          </h2>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className={styles.close}
          disabled={busy}
          aria-label="Close job editor"
        >
          <X size={23} />
        </button>
      </div>
      <form ref={formRef} onSubmit={(event) => void save(event)}>
        <div className={styles.editorGrid}>
          {stringField("title", "Position title *", {
            required: true,
            max: 160,
          })}
          {stringField("slug", "URL slug *", {
            required: true,
            placeholder: "warehouse-worker",
            help: "Lowercase words separated by hyphens.",
            max: 180,
          })}
          {stringField("category", "Industry *", {
            required: true,
            placeholder: "Logistics & Warehousing",
          })}
          {stringField("location", "Location *", { required: true })}
          {stringField("employmentType", "Employment type *", {
            required: true,
          })}
          {stringField("experience", "Required experience *", {
            required: true,
            placeholder: "e.g. 1–2 years preferred",
          })}
          {stringField("summary", "Short listing summary *", {
            required: true,
            textarea: true,
            wide: true,
            max: 600,
          })}
          {stringField("description", "Position overview *", {
            required: true,
            textarea: true,
            wide: true,
          })}
          <label className={`${styles.field} ${styles.full}`}>
            Key responsibilities *
            <textarea
              value={responsibilities}
              onChange={(event) => {
                setResponsibilities(event.target.value);
                setFieldErrors((current) => ({
                  ...current,
                  responsibilities: "",
                }));
              }}
              required
              rows={5}
              placeholder="One responsibility per line"
              disabled={busy}
              aria-invalid={Boolean(fieldErrors.responsibilities)}
              aria-describedby={
                fieldErrors.responsibilities
                  ? "job-responsibilities-error"
                  : undefined
              }
            />
            {fieldErrors.responsibilities && (
              <span
                className={styles.fieldError}
                id="job-responsibilities-error"
              >
                {fieldErrors.responsibilities}
              </span>
            )}
          </label>
          <label className={`${styles.field} ${styles.full}`}>
            Qualifications & requirements *
            <textarea
              value={requirements}
              onChange={(event) => {
                setRequirements(event.target.value);
                setFieldErrors((current) => ({ ...current, requirements: "" }));
              }}
              required
              rows={5}
              placeholder="One requirement per line"
              disabled={busy}
              aria-invalid={Boolean(fieldErrors.requirements)}
              aria-describedby={
                fieldErrors.requirements ? "job-requirements-error" : undefined
              }
            />
            {fieldErrors.requirements && (
              <span className={styles.fieldError} id="job-requirements-error">
                {fieldErrors.requirements}
              </span>
            )}
          </label>
          <label className={`${styles.field} ${styles.full}`}>
            Confirmed benefits
            <textarea
              value={benefits}
              onChange={(event) => {
                setBenefits(event.target.value);
                setFieldErrors((current) => ({ ...current, benefits: "" }));
              }}
              rows={3}
              placeholder="One confirmed benefit per line; leave empty if none are verified"
              disabled={busy}
              aria-invalid={Boolean(fieldErrors.benefits)}
              aria-describedby={
                fieldErrors.benefits ? "job-benefits-error" : undefined
              }
            />
            {fieldErrors.benefits && (
              <span className={styles.fieldError} id="job-benefits-error">
                {fieldErrors.benefits}
              </span>
            )}
            <span className={styles.help}>
              Include only benefits confirmed for this position.
            </span>
          </label>
          {stringField("salary", "Compensation / salary range", {
            placeholder: "Currency, gross/net, amount and payment frequency",
            help: "Enter the salary range in EUR per month. Leave empty when unknown.",
          })}
          <label className={styles.field}>
            Salary status
            <select
              value={values.salaryStatus || ""}
              onChange={(event) => update("salaryStatus", event.target.value === "proposed-net" ? "proposed-net" : undefined)}
              disabled={busy}
            >
              <option value="">Employer-confirmed terms / no salary provided</option>
              <option value="proposed-net">Salary range · EUR per month</option>
            </select>
            <span className={styles.help}>Salary ranges are displayed consistently on job pages and application summaries.</span>
          </label>
          {stringField("schedule", "Work schedule")}
          {stringField("contract", "Contract duration / arrangement")}
          <label className={`${styles.field} ${styles.full}`}>
            Available positions
            <select
              value={openingsMode}
              onChange={(event) => {
                setOpeningsMode(event.target.value as "none" | "exact" | "range");
                setFieldErrors((current) => ({ ...current, openings: "", openingsRange: "" }));
              }}
              disabled={busy}
            >
              <option value="none">Not specified</option>
              <option value="exact">Exact count</option>
              <option value="range">Minimum and maximum range</option>
            </select>
            <span className={styles.help}>Choose an exact count or a range to display on the public listing.</span>
          </label>
          {openingsMode === "exact" && <label className={styles.field}>
            Worker count *
            <input
              type="number"
              min={1}
              max={10000}
              step={1}
              required
              value={exactOpenings}
              onChange={(event) => {
                setExactOpenings(event.target.value);
                setFieldErrors((current) => ({ ...current, openings: "" }));
              }}
              disabled={busy}
              aria-invalid={Boolean(fieldErrors.openings)}
              aria-describedby={
                fieldErrors.openings ? "job-openings-error" : undefined
              }
            />
            {fieldErrors.openings && (
              <span className={styles.fieldError} id="job-openings-error">
                {fieldErrors.openings}
              </span>
            )}
          </label>}
          {openingsMode === "range" && <>
            <label className={styles.field}>
              Minimum positions *
              <input type="number" min={1} max={10000} step={1} required value={minimumOpenings} onChange={(event) => {
                setMinimumOpenings(event.target.value);
                setFieldErrors((current) => ({ ...current, openingsRange: "" }));
              }} disabled={busy} aria-invalid={Boolean(fieldErrors.openingsRange)} aria-describedby={fieldErrors.openingsRange ? "job-openings-range-error" : undefined} />
            </label>
            <label className={styles.field}>
              Maximum positions *
              <input type="number" min={1} max={10000} step={1} required value={maximumOpenings} onChange={(event) => {
                setMaximumOpenings(event.target.value);
                setFieldErrors((current) => ({ ...current, openingsRange: "" }));
              }} disabled={busy} aria-invalid={Boolean(fieldErrors.openingsRange)} aria-describedby={fieldErrors.openingsRange ? "job-openings-range-error" : undefined} />
              {fieldErrors.openingsRange && <span className={styles.fieldError} id="job-openings-range-error">{fieldErrors.openingsRange}</span>}
            </label>
          </>}
          <div className={`${styles.photoEditor} ${styles.full}`}>
            <div>
              {canPreview ? (
                <div className={styles.photoPreview}>
                  <Image
                    src={values.image}
                    alt={values.imageAlt || "Opportunity photo preview"}
                    fill
                    sizes="300px"
                    style={{
                      objectFit: "cover",
                      objectPosition: values.imagePosition || "center",
                    }}
                  />
                </div>
              ) : (
                <div className={styles.photoPlaceholder}>
                  <ImagePlus size={32} />
                  <span>Add a representative job photograph</span>
                </div>
              )}
            </div>
            <div>
              <label className={styles.uploadButton}>
                <ImagePlus size={17} />{" "}
                {uploading ? "Uploading…" : "Upload job photo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => void upload(event.target.files?.[0])}
                  disabled={busy || uploading}
                />
              </label>
              <p className={styles.help}>
                JPG, PNG or WebP · Up to 8 MB · Minimum 300 × 200 px. Choose a
                unique, licensed photo that represents this role.
              </p>
              {photoNotice && (
                <p className={styles.help} role="status">
                  {photoNotice}
                </p>
              )}
              {stringField("image", "Image URL *", {
                required: true,
                help: "Use an uploaded image, /images/ asset, or images.unsplash.com URL.",
              })}
            </div>
          </div>
          {stringField("imageAlt", "Photograph description (alt text) *", {
            required: true,
            placeholder: "Describe the role, activity and setting",
          })}
          {stringField("imagePosition", "Image focal position", {
            placeholder: "center or 50% 35%",
          })}
          {stringField("postedAt", "Posting date *", { required: true })}
          <label className={styles.field}>
            Publication status
            <select
              value={values.status}
              onChange={(event) =>
                update("status", event.target.value as Job["status"])
              }
              disabled={busy}
            >
              <option value="draft">Draft — hidden from public listings</option>
              <option value="published">
                Published — visible and accepts applications
              </option>
              <option value="closed">
                Closed — no longer accepts applications
              </option>
            </select>
          </label>
          <div className={`${styles.checks} ${styles.full}`}>
            <label>
              <input
                type="checkbox"
                checked={values.featured}
                onChange={(event) => update("featured", event.target.checked)}
                disabled={busy}
              />{" "}
              Feature on the homepage
            </label>
            <label>
              <input
                type="checkbox"
                checked={values.isExample}
                onChange={(event) => update("isExample", event.target.checked)}
                disabled={busy}
              />{" "}
              Development example vacancy
            </label>
            <p className={styles.help}>
              Keep example vacancies labeled. Remove the example label only for
              a confirmed, authorized employer opening or a clearly labeled proposed role.
            </p>
          </div>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.editorActions}>
          <button
            type="button"
            className={styles.cancel}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || uploading}
          >
            {busy ? "Saving…" : "Save opportunity"}
            <ArrowRight size={17} />
          </button>
        </div>
      </form>
    </div>
  );
}
