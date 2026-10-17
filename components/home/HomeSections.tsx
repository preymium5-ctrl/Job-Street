import { BrandMark } from "@/components/ui/Brand";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Check, ArrowRight } from "lucide-react";
import { ActionLink } from "@/components/ui/ActionLink";
import { JobCard } from "@/components/jobs/JobCard";
import { Faq } from "@/components/ui/Faq";
import type { Job } from "@/lib/types";
import { ProposedTermsNotice } from "@/components/jobs/JobSalary";

export function Introduction() {
  return (
    <section id="introduction" className="container introduction section-space">
      <div className="section-label" data-reveal>
        <span className="eyebrow">01 / Your next opportunity</span>
        <span className="section-label-line" />
      </div>
      <div className="intro-layout">
        <h2 className="section-heading" data-reveal>
          More than a job.
          <br />A new <span className="subtle-text">beginning.</span>
        </h2>
        <div className="intro-copy" data-reveal>
          <p>
            A career is more than what you do.
            <br />
            It’s where you grow, what you build,
            <br />
            and the life you make along the way.
          </p>
          <p className="muted">
            We’re hiring skilled Filipino workers for opportunities in Croatia.
            Explore the roles, check the experience and
            qualifications for your trade, and apply with your CV.
          </p>
          <Link href="/about" className="text-link">
            About Jobs Street Croatia <ArrowUpRight size={18} />
          </Link>
        </div>
      </div>
      <div className="intro-visual-row">
        <div className="intro-image" data-reveal>
          <Image
            src="/images/street-v2/hero-skills.webp"
            alt="AI-generated illustration of Filipino technicians collaborating on a motor assembly"
            fill
            sizes="(max-width: 700px) 100vw, 60vw"
            data-parallax
          />
        </div>
        <div className="intro-manifesto" data-reveal>
          <BrandMark className="brand-spark" />
          <p>
            Because your
            <br />
            potential deserves
            <br />a place to grow.
          </p>
          <span className="eyebrow">Different skills. Shared ambition.</span>
        </div>
      </div>
    </section>
  );
}
export function FeaturedJobs({ jobs }: { jobs: Job[] }) {
  return (
    <section className="featured-section section-space" id="opportunities">
      <div className="container">
        <div className="section-label" data-reveal>
          <span className="eyebrow">02 / Selected opportunities</span>
          <span className="section-label-line" />
          <span className="eyebrow">Discover your direction ↘</span>
        </div>
        <div className="section-heading-row" data-reveal>
          <h2 className="section-heading">
            Explore what’s
            <br />
            <span className="subtle-text">possible.</span>
          </h2>
          <div className="section-side-copy">
            <p>
              From hands-on work to highly skilled trades.
              <br />
              Find a role that moves you forward.
            </p>
            <ActionLink href="/jobs" variant="outline">
              View all opportunities
            </ActionLink>
          </div>
        </div>
        {jobs.some((job) => job.salaryStatus === "proposed-net") && <ProposedTermsNotice />}
        {jobs.some((job) => job.isExample) && (
          <div className="sample-notice">
            <span className="status-dot" /> Development preview — these are
            example vacancies, not confirmed employer openings.
          </div>
        )}
        <div className="featured-grid">
          {jobs.slice(0, 4).map((job, i) => (
            <JobCard key={job.id} job={job} index={i} featured />
          ))}
        </div>
        {jobs.length === 0 && (
          <p className="muted">
            New featured opportunities will appear here as they are published.
            Explore the directory for all available roles.
          </p>
        )}
        <div className="section-end" data-reveal>
          <span>Every opportunity is a possible new beginning.</span>
          <Link href="/jobs" className="text-link">
            Find your next role <ArrowUpRight size={21} />
          </Link>
        </div>
      </div>
    </section>
  );
}
export function Industries({ jobs }: { jobs: Job[] }) {
  const sectors = [...new Set(jobs.map((job) => job.category))].map((name) => ({
    name,
    job: jobs.find((job) => job.category === name)!,
  }));
  return (
    <section id="industries" className="industries-section section-space">
      <div className="container">
        <div className="section-label" data-reveal>
          <span className="eyebrow">03 / A world of work</span>
          <span className="section-label-line" />
        </div>
        <div className="section-heading-row" data-reveal>
          <h2 className="section-heading">
            Your skill.
            <br />
            Your <span className="subtle-text">sector.</span>
          </h2>
          <p className="section-side-copy">
            Essential industries.
            <br />
            Extraordinary people.
            <br />
            Explore the work that suits you.
          </p>
        </div>
        <div className={`industry-grid${sectors.length === 5 ? " industry-grid-five" : ""}`}>
          {sectors.map((sector, i) => (
            <Link
              key={sector.name}
              href={`/jobs?industry=${encodeURIComponent(sector.name)}`}
              className={`industry-tile industry-tile-${i}`}
              data-reveal
            >
              <Image
                src={sector.job.image}
                alt={sector.job.imageAlt}
                fill
                sizes="(max-width:600px) 100vw, (max-width:1000px) 50vw, 25vw"
              />
              <div className="industry-shade" />
              <span className="industry-number">0{i + 1}</span>
              <span className="industry-caption">Explore your field</span>
              <div className="industry-tile-bottom">
                <h3>{sector.name}</h3>
                <span className="industry-arrow">
                  <ArrowUpRight size={22} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
const steps = [
  [
    "Discover opportunities",
    "Explore the roles. Find the match.",
    "Search by industry, location, and experience. Take time to read the details and see where your skills fit.",
  ],
  [
    "Make your introduction",
    "Your experience. Your story.",
    "Complete your online application and upload your CV. Review everything before taking the next step.",
  ],
  [
    "Meet the recruitment team",
    "A conversation about what’s next.",
    "Shortlisted applicants may be invited to an interview or skills assessment for the role.",
  ],
  [
    "Take your next step",
    "A decision. A new direction.",
    "The team shares the recruitment decision and any next steps. Timing and requirements vary by employer.",
  ],
];
export function Process() {
  return (
    <section id="how-it-works" className="process-section section-space">
      <div className="container">
        <div className="section-label" data-reveal>
          <span className="eyebrow">04 / From here to what’s next</span>
          <span className="section-label-line" />
        </div>
        <div className="process-layout">
          <div className="process-heading" data-reveal>
            <h2 className="section-heading">
              Four steps.
              <br />
              One new
              <br />
              <span className="subtle-text">future.</span>
            </h2>
            <p>
              A simple way to begin.
              <br />A clear idea of what comes next.
            </p>
            <ActionLink href="/jobs" variant="light">
              Take the first step
            </ActionLink>
            <span className="process-footnote">
              The process may vary by position and employer.
            </span>
          </div>
          <div className="timeline">
            {steps.map(([title, subtitle, description], i) => (
              <div className="timeline-step" key={title} data-reveal>
                <span className="step-number">0{i + 1}</span>
                <div>
                  <span className="eyebrow">{subtitle}</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
                <span className="timeline-point" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
export function WhyChooseUs() {
  return (
    <section className="container why-section section-space">
      <div className="section-label" data-reveal>
        <span className="eyebrow">05 / A better way to begin</span>
        <span className="section-label-line" />
      </div>
      <div className="why-layout">
        <div data-reveal>
          <BrandMark className="large-spark" />
          <h2 className="section-heading">
            Clarity at
            <br />
            every <span className="subtle-text">step.</span>
          </h2>
          <p className="why-intro">
            A good application experience starts with
            <br />
            the information you need and the support
            <br />
            to move forward.
          </p>
        </div>
        <div className="why-list">
          {[
            [
              "The details that matter",
              "Understand the role, responsibilities, and requirements before you apply.",
            ],
            [
              "Your application, simplified",
              "A guided four-step form, easy CV upload, and a confirmation you can save.",
            ],
            [
              "A place for your skills",
      "Explore opportunities across essential industries, all in one place.",
            ],
            [
              "Your information, treated carefully",
              "Resumes stay private. Only authorized recruitment staff can access submitted applications.",
            ],
          ].map(([title, copy], i) => (
            <div className="why-item" key={title} data-reveal>
              <span>0{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
              <Check size={22} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
export function TrustSection() {
  return (
    <section className="trust-section">
      <div className="container trust-inner" data-reveal>
        <span className="eyebrow">A little honesty goes a long way</span>
        <h2>
          Real information.
          <br />
          Thoughtful decisions.
        </h2>
        <div>
          <p>
            No invented promises. No unexplained next steps. Every role should
            give you the information you need to decide whether it’s right for
            you.
          </p>
          <Link href="/about" className="text-link">
            What you can expect <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}
export function HomeFaq() {
  return (
    <section className="container faq-section section-space" id="faq">
      <div className="section-label" data-reveal>
        <span className="eyebrow">06 / Before you begin</span>
        <span className="section-label-line" />
      </div>
      <div className="faq-layout">
        <div data-reveal>
          <h2 className="section-heading">
            Good
            <br />
            <span className="subtle-text">questions.</span>
          </h2>
          <p>
            A few things you might
            <br />
            be wondering about.
          </p>
          <Link href="/contact" className="text-link">
            Get application help <ArrowUpRight size={18} />
          </Link>
        </div>
        <div data-reveal>
          <Faq />
        </div>
      </div>
    </section>
  );
}
export function FinalCta() {
  return (
    <section id="your-future" className="final-cta" aria-labelledby="future-heading">
      <div className="final-cta-background" aria-hidden="true">
        <Image
          src="/images/street-v2/hero-future.webp"
          alt=""
          fill
          sizes="100vw"
          className="final-cta-photo"
        />
      </div>
      <div className="container">
        <div className="final-cta-top" data-reveal>
          <span className="eyebrow">This is your moment</span>
          <span className="eyebrow">Make the next move ↘</span>
        </div>
        <Link href="/jobs" className="final-cta-link" aria-label="Explore jobs in Croatia" data-reveal>
          <h2 id="future-heading">
            Your future
            <br />
            is waiting<span>.</span>
          </h2>
          <span className="final-cta-arrow" aria-hidden="true"><ArrowUpRight /></span>
        </Link>
        <div className="final-cta-bottom" data-reveal>
          <p>Let’s see where your skills can take you.</p>
          <ActionLink href="/jobs" variant="dark">
            Explore open positions
          </ActionLink>
        </div>
      </div>
    </section>
  );
}
