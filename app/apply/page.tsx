import type { Metadata } from "next";
import ApplicationForm from "@/components/applications/ApplicationForm";
import { getApplicationJobs } from "@/lib/public-jobs";
import { siteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "General application",
  description: "Apply directly with Jobs Street Croatia. Choose your preferred position, complete your details, and upload your CV, passport and supporting documents in one form.",
  alternates: { canonical: siteUrl("/apply") },
  robots: { index: false, follow: false },
};

export default async function GeneralApplicationPage() {
  return <ApplicationForm jobs={await getApplicationJobs()} />;
}
