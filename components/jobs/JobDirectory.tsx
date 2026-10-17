"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useRef } from "react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUpRight, Search, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import type { Job } from "@/lib/types";
import { JobCard } from "./JobCard";
import { getJobFairRole } from "@/data/job-fair";
import styles from "./JobDirectory.module.css";

export function JobDirectory({ jobs }: { jobs: Job[] }) {
  const directoryRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const directory = directoryRef.current;
    directory?.setAttribute("data-motion-ready", "true");
    return () => directory?.removeAttribute("data-motion-ready");
  }, []);
  const params = useSearchParams();
  const query = params.get("q") || "";
  const keyword = useDeferredValue(query);
  const industry = params.get("industry") || "";
  const location = params.get("location") || "";
  const type = params.get("type") || "";
  const employer = params.get("employer") || "";
  const sort = params.get("sort") || "newest";
  useEffect(() => {
    const frame = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => cancelAnimationFrame(frame);
  }, [keyword, params]);
  const industries = [...new Set(jobs.map((job) => job.category))].sort();
  const locations = [...new Set(jobs.map((job) => job.location))].sort();
  const types = [...new Set(jobs.map((job) => job.employmentType).filter((value) => value !== "Terms to be confirmed"))].sort();
  const employers = [...new Set(jobs.flatMap((job) => getJobFairRole(job)?.employers.map((item) => item.name) || []))].sort();
  function update(key: string, value: string) {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    window.history.replaceState(null, "", `/jobs${next.size ? "?" + next.toString() : ""}#job-results`);
  }
  function clear() { window.history.replaceState(null, "", "/jobs#job-results"); }
  const result = jobs.filter((job) =>
    (!industry || job.category === industry) &&
    (!location || job.location === location) &&
    (!type || job.employmentType === type) &&
    (!employer || getJobFairRole(job)?.employers.some((item) => item.name === employer)) &&
    `${job.title} ${job.category} ${job.location} ${job.summary} ${job.requirements.join(" ")} ${getJobFairRole(job)?.employers.map((item) => item.name).join(" ") || ""}`.toLowerCase().includes(keyword.toLowerCase().trim())
  ).sort((a, b) => sort === "az" ? a.title.localeCompare(b.title) : Date.parse(b.postedAt) - Date.parse(a.postedAt));
  const hasFilter = !!(query || industry || location || type || employer || sort !== "newest");
  const workers = result.reduce((total, job) => total + (employer ? getJobFairRole(job)?.employers.find((item) => item.name === employer)?.workers || 0 : job.openings || 0), 0);

  return (
    <section ref={directoryRef} className={`container ${styles.directory}`} id="job-results" data-motion-boundary>
      <div className={styles.searchRow}>
        <div className={styles.search}>
          <Search size={23} aria-hidden="true" />
          <label className="sr-only" htmlFor="job-keyword">Search opportunities</label>
          <input id="job-keyword" type="search" value={query} onChange={(event) => update("q", event.target.value)} placeholder="Find a role, a skill, a new beginning…" />
          {query && <button onClick={() => update("q", "")} aria-label="Clear search"><X size={19} /></button>}
        </div>
        <span className={styles.searchNote}>Your skills. New possibilities.</span>
      </div>
      <div className={styles.workspace}>
        <aside className={styles.sidebar} aria-label="Job filters">
          <details className={styles.filters} open>
            <summary>Refine your search <SlidersHorizontal size={17} aria-hidden="true" /></summary>
            <div className={styles.filterBody}>
              <div className={styles.industryGroup}>
                <h3>Explore by industry</h3>
                <div className={styles.industryList}>
                  <button aria-pressed={!industry} onClick={() => update("industry", "")}><span>All opportunities</span><b>{jobs.length}</b></button>
                  {industries.map((value) => <button key={value} aria-label={`Filter industry: ${value}`} aria-pressed={industry === value} onClick={() => update("industry", value)}><span>{value}</span><b>{jobs.filter((job) => job.category === value).length}</b></button>)}
                </div>
              </div>
              <label className={styles.selectField}>Location<select aria-label="Location" value={location} onChange={(event) => update("location", event.target.value)}><option value="">All locations</option>{locations.map((value) => <option key={value}>{value}</option>)}</select></label>
              {employers.length > 0 && <label className={styles.selectField}>Employer<select aria-label="Employer" value={employer} onChange={(event) => update("employer", event.target.value)}><option value="">All employers</option>{employers.map((value) => <option key={value}>{value}</option>)}</select></label>}
              {types.length > 0 && <label className={styles.selectField}>Employment type<select aria-label="Employment type" value={type} onChange={(event) => update("type", event.target.value)}><option value="">All employment types</option>{types.map((value) => <option key={value}>{value}</option>)}</select></label>}
            </div>
          </details>
          <div className={styles.help}>
            <ShieldCheck size={28} aria-hidden="true" />
            <h3>Big opportunities.<br /><span data-fee-glow="text">Zero placement fee.</span></h3>
            <p>For Filipino workers ready to build their future in Croatia.</p>
            <Link href="/contact">Have a question? <ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>
        </aside>
        <div className={styles.results}>
          <div className={styles.resultsHeader}>
            <div><span className={styles.kicker}>The opportunity board</span><h2>{industry || "All opportunities"}<span>{String(result.length).padStart(2, "0")}</span></h2><p aria-live="polite">{result.length} {result.length === 1 ? "role" : "roles"}{workers > 0 && ` · ${workers.toLocaleString("en-US")} positions available`} · Croatia</p></div>
            <label className={styles.sort}><span className="sr-only">Sort jobs</span><select aria-label="Sort jobs" value={sort} onChange={(event) => update("sort", event.target.value)}><option value="newest">Newest first</option><option value="az">Title: A to Z</option></select></label>
          </div>
          {hasFilter && <div className={styles.activeFilters}>
            {[["q", query], ["industry", industry], ["location", location], ["type", type], ["employer", employer]].filter(([, value]) => value).map(([key, value]) => <button key={key} onClick={() => update(key, "")}><span>{value}</span><X size={12} aria-hidden="true" /><span className="sr-only">Remove {key === "q" ? "search" : key} filter</span></button>)}
            <button className={styles.reset} onClick={clear}>Clear all</button>
          </div>}
          <div className={styles.grid}>{result.map((job, index) => <JobCard key={job.id} job={job} index={index} employer={employer} />)}</div>
          {!result.length && <div className={styles.empty}><Search size={31} aria-hidden="true" /><h3>Let’s find your next move.</h3><p>No roles match these filters. Try another skill or explore all opportunities.</p><button onClick={clear}>Show all opportunities <ArrowDown size={17} aria-hidden="true" /></button></div>}
          <div className={styles.end}><span>You’re up to date with these opportunities.</span><a href="#main-content">Back to top ↑</a></div>
        </div>
      </div>
    </section>
  );
}
