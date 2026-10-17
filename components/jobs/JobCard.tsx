import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, BriefcaseBusiness, MapPin, ShieldCheck } from "lucide-react";
import type { Job } from "@/lib/types";
import { JobSalary } from "./JobSalary";
import { getJobFairRole } from "@/data/job-fair";
import { noPlacementFee } from "@/data/employment";
import styles from "./JobCard.module.css";

export function JobCard({ job, index = 0, featured = false, employer }: {
  job: Job;
  index?: number;
  featured?: boolean;
  employer?: string;
}) {
  const role = getJobFairRole(job);
  const allocation = employer ? role?.employers.find((item) => item.name === employer) : undefined;
  const workers = allocation?.workers ?? job.openings;
  const employerName = allocation?.name ?? (role?.employers.length === 1 ? role.employers[0].name : role ? `${role.employers.length} employer options` : null);

  return (
    <article className={`job-card ${styles.card}`} data-reveal aria-labelledby={`job-card-${job.slug}`}>
      <div className={styles.cover}>
        <Link href={`/jobs/${job.slug}`} className={styles.photo} tabIndex={-1} aria-hidden="true">
          <Image src={job.image} alt={job.imageAlt} fill loading={index < 2 ? "eager" : "lazy"} sizes="(max-width: 1100px) 100vw, (max-width: 1600px) 50vw, 33vw" style={{ objectPosition: job.imagePosition || "center 35%" }} />
        </Link>
        <span className={styles.fee} data-fee-glow="badge"><ShieldCheck size={14} aria-hidden="true" />{noPlacementFee}</span>
        <div className={styles.coverTitle}>
          <span>{job.category}</span>
          <h3 id={`job-card-${job.slug}`}><Link href={`/jobs/${job.slug}`}>{job.title}</Link></h3>
        </div>
        {job.isExample && <span className={styles.imageNote}>Example vacancy</span>}
      </div>
      <div className={styles.body}>
        <div className={styles.locationRow}>
          <span><MapPin size={13} aria-hidden="true" />{job.location}</span>
          {typeof workers === "number" && <span className={styles.openings}><strong>{workers.toLocaleString("en-US")}</strong> openings</span>}
        </div>
        <div className={styles.salary}><JobSalary job={job} /></div>
        <p className={styles.experience}><BriefcaseBusiness size={14} aria-hidden="true" />{job.experience}</p>
        {employerName && <p className={styles.employer}>{employerName}<span> / {role ? "Filipino applicants" : job.employmentType}</span></p>}
        <p className={styles.summary}>{job.summary}</p>
        <div className={styles.actions}>
          <Link href={`/jobs/${job.slug}`} className={styles.details}>View role <ArrowUpRight size={17} aria-hidden="true" /></Link>
          <Link href={`/jobs/${job.slug}/apply`} target="_blank" rel="noopener noreferrer" aria-label={`Apply now for ${job.title} (opens in a new tab)`} className={styles.apply}>Apply now <ArrowUpRight size={17} aria-hidden="true" /></Link>
        </div>
        {!featured && <p className={styles.listed}>{job.salaryStatus === "proposed-net" ? "Listed" : job.isExample ? "Example date" : "Posted"} <time dateTime={job.postedAt}>{new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(job.postedAt))}</time></p>}
      </div>
    </article>
  );
}
