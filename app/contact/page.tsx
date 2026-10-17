import { PageMotion } from "@/components/animations/PageMotion";
import type { Metadata } from "next";
import Link from "next/link";
import { Faq } from "@/components/ui/Faq";
import { ActionLink } from "@/components/ui/ActionLink";
import { pageMetadata } from "@/lib/seo";
export const metadata: Metadata = pageMetadata({
  title: "Application Help for Jobs Street Croatia",
  description:
    "Get help with applying, resume uploads, and application confirmation. Find confirmed recruitment contact details when available.",
  path: "/contact",
});
export default function Contact() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  return (
    <div className="container information-page">
      <div className="breadcrumb" data-enter>
        <Link href="/">Home</Link>
        <span>/</span>
        <span>Application help</span>
      </div>
      <span className="eyebrow" data-enter>
        A little guidance goes a long way
      </span>
      <h1 className="page-heading" data-enter>
        Let’s move
        <br />
        <span className="subtle-text">forward.</span>
      </h1>
      <p className="information-intro" data-enter>
        Help with your next step, from choosing a role to submitting your
        application.
      </p>
      <div className="help-grid">
        <div data-reveal>
          <Faq />
        </div>
        <aside className="help-panel" data-reveal>
          <h2>
            Start with
            <br />
            the right details.
          </h2>
          <p>
            Read the opportunity’s responsibilities and requirements. When
            you’re ready, have your CV and contact details to hand.
          </p>
          <ActionLink href="/jobs">Explore opportunities</ActionLink>
          <span className="eyebrow">Recruitment contact</span>
          <p>Jobs Street Croatia · Hiring in the Philippines</p>
          {email ? (
            <>
              <p>
                For application enquiries, include the position title and your
                application reference.
              </p>
              <a className="contact-email" href={`mailto:${email}`}>
                {email}
              </a>
            </>
          ) : (
            <p>
              Recruitment contact details will appear here when provided by the team.
              Keep your application reference for any enquiry.
            </p>
          )}
          <span className="eyebrow">Testing & documents</span>
          <p>
            Start with your CV and relevant qualifications. If shortlisted,
            the team will confirm your interview, any practical assessment and
            the documents needed for the work permit process.
          </p>
          <Link href="/jobs" className="text-link">Review role requirements ↗</Link>
        </aside>
      </div>
      <PageMotion />
    </div>
  );
}
