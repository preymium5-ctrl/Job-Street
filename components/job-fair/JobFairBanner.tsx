import Link from "next/link";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import { jobFair } from "@/data/job-fair";
import styles from "./JobFairBanner.module.css";

export function JobFairBanner({ className = "" }: { className?: string }) {
  return (
    <aside className={`${styles.banner} ${className}`} aria-label="Job fair information">
      <div className={styles.identity}>
        <span className={styles.icon}><CalendarDays size={22} aria-hidden="true" /></span>
        <div>
          <p className={styles.title}>{jobFair.title}</p>
          <p className={styles.organizers}>Recruitment and skills assessment</p>
        </div>
      </div>
      <div className={styles.date}>
        <span>Planned testing · Philippines</span>
        <strong>{jobFair.testingDateLabel}</strong>
      </div>
      <Link className={styles.link} href="/job-fair">
        Dates &amp; preparation <ArrowUpRight size={18} aria-hidden="true" />
      </Link>
    </aside>
  );
}
