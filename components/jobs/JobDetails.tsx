import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, BriefcaseBusiness, BusFront, CalendarDays, Check, Clock3, House, MapPin, Plus, ShieldCheck, Users } from "lucide-react";
import type { Job } from "@/lib/types";
import { formatOpeningRange, getJobOpeningRange } from "@/lib/job-openings";
import { fairDocumentTiming, getJobFairRole } from "@/data/job-fair";
import { maximumAgeRequirement, noPlacementFee, recruitmentBenefits, workingInCroatia } from "@/data/employment";
import { MobileApply } from "./MobileApply";
import { JobSalary } from "./JobSalary";
import { JobCard } from "./JobCard";
import styles from "./RolePage.module.css";

const sections = [
  ["overview", "Job description"],
  ["responsibilities", "Key responsibilities"],
  ["qualifications", "Qualifications & requirements"],
  ["assessment", "Assessment & guidance"],
  ["compensation", "Salary & positions"],
  ["benefits", "Benefits & support"],
  ["application-process", "Recruitment process"],
  ["questions", "Your questions"],
] as const;

function RoleSection({ id, number, title, children }: { id: string; number: string; title: string; children: React.ReactNode }) {
  return <section id={id} className={styles.section}><div className={styles.sectionHeading}><span>{number}</span><h2>{title}</h2></div>{children}</section>;
}

function ApplyLink({ job, children = "Apply for this role" }: { job: Job; children?: React.ReactNode }) {
  return <Link href={`/jobs/${job.slug}/apply`} target="_blank" rel="noopener noreferrer" aria-label={`Apply now for ${job.title} (opens in a new tab)`} className={styles.applyButton}>{children}<ArrowUpRight size={19} aria-hidden="true" /></Link>;
}

