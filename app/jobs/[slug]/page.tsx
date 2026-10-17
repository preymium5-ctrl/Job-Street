import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobDetails } from "@/components/jobs/JobDetails";
import { PageMotion } from "@/components/animations/PageMotion";
import { getPublicJobBySlug, getPublicJobs } from "@/lib/public-jobs";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbData, jobPageMetadata, webPageData } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const job = await getPublicJobBySlug(slug);
  if (!job) return { title: "Opportunity not found", robots: { index: false, follow: true } };
  return jobPageMetadata(job);
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const job = await getPublicJobBySlug(slug);
  if (!job) notFound();
  const jobs = await getPublicJobs();
  const relatedJobs = jobs
    .filter((item) => item.id !== job.id)
    .sort(
      (a, b) =>
        Number(b.category === job.category) -
        Number(a.category === job.category),
    )
    .slice(0, 3);
  // These role guides use WebPage markup. JobPosting requires confirmed employer facts.
  return (
    <>
      <JsonLd data={breadcrumbData([{ name: "Home", path: "/" }, { name: "Jobs abroad", path: "/jobs" }, { name: job.title, path: `/jobs/${encodeURIComponent(job.slug)}` }])} />
      <JsonLd data={webPageData(job.title, job.summary, `/jobs/${encodeURIComponent(job.slug)}`)} />
      <JobDetails job={job} relatedJobs={relatedJobs} />
      <PageMotion />
    </>
  );
}
