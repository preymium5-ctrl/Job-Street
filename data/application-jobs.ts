import type { Job } from "@/lib/types";
import { additionalPositionOptions, destinationCountries } from "./application-options";
import { applicationJobCategories, applicationJobProfiles } from "./application-job-profiles";
import { minimumExperienceRequirement, recruitmentBenefits } from "./employment";

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
  .map((title, index) => {
    const slug = positionSlug(title);
    const profile = applicationJobProfiles[title];
    if (!profile) throw new Error(`Missing application job profile: ${title}`);
    const category = applicationJobCategories[profile.category];
    const location = destinationCountries[index % destinationCountries.length];
    return {
      id: `additional-application-${slug}`,
      slug: `additional-${slug}`,
      title,
      category: category.name,
      location,
      employmentType: "Full-time",
      summary: profile.summary,
      description: `${profile.summary} Explore this ${title} opportunity in ${location} and apply with your relevant experience and supporting documents. The listed EUR monthly salary and available slots are recruitment ranges; the employer, final work location, duties and written terms will be confirmed during recruitment.`,
      responsibilities: [profile.summary, ...category.duties],
      requirements: [minimumExperienceRequirement, profile.skill, "Provide an updated CV and relevant supporting documents for recruitment review."],
      benefits: [...recruitmentBenefits],
      experience: "Minimum 3 years of relevant work experience",
      image: category.image,
      imageAlt: `AI-generated illustration of a Filipino male worker in ${category.name.toLowerCase()}`,
      postedAt: "2026-10-21T00:00:00.000Z",
      status: "published",
      isExample: false,
      featured: false,
      salary: "€850–€2,000",
      salaryStatus: "proposed-net",
      openingsRange: { min: 250, max: 1200 },
    };
  });

const additionalApplicationJobIds = new Set(additionalApplicationJobs.map((job) => job.id));

export function isAdditionalApplicationJob(job: { id: string }): boolean {
  return additionalApplicationJobIds.has(job.id);
}
