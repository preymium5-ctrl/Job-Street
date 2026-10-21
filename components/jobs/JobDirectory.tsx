"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useRef } from "react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUpRight, Search, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import type { Job } from "@/lib/types";
import { formatOpeningRange, getTotalOpeningRange } from "@/lib/job-openings";
import { JobCard } from "./JobCard";
import styles from "./JobDirectory.module.css";

const rolesPerPage = 24;

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
  const sort = params.get("sort") || "newest";
  const requestedPage = Number(params.get("page") || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  useEffect(() => {
    const frame = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => cancelAnimationFrame(frame);
  }, [keyword, params]);
  const industries = [...new Set(jobs.map((job) => job.category))].sort();
  const locations = [...new Set(jobs.map((job) => job.location))].sort();
  const types = [...new Set(jobs.map((job) => job.employmentType).filter((value) => value !== "Terms to be confirmed"))].sort();
  function update(key: string, value: string) {
    const next = new URLSearchParams(window.location.search);
    next.delete("employer");
    if (key !== "page") next.delete("page");
    if (value) next.set(key, value);
    else next.delete(key);
    window.history.replaceState(null, "", `/jobs${next.size ? "?" + next.toString() : ""}#job-results`);
  }
  function clear() { window.history.replaceState(null, "", "/jobs#job-results"); }
  const result = jobs.filter((job) =>
    (!industry || job.category === industry) &&
    (!location || job.location === location) &&
    (!type || job.employmentType === type) &&
    `${job.title} ${job.category} ${job.location} ${job.summary} ${job.requirements.join(" ")}`.toLowerCase().includes(keyword.toLowerCase().trim())
  ).sort((a, b) => sort === "az" ? a.title.localeCompare(b.title) : Date.parse(b.postedAt) - Date.parse(a.postedAt));
  const hasFilter = !!(query || industry || location || type || sort !== "newest");
  const openings = getTotalOpeningRange(result);
  const visibleJobs = result.slice(0, page * rolesPerPage);
  const remainingJobs = result.length - visibleJobs.length;
  const resultLocations = [...new Set(result.map((job) => job.location))];
  const locationSummary = location || (resultLocations.length === 1 ? resultLocations[0] : "Across our destinations");

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
              {types.length > 0 && <label className={styles.selectField}>Employment type<select aria-label="Employment type" value={type} onChange={(event) => update("type", event.target.value)}><option value="">All employment types</option>{types.map((value) => <option key={value}>{value}</option>)}</select></label>}
            </div>
          </details>
          <div className={styles.help}>
            <ShieldCheck size={28} aria-hidden="true" />
            <h3>Big opportunities.<br /><span data-fee-glow="text">Zero placement fee.</span></h3>
            <p>For Filipino workers ready to build their future abroad.</p>
            <Link href="/contact">Have a question? <ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>
        </aside>
        <div className={styles.results}>
          <div className={styles.resultsHeader}>
            <div><span className={styles.kicker}>The opportunity board</span><h2>{industry || "All opportunities"}<span>{String(result.length).padStart(2, "0")}</span></h2><p aria-live="polite">{result.length} {result.length === 1 ? "role" : "roles"}{openings && openings.max > 0 && ` · ${formatOpeningRange(openings)} positions available`} · {locationSummary}</p></div>
            <label className={styles.sort}><span className="sr-only">Sort jobs</span><select aria-label="Sort jobs" value={sort} onChange={(event) => update("sort", event.target.value)}><option value="newest">Newest first</option><option value="az">Title: A to Z</option></select></label>
          </div>
          {hasFilter && <div className={styles.activeFilters}>
            {[["q", query], ["industry", industry], ["location", location], ["type", type]].filter(([, value]) => value).map(([key, value]) => <button key={key} onClick={() => update(key, "")}><span>{value}</span><X size={12} aria-hidden="true" /><span className="sr-only">Remove {key === "q" ? "search" : key} filter</span></button>)}
            <button className={styles.reset} onClick={clear}>Clear all</button>
          </div>}
          <div className={styles.grid} id="job-listings">{visibleJobs.map((job, index) => <JobCard key={job.id} job={job} index={index} />)}</div>
          {remainingJobs > 0 && <div className={styles.loadMore}><p aria-live="polite">Showing {visibleJobs.length} of {result.length} roles</p><button aria-controls="job-listings" onClick={() => update("page", String(page + 1))}>Show {Math.min(rolesPerPage, remainingJobs)} more roles <ArrowDown size={17} aria-hidden="true" /></button></div>}
          {!result.length && <div className={styles.empty}><Search size={31} aria-hidden="true" /><h3>Let’s find your next move.</h3><p>No roles match these filters. Try another skill or explore all opportunities.</p><button onClick={clear}>Show all opportunities <ArrowDown size={17} aria-hidden="true" /></button></div>}
          <div className={styles.end}><span>{remainingJobs > 0 ? "More opportunities are ready to explore." : "You’re up to date with these opportunities."}</span><a href="#main-content">Back to top ↑</a></div>
        </div>
      </div>
    </section>
  );
}
