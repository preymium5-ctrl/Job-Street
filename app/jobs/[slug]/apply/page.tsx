import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ApplicationForm from "@/components/applications/ApplicationForm";
import { getPublicJobBySlug, getApplicationJobs } from "@/lib/public-jobs";
import { siteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const job = await getPublicJobBySlug(slug);
  return {
    title: job ? `Apply for ${job.title}` : "Application",
    description: job
      ? `Apply for ${job.title} with Jobs Street Croatia. Complete your personal details and work preferences, then attach your CV, passport and any other required documents.`
      : "Complete your job application with Jobs Street Croatia.",
    alternates: { canonical: siteUrl(`/jobs/${encodeURIComponent(slug)}/apply`) },
    robots: { index: false, follow: false },
  };
}

export default async function ApplyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const job = await getPublicJobBySlug(slug);
  if (!job || job.status !== "published") notFound();
  const jobs = (await getApplicationJobs()).filter((candidate) => candidate.status === "published");
  return <ApplicationForm key={job.id} job={job} jobs={jobs} />;
}
