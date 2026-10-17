import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, BusFront, House, ShieldCheck, Clock3, CalendarDays, Check, MoveUpRight } from "lucide-react";
import { StreetHero } from "@/components/home/StreetHero";
import { CommunityMarquees } from "@/components/home/CommunityMarquees";
import { PageMotion } from "@/components/animations/PageMotion";
import { Faq } from "@/components/ui/Faq";
import { JobSalary } from "@/components/jobs/JobSalary";
import { getPublicJobs } from "@/lib/public-jobs";
import { industries } from "@/data/industries";
import { site } from "@/data/site";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = { ...pageMetadata({ title: "Hiring Filipino Workers in Croatia", description: site.description, path: "/" }), title: { absolute: site.title } };
const benefits = [
  { icon: House, title: "A place to settle in.", text: "Free accommodation, so you can focus on your work and your next chapter.", label: "Accommodation" },
  { icon: BusFront, title: "Your journey, supported.", text: "Free transportation is included in the recruitment package.", label: "Transportation" },
  { icon: Clock3, title: "More for your extra hours.", text: "Additional 10% pay for overtime hours.", label: "Overtime" },
  { icon: CalendarDays, title: "Extra for special days.", text: "Additional 30% pay for holiday and Sunday hours.", label: "Holidays & Sundays" },
];
const steps = [
  { title: "Find your fit.", text: "Explore the roles, salary ranges and requirements. Choose the opportunity that matches your experience." },
  { title: "Tell your story.", text: "Complete your application with your details, work experience, CV and relevant supporting documents." },
  { title: "Meet the team.", text: "Shortlisted applicants are contacted about online interviews and role-specific skills assessments." },
  { title: "Take the next step.", text: "The recruitment team shares the decision and guides you through the next steps for your role." },
];
export default async function Home() {
  const jobs = await getPublicJobs();
  const selected = ["fabricator", "electrical-installer", "cnc-operator", "tig-rel-welder"].flatMap((slug) => jobs.find((job) => job.slug === slug) || []);
  return <>
    <StreetHero />
    <section className="street-stats" aria-label="Recruitment at a glance"><div className="container street-stats-inner"><div><strong>{jobs.length.toString().padStart(2, "0")}</strong><span>Skilled roles to explore</span></div><div><strong>05</strong><span>Essential industries</span></div><div data-fee-glow="text"><strong>€0</strong><span>Placement fee. Always.</span></div><div><strong>3<span>+</span></strong><span>Years of relevant experience</span></div></div></section>
    <section className="container street-intro street-space" id="introduction"><span className="street-kicker" data-reveal>Philippine talent. Croatian opportunity.</span><h2 data-reveal>You have the skills.<br />We help you find<br />your <em>next direction.</em></h2><div className="street-intro-bottom" data-reveal><p>Jobs Street Croatia is hiring skilled Filipino workers for careers in Croatia. Clear job information, practical benefits and <span data-fee-glow="text">no placement fee</span>. Your next chapter starts with a role that fits.</p><Link href="/about" className="street-pill street-pill-outline">Get to know us <span><ArrowUpRight size={18} /></span></Link></div></section>
    <section className="street-opportunities street-space" id="opportunities"><div className="container"><div className="street-section-top" data-reveal><div><span className="street-kicker">Opportunities, open to you</span><h2>Good work.<br />Real <em>possibilities.</em></h2></div><Link href="/jobs" className="street-pill street-pill-outline">Explore all {jobs.length} roles <span><ArrowUpRight size={18} /></span></Link></div><div className="street-roles">{selected.map((job, index) => <article className={`street-role ${index === 0 ? "street-role-featured" : ""}`} key={job.id} data-reveal><Image src={job.image} alt={job.imageAlt} fill sizes="(max-width: 700px) 100vw, (max-width: 1000px) 50vw, 33vw" className="street-role-photo" /><div className="street-role-top"><span>Croatia</span><Link href={`/jobs/${job.slug}`} aria-label={`View ${job.title}`}><ArrowUpRight size={22} /></Link></div><div className="street-role-content"><span className="street-role-category">{job.category}</span><h3><Link href={`/jobs/${job.slug}`}>{job.title}</Link></h3><JobSalary job={job} compact /><div className="street-role-fee" data-fee-glow="badge"><ShieldCheck size={15} /> No placement fee</div></div></article>)}</div><p className="street-image-note">Salary ranges in EUR per month, with estimated PHP equivalents.</p></div></section>
    <section className="street-benefits street-space" id="benefits"><div className="container"><div className="street-section-top" data-reveal><div><span className="street-kicker">A better way to begin</span><h2>Your work matters.<br />So does your <em>wellbeing.</em></h2></div><Link href="/about#working-in-croatia" className="street-pill">Life in Croatia <span><ArrowUpRight size={18} /></span></Link></div><div className="street-fee-banner" data-fee-glow="badge" data-reveal><ShieldCheck size={34} /><div><span>No hidden first step.</span><strong>NO PLACEMENT FEE</strong></div><span>More possibilities.<br />Fewer barriers.</span></div><div className="street-benefit-grid">{benefits.map(({ icon: Icon, title, text, label }) => <article key={label} data-reveal><Icon size={29} strokeWidth={1.3} /><span className="street-kicker">{label}</span><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>
    <section className="container street-industries street-space" id="industries"><div className="street-section-top" data-reveal><div><span className="street-kicker">Built around your experience</span><h2>Find your <em>field.</em></h2></div><p>Hands-on skill. Attention to detail.<br />There’s a place for what you do.</p></div><div className="street-industry-list">{industries.map((industry, index) => <Link href={`/jobs?industry=${encodeURIComponent(industry.name)}`} key={industry.name} className="street-industry" data-reveal><span className="street-industry-number">0{index + 1}</span><div className="street-industry-image"><Image src={industry.image} alt={industry.imageAlt} fill sizes="120px" /></div><h3>{industry.name}</h3><span className="street-industry-count">{jobs.filter((job) => job.category === industry.name).length} roles</span><span className="street-industry-arrow"><MoveUpRight size={24} strokeWidth={1.4} /></span></Link>)}</div></section>
    <section className="street-process street-space" id="how-it-works"><div className="container street-process-grid"><div className="street-process-heading" data-reveal><span className="street-kicker">From here to what’s next</span><h2>A clear path<br /><em>forward.</em></h2><p>Four steps to start your application.<br />One new direction to explore.</p><Link href="/jobs" className="street-pill">Take the first step <span><ArrowUpRight size={18} /></span></Link></div><div className="street-steps">{steps.map((step, index) => <div key={step.title} data-reveal><span>0{index + 1}</span><div><h3>{step.title}</h3><p>{step.text}</p></div><Check size={20} /></div>)}</div></div></section>
    <CommunityMarquees />
    <section className="container street-faq street-space" id="faq"><div data-reveal><span className="street-kicker">Before your next move</span><h2>Good <em>questions.</em><br />Clear answers.</h2><p>Everything starts with understanding your next step.</p><Link href="/contact" className="street-text-link">Get application help <ArrowUpRight size={18} /></Link></div><div data-reveal><Faq /></div></section>
    <section className="street-final" id="your-future"><Image src="/images/street-v2/hero-future.webp" alt="" fill sizes="100vw" /><div className="container street-final-inner"><span className="street-kicker" data-reveal>Your next chapter starts here</span><h2 data-reveal>Bring your skills.<br />Find your <em>future.</em></h2><div data-reveal><p>Croatia is your next direction.<br />Let’s find the role that takes you there.</p><Link href="/jobs" className="street-pill">Explore available jobs <span><ArrowUpRight size={18} /></span></Link></div></div></section>
    <PageMotion />
  </>;
}
