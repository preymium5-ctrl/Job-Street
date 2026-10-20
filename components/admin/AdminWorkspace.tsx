"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  LockKeyhole,
  LogOut,
  Plus,
  Search,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { Application, Job } from "@/lib/types";
import { isAdditionalApplicationJob } from "@/data/application-jobs";
import { AdminApiError, adminRequest, errorMessage } from "./api";
import JobEditor from "./JobEditor";
import ApplicationsPanel from "./ApplicationsPanel";
import GoogleSheetsStatus from "./GoogleSheetsStatus";
import styles from "./Admin.module.css";

export default function AdminWorkspace() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [tab, setTab] = useState<"jobs" | "applications">("jobs");
  const [query, setQuery] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const [editing, setEditing] = useState<Job | "new" | null>(null);
  const operationRef = useRef(false);
  const editorRef = useRef<HTMLElement>(null);
  const editorTriggerRef = useRef<HTMLButtonElement | null>(null);

  const expireSession = useCallback(() => {
    setAuthenticated(false);
    setJobs([]);
    setApplications([]);
    setEditing(null);
    setStaffEmail("");
    setError("Your session has expired. Please sign in again.");
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [jobData, applicationData] = await Promise.all([
        adminRequest<{ jobs: Job[] }>("/api/admin/jobs"),
        adminRequest<{ applications: Application[] }>(
          "/api/admin/applications",
        ),
      ]);
      setJobs(jobData.jobs);
      setApplications(applicationData.applications);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) expireSession();
      else setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [expireSession]);

  useEffect(() => {
    let alive = true;
    adminRequest<{ authenticated: boolean; email?: string }>(
      "/api/admin/session",
    )
      .then(async (session) => {
        if (!alive) return;
        setAuthenticated(session.authenticated);
        setStaffEmail(session.email || "");
        if (session.authenticated) await loadData();
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [loadData]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (operationRef.current) return;
    operationRef.current = true;
    setBusy(true);
    setError("");
    try {
      const session = await adminRequest<{
        authenticated: boolean;
        email?: string;
      }>("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!session.authenticated)
        throw new Error("Sign-in could not be confirmed.");
      setAuthenticated(true);
      setStaffEmail(session.email || email);
      setPassword("");
      await loadData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      operationRef.current = false;
    }
  }

  async function logout() {
    if (operationRef.current) return;
    operationRef.current = true;
    setBusy(true);
    setError("");
    try {
      await adminRequest("/api/admin/session", { method: "DELETE" });
      setAuthenticated(false);
      setJobs([]);
      setApplications([]);
      setEditing(null);
      setStaffEmail("");
      setNotice("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      operationRef.current = false;
    }
  }

  function edit(job: Job | "new", trigger: HTMLButtonElement) {
    editorTriggerRef.current = trigger;
    setEditing(job);
    setNotice("");
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
      editorRef.current?.focus({ preventScroll: true });
    });
  }
  function closeEditor() {
    setEditing(null);
    requestAnimationFrame(() => editorTriggerRef.current?.focus());
  }
  function selectTab(next: "jobs" | "applications") {
    setTab(next);
    setEditing(null);
    setError("");
  }
  const visibleJobs = jobs.filter(
    (job) =>
      (!jobStatus || job.status === jobStatus) &&
      `${job.title} ${job.category} ${job.location}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );

  if (checking)
    return (
      <div className={`${styles.page} container`}>
        <div className={styles.loading} role="status">
          Opening your recruitment workspace…
        </div>
      </div>
    );
  if (!authenticated)
    return (
      <div className={`${styles.page} container`}>
        <div className={styles.loginLayout}>
          <div>
            <p className="eyebrow">Recruitment workspace</p>
            <h1>
              People.
              <br />
              Possibilities.
              <br />
              <span>Progress.</span>
            </h1>
            <p className={styles.intro}>
              A focused space to manage opportunities and move applicants
              forward.
            </p>
            <Link className={styles.textLink} href="/jobs">
              Back to opportunities <ArrowUpRight size={16} />
            </Link>
          </div>
          <section className={styles.login}>
            <LockKeyhole size={25} strokeWidth={1.4} />
            <p className="eyebrow">Authorized staff only</p>
            <h2>Welcome back.</h2>
            <p>Sign in to access recruitment records.</p>
            <form onSubmit={login}>
              <label className={styles.field}>
                Work email
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                />
              </label>
              <label className={styles.field}>
                Password
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
              </label>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <button
                className="button button-primary"
                type="submit"
                disabled={busy}
              >
                {busy ? "Signing in…" : "Sign in"}
                <ArrowRight size={17} />
              </button>
            </form>
            <p className={styles.securityNote}>
              Applicant records and resumes are restricted to authenticated
              staff.
            </p>
          </section>
        </div>
      </div>
    );

  return (
    <div className={`${styles.page} container`}>
      <div className={styles.workspaceHead}>
        <div>
          <p className="eyebrow">Recruitment workspace</p>
          <h1>
            Good work
            <br />
            <span>starts here.</span>
          </h1>
        </div>
        <div className={styles.account}>
          <span>{staffEmail}</span>
          <button onClick={() => void logout()} disabled={busy}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </div>
      <div className={styles.metrics}>
        <div>
          <span>Published opportunities</span>
          <strong>
            {jobs
              .filter((job) => job.status === "published")
              .length.toString()
              .padStart(2, "0")}
          </strong>
        </div>
        <div>
          <span>Applications received</span>
          <strong>{applications.length.toString().padStart(2, "0")}</strong>
        </div>
        <div>
          <span>Awaiting review</span>
          <strong>
            {applications
              .filter((application) => application.status === "New")
              .length.toString()
              .padStart(2, "0")}
          </strong>
        </div>
        <div>
          <span>Shortlisted applicants</span>
          <strong>
            {applications
              .filter((application) => application.status === "Shortlisted")
              .length.toString()
              .padStart(2, "0")}
          </strong>
        </div>
      </div>
      <div className={styles.tabs}>
        <div
          role="tablist"
          aria-label="Recruitment records"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? "jobs"
                : event.key === "End"
                  ? "applications"
                  : tab === "jobs"
                    ? "applications"
                    : "jobs";
            selectTab(next);
            document.getElementById(`${next}-tab`)?.focus();
          }}
        >
          <button
            id="jobs-tab"
            role="tab"
            aria-selected={tab === "jobs"}
            aria-controls="jobs-panel"
            tabIndex={tab === "jobs" ? 0 : -1}
            onClick={() => selectTab("jobs")}
          >
            <BriefcaseBusiness size={17} /> Opportunities{" "}
            <span>{jobs.length}</span>
          </button>
          <button
            id="applications-tab"
            role="tab"
            aria-selected={tab === "applications"}
            aria-controls="applications-panel"
            tabIndex={tab === "applications" ? 0 : -1}
            onClick={() => selectTab("applications")}
          >
            <Users size={17} /> Applicants <span>{applications.length}</span>
          </button>
        </div>
        <button
          className={styles.refresh}
          onClick={() => {
            setError("");
            void loadData();
          }}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh records"}
        </button>
      </div>
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
      {tab === "jobs" ? (
        <section id="jobs-panel" role="tabpanel" aria-labelledby="jobs-tab">
          <div className={styles.toolbar}>
            <div className={styles.search}>
              <Search size={17} />
              <input
                aria-label="Search opportunities"
                placeholder="Search title, industry, location…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <select
              aria-label="Filter opportunity status"
              value={jobStatus}
              onChange={(event) => setJobStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="closed">Closed</option>
            </select>
            <button
              className="button button-primary"
              onClick={(event) => edit("new", event.currentTarget)}
            >
              <Plus size={16} /> Add opportunity
            </button>
          </div>
          {loading && jobs.length === 0 ? (
            <p className={styles.loading} role="status">
              Loading opportunities…
            </p>
          ) : visibleJobs.length === 0 ? (
            <div className={styles.empty}>
              <BriefcaseBusiness size={28} />
              <h2>No opportunities found.</h2>
              <p>
                {jobs.length
                  ? "Try another search or clear the status filter."
                  : "Add your first opportunity to begin."}
              </p>
            </div>
          ) : (
            <div className={styles.jobList}>
              {visibleJobs.map((job, index) => (
                <article key={job.id} className={styles.jobRow}>
                  <span className={styles.rowNumber}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <div className={styles.rowTags}>
                      <span>{job.category}</span>
                      {isAdditionalApplicationJob(job) && <span>Application form only</span>}
                      {job.isExample && (
                        <span className={styles.exampleTag}>
                          Development example
                        </span>
                      )}
                    </div>
                    <h2>{job.title}</h2>
                    <p>
                      {job.location} <span>·</span> {job.employmentType}
                    </p>
                  </div>
                  <span className={`${styles.badge} ${styles[job.status]}`}>
                    {job.status}
                  </span>
                  <div className={styles.rowActions}>
                    {job.status === "published" && !isAdditionalApplicationJob(job) && (
                      <Link
                        href={`/jobs/${job.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Preview ${job.title}`}
                      >
                        Preview <ArrowUpRight size={14} />
                      </Link>
                    )}
                    <button
                      onClick={(event) => edit(job, event.currentTarget)}
                      aria-label={`Edit ${job.title}`}
                    >
                      Edit opportunity <ArrowRight size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {editing && (
            <section
              className={styles.editorSection}
              ref={editorRef}
              tabIndex={-1}
            >
              <JobEditor
                key={editing === "new" ? "new" : editing.id}
                job={editing === "new" ? undefined : editing}
                onCancel={closeEditor}
                onSessionExpired={expireSession}
                onSaved={(saved) => {
                  setJobs((current) => {
                    const exists = current.some((job) => job.id === saved.id);
                    return exists
                      ? current.map((job) =>
                          job.id === saved.id ? saved : job,
                        )
                      : [saved, ...current];
                  });
                  setEditing(null);
                  setNotice(`${saved.title} was saved as ${saved.status}.`);
                }}
              />
            </section>
          )}
        </section>
      ) : (
        <section
          id="applications-panel"
          role="tabpanel"
          aria-labelledby="applications-tab"
        >
          <GoogleSheetsStatus onSessionExpired={expireSession} />
          <ApplicationsPanel
            applications={applications}
            jobs={jobs}
            onSessionExpired={expireSession}
            onUpdated={(updated) =>
              setApplications((current) =>
                current.map((application) =>
                  application.id === updated.id ? updated : application,
                ),
              )
            }
          />
        </section>
      )}
    </div>
  );
}
