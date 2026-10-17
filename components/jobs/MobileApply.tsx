"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Job } from "@/lib/types";
import styles from "./RolePage.module.css";

export function MobileApply({ job }: { job: Job }) {
  const [footerVisible, setFooterVisible] = useState(false);
  useEffect(() => {
    const footer = document.querySelector("footer");
    if (!footer || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => setFooterVisible(entry.isIntersecting),
      { rootMargin: "0px 0px 90px 0px" },
    );
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);
  if (footerVisible) return null;
  return (
    <div className={styles.mobileApply}>
      <div>
        <strong>{job.title}</strong>
        <span>{job.salaryStatus === "proposed-net" ? job.salary ? `${job.salary} · EUR/mo` : "Salary to be confirmed" : job.isExample ? "Example vacancy" : job.location}</span>
      </div>
      <Link
        href={`/jobs/${job.slug}/apply`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Apply now for ${job.title} (opens in a new tab)`}
        className="button button-primary"
      >
        Apply now <ArrowUpRight size={18} />
      </Link>
    </div>
  );
}
