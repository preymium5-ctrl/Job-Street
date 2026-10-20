"use client";

import { useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  FileText,
  LockKeyhole,
  Search,
  X,
} from "lucide-react";
import {
  applicationStatuses,
  type Application,
  type ApplicationStatus,
  type Job,
} from "@/lib/types";
import { AdminApiError, adminRequest, errorMessage } from "./api";
import { documentLabel } from "@/lib/document-uploads";
import styles from "./Admin.module.css";

export default function ApplicationsPanel({
  applications,
  jobs,
  onUpdated,
  onSessionExpired,
}: {
  applications: Application[];
  jobs: Job[];
  onUpdated: (application: Application) => void;
  onSessionExpired: () => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [jobId, setJobId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<ApplicationStatus>("New");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const detailRef = useRef<HTMLElement>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = applications.find(
    (application) => application.id === selectedId,
  );
  const modernForm = selected?.applicationFormVersion === 2;
  const profile = selected?.applicantDetails;
  const addressProfile: [string, string][] = profile ? (
    profile.street?.trim() && profile.city?.trim() && profile.province?.trim() && profile.postalCode?.trim()
      ? [["Street", profile.street], ["City", profile.city], ["Province / state", profile.province], ["Postal code", profile.postalCode]]
      : [["Current address", profile.currentAddress]]
  ) : [];
  const personalProfile: [string, string][] = profile ? [
    ["First name", profile.firstName],
    ["Last name", profile.lastName],
    ["Gender", profile.gender || ""],
    ["Nationality", profile.nationality || "Not collected"],
    ...addressProfile,
    ["Date of birth", profile.dateOfBirth],
    ["Place of birth", profile.placeOfBirth],
    ["Telegram", profile.telegram || ""],
    ["Father’s full name", profile.fatherName || ""],
    ["Mother’s full name", profile.motherName || ""],
  ] : [];
  const professionalProfile: [string, string][] = profile ? [
    ["Basic English: speaking, reading and writing", profile.englishProficiency],
    ["Additional position with experience", profile.secondaryPosition || ""],
    ["Other position of interest", profile.otherPosition || ""],
  ] : [];
  const visible = applications.filter(
    (application) =>
      (!status || application.status === status) &&
      (!jobId || application.jobId === jobId) &&
      `${application.fullName} ${application.email} ${application.reference} ${application.jobTitle}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );

  async function updateStatus() {
    if (!selected || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { application } = await adminRequest<{ application: Application }>(
        `/api/admin/applications/${encodeURIComponent(selected.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      onUpdated(application);
      setNotice(`Application status updated to ${application.status}.`);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401)
        onSessionExpired();
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  function open(application: Application, trigger: HTMLButtonElement) {
    detailTriggerRef.current = trigger;
    setSelectedId(application.id);
    setNextStatus(application.status);
    setError("");
    setNotice("");
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
      detailRef.current?.focus({ preventScroll: true });
    });
  }
  function close() {
    setSelectedId(null);
    requestAnimationFrame(() => detailTriggerRef.current?.focus());
  }
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "Asia/Manila",
    }).format(new Date(date));

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={17} />
          <input
            aria-label="Search applicants"
            placeholder="Search name, email, role or reference…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          aria-label="Filter application status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All stages</option>
          {applicationStatuses.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Filter position applied for"
          value={jobId}
          onChange={(event) => setJobId(event.target.value)}
        >
          <option value="">All positions</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.title}
            </option>
          ))}
        </select>
      </div>
      <p className={styles.resultCount}>
        {visible.length} applicant{visible.length !== 1 ? "s" : ""}{" "}
        <span>· Resumes are accessible only to authorized staff</span>
      </p>
      {!visible.length ? (
        <div className={styles.empty}>
          <FileText size={28} />
          <h2>
            {applications.length
              ? "No applicants match."
              : "Every journey begins somewhere."}
          </h2>
          <p>
            {applications.length
              ? "Try another search or change the filters."
              : "Applications will appear here after a successful submission."}
          </p>
        </div>
      ) : (
        <div className={styles.applicantList}>
          {visible.map((application) => (
            <button
              key={application.id}
              className={`${styles.applicantRow} ${selectedId === application.id ? styles.selectedRow : ""}`}
              onClick={(event) => open(application, event.currentTarget)}
            >
              <span className={styles.avatar}>
                {application.fullName
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")}
              </span>
              <div>
                <h3>{application.fullName}</h3>
                <p>{application.jobTitle}</p>
                {application.isExample && (
                  <span className={styles.exampleTag}>Development example</span>
                )}
              </div>
              <div className={styles.applicationDate}>
                <span>{formatDate(application.submittedAt)}</span>
                <small>{application.reference}</small>
              </div>
              <span className={styles.badge}>{application.status}</span>
              <ArrowRight size={18} />
            </button>
          ))}
        </div>
      )}
      {selected && (
        <section
          className={styles.applicantDetail}
          ref={detailRef}
          tabIndex={-1}
          aria-label={`Application from ${selected.fullName}`}
        >
          <div className={styles.editorHeading}>
            <div>
              <p className="eyebrow">Applicant record / {selected.reference}</p>
              <h2>{selected.fullName}</h2>
              <p className={styles.detailSubheading}>
                {selected.jobTitle} · Received{" "}
                {formatDate(selected.submittedAt)}
              </p>
            </div>
            <button
              className={styles.close}
              onClick={close}
              aria-label="Close applicant record"
            >
              <X size={22} />
            </button>
          </div>
          {selected.isExample && (
            <p className={styles.sampleNotice}>
              Development example application — not part of a live employer
              recruitment campaign.
            </p>
          )}
          <div className={styles.detailLayout}>
            <div>
              <Details
                title="Personal details"
                items={[
                  ["Full name", selected.fullName],
                  ["Email", selected.email],
                  ["WhatsApp / contact number", selected.phone],
                  [modernForm ? "Country currently working in" : "Current country", selected.country],
                  ...personalProfile.filter(([, value]) => Boolean(value)),
                  ...(!modernForm ? [["Discovered us through", selected.discoverySource || "Not provided"] as [string, string]] : []),
                ]}
              />
              <Details
                title={modernForm ? "Application preferences" : "Professional background"}
                items={modernForm ? [
                  ["Country applying to", selected.destinationCountry || "Not provided"],
                  ["Primary job position", selected.jobTitle],
                  ...professionalProfile.filter(([, value]) => Boolean(value)),
                ] : [
                  ["Most recent role", selected.recentJobTitle],
                  ["Relevant experience", `${selected.experienceYears} years`],
                  ["Skills", selected.skills],
                  ...professionalProfile.filter(([, value]) => Boolean(value)),
                  [
                    "Education / certifications",
                    selected.education || "Not provided",
                  ],
                  ["Professional summary", selected.summary || "Not provided"],
                  ["Cover letter", selected.coverLetter || "Not provided"],
                ]}
              />
              {!modernForm && <Details
                title="Certificate and document readiness"
                items={[
                  ["Preferred employer", selected.preferredEmployer || "Not provided / open to allocations"],
                  ["NC2 certificate details", selected.nc2Certificate || "Not provided"],
                  ["Driver’s license details", selected.driverLicenseDetails || "Not provided"],
                  ["NC2 certificate", documentStatus(selected.documentReadiness?.nc2)],
                  ["High school diploma", documentStatus(selected.documentReadiness?.diploma)],
                  ["NBI clearance with apostille", documentStatus(selected.documentReadiness?.nbi)],
                  ["Form 18a", documentStatus(selected.documentReadiness?.form18a)],
                ]}
              />}
            </div>
            <aside className={styles.applicationAside}>
              <h3>Move their journey forward.</h3>
              <p>
                Update the recruitment stage after reviewing this application.
              </p>
              <label className={styles.field}>
                Application status
                <select
                  value={nextStatus}
                  onChange={(event) =>
                    setNextStatus(event.target.value as ApplicationStatus)
                  }
                  disabled={busy}
                >
                  {applicationStatuses.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <button
                className="button button-primary"
                disabled={busy || selected.status === nextStatus}
                onClick={() => void updateStatus()}
              >
                {busy ? "Updating…" : "Update status"}
                <ArrowRight size={16} />
              </button>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className={styles.notice} role="status">
                  {notice}
                </p>
              )}
              <div className={styles.resumeBox}>
                <FileText size={22} />
                <h4>Resume / CV</h4>
                <p>{selected.resumeName}</p>
                <a
                  href={`/api/admin/applications/${encodeURIComponent(selected.id)}/resume`}
                  className={styles.resumeLink}
                >
                  Download private resume <ArrowDownToLine size={16} />
                </a>
              </div>
              {selected.documents?.map((document) => (
                <div className={styles.resumeBox} key={document.id}>
                  <FileText size={22} />
                  <h4>{documentLabel(document.category)}</h4>
                  <p>{document.name}</p>
                  <a className={styles.resumeLink} href={`/api/admin/applications/${encodeURIComponent(selected.id)}/documents/${encodeURIComponent(document.id)}`}>
                    Download private document <ArrowDownToLine size={16} />
                  </a>
                </div>
              ))}
              <p className={styles.securityNote}>
                <LockKeyhole size={14} /> Private recruitment record. Access and
                status changes are logged by the server.
              </p>
              <p className={styles.help}>
                Privacy acknowledgement:{" "}
                {selected.consent ? "Received" : "Not recorded"}
              </p>
              {modernForm && <p className={styles.help}>
                Terms and conditions acknowledgement:{" "}
                {selected.termsAccepted ? "Received" : "Not recorded"}
              </p>}
            </aside>
          </div>
        </section>
      )}
    </>
  );
}

function documentStatus(value?: string) {
  switch (value) {
    case "ready": return "Ready";
    case "in-progress": return "In progress";
    case "not-yet": return "Not yet available";
    default: return "Not provided";
  }
}

function Details({
  title,
  items,
}: {
  title: string;
  items: [string, string][];
}) {
  return (
    <section className={styles.recordSection}>
      <h3>{title}</h3>
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
