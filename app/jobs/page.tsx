import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, BusFront, House, ShieldCheck } from "lucide-react";
import { PageMotion } from "@/components/animations/PageMotion";
import { getPublicJobs } from "@/lib/public-jobs";
import { JobDirectory } from "@/components/jobs/JobDirectory";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbData, jobDirectoryData, pageMetadata } from "@/lib/seo";
import { workerImageSrc } from "@/lib/worker-images";
import styles from "./jobs.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Jobs Street Croatia — Hiring in the Philippines",
  description: "Explore jobs in Croatia for Filipino workers: salary ranges, free transportation and accommodation, no placement fee, and online applications.",
  path: "/jobs",
});

export default async function JobsPage() {
  const jobs = await getPublicJobs();
  const workers = jobs.reduce((total, job) => total + (job.openings || 0), 0);
  const industries = new Set(jobs.map((job) => job.category)).size;
  return (
    <div className={styles.page}>
      <JsonLd data={jobDirectoryData(jobs)} />
      <JsonLd data={breadcrumbData([{ name: "Home", path: "/" }, { name: "Jobs abroad", path: "/jobs" }])} />
      <section className={`container ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow} data-enter><span />Croatia is calling. Filipino talent wanted.</div>
          <h1 data-enter>Your next move,<br />in <em>Croatia.</em></h1>
          <p data-enter>Good work starts with the right opportunity. Discover roles that value your skills, and take your next step abroad.</p>
          <a href="#job-results" className={styles.browse}>Explore the opportunities <ArrowDown size={16} aria-hidden="true" /></a>
        </div>
        <div className={styles.heroVisual}>
          <div className={styles.heroImage}><Image src={workerImageSrc("/images/street-v2/hero-skills.webp")} alt="AI-generated illustration of skilled Filipino workers collaborating in a workshop" fill loading="eager" fetchPriority="high" sizes="(max-width:700px) 100vw, 35vw" /></div>
          <div className={styles.roleCount}><strong>{String(jobs.length).padStart(2, "0")}</strong><span>roles.<br />new beginnings.</span></div>
          <span className={styles.visualCaption}>Built on skill. Driven by possibility.</span>
        </div>
      </section>
      <div className={`container ${styles.promiseStrip}`}>
        <span data-fee-glow="badge"><ShieldCheck size={18} aria-hidden="true" /><strong>No placement fee</strong></span>
        <span><House size={17} aria-hidden="true" />Free accommodation</span>
        <span><BusFront size={18} aria-hidden="true" />Free transportation</span>
        <span className={styles.total}>{workers.toLocaleString("en-US")} positions <i /> {industries} industries</span>
      </div>
      {jobs.some((job) => job.isExample) && <div className={`container ${styles.exampleNotice}`}>Example vacancies are for this development preview. No employer openings, compensation, or benefits are confirmed.</div>}
      <Suspense fallback={<div className="container loading-page">Loading opportunities…</div>}><JobDirectory jobs={jobs} /></Suspense>
      <div className={`container ${styles.bottomNote}`}><span>Find the role that feels right for you.</span><Link href="/contact">Let’s talk about your next step ↗</Link></div>
      <PageMotion />
    </div>
  );
}
