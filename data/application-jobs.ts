import type { Job } from "@/lib/types";
import { additionalPositionOptions } from "./application-options";

// The linked application form's primary job list matches these options. Keep
// positions already in the website catalog in its first application group.
const excludedPositions = new Set<string>([
  "Fabricator",
  "Welder",
  "Grinder",
  "Cleaner",
  "Other (enter below)",
  "No other position",
]);

function positionSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const additionalApplicationJobs: Job[] = [...new Set(additionalPositionOptions)]
  .filter((title) => !excludedPositions.has(title))
  .map((title) => {
    const slug = positionSlug(title);
    return {
      id: `additional-application-${slug}`,
      slug: `additional-${slug}`,
      title,
      category: "Other jobs we're offering",
      location: "Selected application destination",
      employmentType: "To be confirmed",
      summary: `Submit an application for the ${title} position.`,
      description: "Share your relevant work experience and supporting documents through the application form.",
      responsibilities: ["Position responsibilities will be confirmed during recruitment."],
      requirements: ["Relevant work experience in the selected position."],
      benefits: [],
      experience: "Relevant work experience",
      image: "/images/filipino-intro.webp",
      imageAlt: "Jobs Street Croatia application",
      postedAt: "2026-10-20T00:00:00.000Z",
      status: "published",
      isExample: false,
      featured: false,
    };
  });

const additionalApplicationJobIds = new Set(additionalApplicationJobs.map((job) => job.id));

export function isAdditionalApplicationJob(job: { id: string }): boolean {
  return additionalApplicationJobIds.has(job.id);
}