export function JobDetails({ job, relatedJobs }: { job: Job; relatedJobs: Job[] }) {
  const role = getJobFairRole(job);
  const openings = getJobOpeningRange(job);
  const isCroatia = /\bcroatia\b/i.test(job.location);
  const postedDate = new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(job.postedAt));
  const benefits = [...new Set([...recruitmentBenefits, ...job.benefits])].filter((item) => item.trim().replace(/[.!]$/, "").toLowerCase() !== noPlacementFee.toLowerCase());
  const faqs = [
    { question: "What should I include in my application?", answer: "Describe experience and skills relevant to this position and attach your current CV. Use the responsibilities and requirements on this page as a guide." },
    { question: "What documents should I prepare?", answer: `Prepare your updated CV and valid passport. A residence ID with readable front and back is required for applicants working outside the Philippines, and a driver's license is required for driver applicants. Other supporting documents may be required${isCroatia ? "; Form 18a is for Croatia applicants" : ""}. Each file must be 3 MB or smaller, with all uploads together within 4 MB.` },
    { question: "How do I know my application was received?", answer: "After a successful submission, you will see a confirmation with your position and unique application reference. Save the reference for your records. A confirmation appears only after your application has been saved." },
    { question: "Can I apply for another position?", answer: "Yes. Explore the job directory and submit a separate application for another relevant position. Each application is associated with its selected role." },
    { question: "What should I check before accepting a role?", answer: "Confirm the employer, work location, deductions, working hours, and written terms before accepting any offer." },
  ];

  return (
    <div className={styles.page}>
      <div className="container">
        <header className={styles.intro}>
          <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link href="/jobs"><ArrowLeft size={14} aria-hidden="true" />All opportunities</Link><span>/</span><span aria-current="page">{job.title}</span></nav>
          <div className={styles.category}><span />{job.isExample ? "Example vacancy" : "Hiring Filipino talent"}<i />{job.category}</div>
          <h1>{job.title}<span>.</span></h1>
          <p className={styles.summary}>{job.summary}</p>
          <a href="#overview" className={styles.readDetails}>Read full job details <ArrowRight size={15} aria-hidden="true" /></a>
          <div className={styles.introMeta}><span><MapPin size={14} aria-hidden="true" />{job.location}</span><span><BriefcaseBusiness size={14} aria-hidden="true" />{job.experience}</span><span><CalendarDays size={14} aria-hidden="true" />{job.salaryStatus === "proposed-net" ? "Listed" : job.isExample ? "Example date" : "Posted"} {postedDate}</span></div>
        </header>

        <div className={styles.stage}>
          <div className={styles.photo}>
            <Image src={job.image} alt={job.imageAlt} fill loading="eager" fetchPriority="high" sizes="(max-width: 800px) 100vw, 60vw" style={{ objectPosition: job.imagePosition || "center 35%" }} />
            <div className={styles.feeBadge} data-fee-glow="badge"><ShieldCheck size={22} aria-hidden="true" /><strong>{noPlacementFee}</strong></div>
            <div className={styles.photoCaption}><span>Filipino talent. Opportunities in {job.location}.</span>{job.salaryStatus !== "proposed-net" && <small>The people behind progress.</small>}</div>
          </div>
          <aside className={styles.package} aria-label="Salary and application">
            <span className={styles.kicker}>Your next chapter starts here</span>
            <h2>Make your<br /><em>next move.</em></h2>
            {job.salary ? <JobSalary job={job} /> : <p className={styles.salaryPending}>Salary details to be confirmed.</p>}
            <div className={styles.packageFacts}>
              {openings && <div><Users size={16} aria-hidden="true" /><p><strong>{formatOpeningRange(openings)}</strong><span>positions available</span></p></div>}
              <div><MapPin size={16} aria-hidden="true" /><p><strong>{job.location}</strong><span>{role ? "For Filipino applicants" : job.employmentType}</span></p></div>
            </div>
            <ApplyLink job={job} />
            <p className={styles.applicationHint}>Have your CV ready. Apply in a few simple steps.</p>
            {job.isExample && <p className={styles.applicationHint}>Example vacancy · Applications are for demonstration purposes.</p>}
          </aside>
        </div>

        <div className={styles.highlights}>
          <div><House aria-hidden="true" /><p><strong>Free accommodation</strong><small>A place to settle in.</small></p></div>
          <div><BusFront aria-hidden="true" /><p><strong>Free transportation</strong><small>Support for your journey.</small></p></div>
          <div><Clock3 aria-hidden="true" /><p><strong>+10% overtime pay</strong><small>For overtime hours.</small></p></div>
          <div><CalendarDays aria-hidden="true" /><p><strong>+30% additional pay</strong><small>For holidays and Sundays.</small></p></div>
        </div>

        <div className={styles.readingLayout}>
          <aside className={styles.sectionNav} aria-label="On this page"><span className={styles.kicker}>Get to know the role</span><nav>{sections.map(([id, label], index) => <a key={id} href={`#${id}`}><span>{String(index + 1).padStart(2, "0")}</span>{label}</a>)}</nav><Link href="/contact" className={styles.questionLink}>Need a little guidance?<ArrowUpRight size={15} aria-hidden="true" /></Link></aside>
          <article id="position-overview" className={styles.article}>
            {job.isExample && <div className={styles.notice}>This is an example vacancy for exploring the application experience. It is not a confirmed opening with an employer. Photographs illustrate the profession.</div>}
            <RoleSection id="overview" number="01" title="Job description">
              <p className={styles.overview}>{job.description}</p>
              {role && <div className={styles.talentNote}><Users size={20} aria-hidden="true" /><p><strong>For Filipino workers ready for their next step.</strong><span>Bring the skills, experience and qualifications listed below.</span></p></div>}
            </RoleSection>
            <div className={styles.pairedSections}>
              <RoleSection id="responsibilities" number="02" title="Key responsibilities"><ul className={styles.checkList}>{job.responsibilities.map((item) => <li key={item}><Check size={15} aria-hidden="true" /><span>{item}</span></li>)}</ul></RoleSection>
              <RoleSection id="qualifications" number="03" title="Qualifications & requirements"><ul className={styles.checkList}>{job.requirements.map((item) => <li key={item}><Check size={15} aria-hidden="true" /><span>{item}</span></li>)}{role?.drivingLicenseIsPlus && <li><Check size={15} aria-hidden="true" /><span>A driver’s license is a plus (optional).</span></li>}</ul><p className={styles.smallNote}>Relevant experience: {job.experience}.</p></RoleSection>
            </div>
            <RoleSection id="assessment" number="04" title="Assessment & guidance">
              {role ? <>
                <p className={styles.sectionLead}>Review the qualification guidance and prepare for the assessment for this role.</p>
                <dl className={styles.credentials}><div><dt>NC2 guidance</dt><dd>{role.nc2}</dd></div><div><dt>Age requirement</dt><dd>{maximumAgeRequirement}</dd></div>{role.drivingLicenseIsPlus && <div><dt>Additional advantage</dt><dd>A driver’s license is a plus. Optional for this application.</dd></div>}</dl>
                {role.focus && <p className={styles.smallNote}>{role.focus.replace(" in the plan", "")}</p>}
                <h3 className={styles.subheading}>Skills assessment</h3><ul className={styles.checkList}>{role.testing.map((item) => <li key={item}><Check size={15} aria-hidden="true" /><span>{item}</span></li>)}</ul>
                <p className={styles.smallNote}>{fairDocumentTiming} Upload your CV and optionally attach the supporting documents you have available.</p>
              </> : <p className={styles.sectionLead}>The recruitment team can help with employer-specific assessment and document questions.</p>}
              <Link href="/contact" className={styles.inlineLink}>Application & document help <ArrowUpRight size={15} aria-hidden="true" /></Link>
            </RoleSection>
            <RoleSection id="compensation" number="05" title="Salary & available positions">
              <div className={styles.compensation}>
                <div>{job.salary ? <JobSalary job={job} /> : <p className={styles.sectionLead}>No verified salary has been provided.</p>}</div>
                <dl>
                  {openings && <div><dt>Available positions</dt><dd>{formatOpeningRange(openings)}</dd></div>}
                  <div><dt>Location</dt><dd>{job.location}</dd></div>
                  <div><dt>Experience</dt><dd>{job.experience}</dd></div>
                </dl>
              </div>
            </RoleSection>
            <RoleSection id="benefits" number="06" title="Benefits & support">
              <ul className={styles.benefitGrid}>{benefits.map((item) => <li key={item}><ShieldCheck size={18} aria-hidden="true" /><span>{item}</span></li>)}</ul>
              {isCroatia && <><div className={styles.futureHeading}><span className={styles.kicker}>Think beyond your first day</span><h3>Build a future in Croatia.</h3></div>
              <div className={styles.futureGrid}>{workingInCroatia.map((item) => <div key={item.title}><h4>{item.title}</h4><p>{item.text}</p><a href={item.source} target="_blank" rel="noopener noreferrer">Official guidance <ArrowUpRight size={13} aria-hidden="true" /></a></div>)}</div></>}
            </RoleSection>
            <RoleSection id="application-process" number="07" title="Recruitment process">
              <p className={styles.sectionLead}>{job.isExample ? "This example demonstrates submission and record creation only. A genuine vacancy would typically follow these stages." : "A typical recruitment journey. The employer may adjust the sequence or request a role-specific assessment."}</p>
              <ol className={styles.process}>{[
                ["Apply online", "Share your background, relevant skills and CV using the online form."],
                ["We review your skills", "The recruitment team reviews your information against the role requirements."],
                ["Meet & show your skills", "If shortlisted, discuss your experience and complete any role-specific assessment. The team will confirm the arrangements."],
                ["Plan your next step", "The team communicates the outcome. Review confirmed employment terms before accepting an offer."],
              ].map(([title, text], index) => <li key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{text}</p></li>)}</ol>
            </RoleSection>
            <RoleSection id="questions" number="08" title="A little more clarity"><div className={styles.faq}>{faqs.map((item) => <details key={item.question}><summary>{item.question}<Plus size={17} aria-hidden="true" /></summary><p>{item.answer}</p></details>)}</div></RoleSection>
            <div className={styles.finalCallout}><span className={styles.kicker}>Your skills can take you further</span><h2>Ready for your<br /><em>next move?</em></h2><ApplyLink job={job} /></div>
          </article>
        </div>

        {relatedJobs.length > 0 && <section className={styles.related}><div className={styles.relatedHeading}><div><span className={styles.kicker}>Keep your options open</span><h2>More ways to <em>move forward.</em></h2></div><Link href="/jobs">All opportunities <ArrowRight size={17} aria-hidden="true" /></Link></div><div className={styles.relatedGrid}>{relatedJobs.map((item, index) => <JobCard key={item.id} job={item} index={index} featured />)}</div></section>}
      </div>
      <MobileApply job={job} />
    </div>
  );
}
