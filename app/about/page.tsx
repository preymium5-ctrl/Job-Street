import { PageMotion } from "@/components/animations/PageMotion";
import { BrandMark } from "@/components/ui/Brand";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ActionLink } from "@/components/ui/ActionLink";
import { EmploymentBenefits } from "@/components/jobs/EmploymentBenefits";
import { pageMetadata } from "@/lib/seo";
export const metadata: Metadata = pageMetadata({
  title: "Hiring in the Philippines for Jobs Street Croatia",
  description: "Explore skilled careers in Croatia for Filipino workers, with no placement fee, salary ranges, free transportation and accommodation, and online applications.",
  path: "/about",
});
export default function About() {
  return (
    <div className="container information-page">
      <div className="breadcrumb" data-enter><Link href="/">Home</Link><span>/</span><span>About Jobs Street Croatia</span></div>
      <span className="eyebrow" data-enter>Hiring skilled workers in the Philippines</span>
      <h1 className="page-heading" data-enter>Filipino talent.<br />A future in <span className="subtle-text">Croatia.</span></h1>
      <p className="information-intro" data-enter>Connect your skills with your next opportunity. Explore roles in Croatia, understand the employment package, and apply with confidence.</p>
      <div className="information-body">
        <aside className="information-side" data-reveal>
          <BrandMark className="brand-spark" />
          <h2>Every next<br />step matters.</h2>
          <p>Clear requirements. Practical support. <span data-fee-glow="text">No placement fee.</span></p>
          <ActionLink href="/jobs">Explore jobs in Croatia</ActionLink>
        </aside>
        <div>
          <div data-reveal>
            <h2>A clearer way forward.</h2>
            <p>Jobs Street Croatia is hiring skilled workers in the Philippines for roles in metal fabrication and welding, motor and generator production, electrical work, CNC machining and industrial finishing.</p>
            <h3>Built around your skills</h3>
            <p>Find a role that matches your experience. Review its responsibilities, qualifications, salary range and benefits, then apply with your CV and relevant documents.</p>
          </div>
          <section id="working-in-croatia" data-reveal>
            <h2>Working in Croatia</h2>
            <p>A practical employment package, with support for your next step abroad.</p>
            <EmploymentBenefits />
          </section>
          <div data-reveal>
            <h3>From application to your next step</h3>
            <p>Complete your details, describe your skills and attach your CV. The recruitment team reviews applications and contacts shortlisted candidates about interviews, assessments and employment arrangements.</p>
            <h3>Care for your information</h3>
            <p>Your application and documents are handled through the recruitment process. Read the <Link href="/privacy" className="text-link">privacy notice <ArrowUpRight size={15} /></Link> for details about data handling and access.</p>
          </div>
        </div>
      </div>
      <PageMotion />
    </div>
  );
}
