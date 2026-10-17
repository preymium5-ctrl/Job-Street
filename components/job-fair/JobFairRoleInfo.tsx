import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Job } from "@/lib/types";
import { fairDocumentTiming, getJobFairRole } from "@/data/job-fair";
import { maximumAgeRequirement } from "@/data/employment";
import styles from "./JobFairRoleInfo.module.css";

export function JobFairRoleInfo({ job, compact = false }: { job: Job; compact?: boolean }) {
  const role = getJobFairRole(job);
  if (!role) return null;
  return (
    <section className={`${styles.panel} ${compact ? styles.compact : ""}`} aria-label="Recruitment details for this role">
      <span className="eyebrow">Hiring in the Philippines</span>
      <h3>Role requirements</h3>
      <p className={styles.label}>Employer options for this role</p>
      <ul className={styles.employers}>
        {role.employers.map((employer) => (
          <li key={employer.name}><span>{employer.name}</span><strong>{employer.workers} {employer.workers === 1 ? "worker" : "workers"}</strong></li>
        ))}
      </ul>
      <p className={styles.credential}><strong>NC2 guidance</strong>{role.nc2}</p>
      <p className={styles.credential}><strong>Age requirement</strong>{maximumAgeRequirement}</p>
      {role.drivingLicenseIsPlus && <p className={styles.credential}><strong>Additional advantage</strong>A driver’s license is a plus. Optional for this application.</p>}
      {role.focus && <p className={styles.note}>{role.focus.replace(" in the plan", "")}</p>}
      {!compact && (
        <>
          <h4>Skills assessment</h4>
          <ul className={styles.testing}>{role.testing.map((item) => <li key={item}>{item}</li>)}</ul>
          <p className={styles.note}>{fairDocumentTiming} Upload your CV and optionally attach the supporting documents you have available.</p>
        </>
      )}
      <Link href="/contact" className={styles.link}>Application & document help <ArrowUpRight size={16} /></Link>
    </section>
  );
}
