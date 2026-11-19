import type { Metadata } from "next";
import VideoApplicationForm from "@/components/applications/VideoApplicationForm";
import { getApplicationJobs } from "@/lib/public-jobs";
import { siteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Video application",
  description: "Apply quickly with Jobs Street Croatia: enter your name, age, nationality, position, years of experience, WhatsApp and Telegram numbers, and upload a one-minute video of you doing the actual work.",
  alternates: { canonical: siteUrl("/apply/video") },
  robots: { index: false, follow: false },
};

export default async function VideoApplicationPage() {
  return <VideoApplicationForm jobs={await getApplicationJobs()} />;
}
