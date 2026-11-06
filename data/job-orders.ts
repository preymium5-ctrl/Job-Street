import type { Job } from "../lib/types";

// Copied from the published jobsincroatiaa.com offer on 31 October 2026 (100 slots).
// The salary range was supplied by the site operator as NET EUR per month.
// The employer, worksite, schedule and contract terms are not named in the
// source and remain to be confirmed; no benefits are inferred.
const printingPressOperatorSummary =
  "Operate web offset (coldset) printing presses and take responsibility for the quality of the printed product.";

export const printingPressOperatorJob: Job = {
  id: "job-order-offset-web-printing-press-operator",
  slug: "offset-web-printing-press-operator",
  title: "Offset Web Printing Press Operator (Coldset)",
  category: "Production & Manufacturing",
  location: "Croatia",
  employmentType: "Terms to be confirmed",
  summary: printingPressOperatorSummary,
  description: `${printingPressOperatorSummary} We are hiring experienced press operators for the printing industry in Croatia. The presses are manroland Geoman and manroland Uniset newspaper web presses. The displayed salary range is a NET amount in EUR per month; the employer, workplace, schedule and contract terms will be confirmed by the recruitment team.`,
  responsibilities: [
    "Prepare the presses for operation (make-ready).",
    "Carry out quality control of the printed output.",
    "Control delivered print quantities.",
    "Control paper waste (spoilage).",
    "Troubleshoot and fix minor machine faults.",
    "Cooperate with the print supervisor, production team and press assistant.",
    "Keep the work area clean and orderly.",
  ],
  requirements: [
    "Proven experience as a web offset / coldset press operator.",
    "Senior level: 5+ years of experience.",
    "Hands-on experience on manroland Geoman or manroland Uniset presses (or comparable newspaper / coldset web presses) is a strong advantage.",
    "Precision, technical knowledge and responsibility.",
    "Your CV should clearly state the press models you have operated and your years of experience on each.",
  ],
  benefits: [],
  experience: "Minimum 5 years as a web offset / coldset press operator",
  image: "/images/jobs/offset-web-printing-press-operator-20261031.webp",
  imageAlt: "AI-generated illustration of a Filipino coldset web offset printing press operator inspecting a newspaper beside an industrial newspaper press",
  imagePosition: "center",
  postedAt: "2026-10-31T00:00:00.000Z",
  status: "published",
  isExample: false,
  featured: false,
  salary: "€850–€1,000",
  salaryStatus: "proposed-net",
  openings: 100,
};

// Supplied by the site operator on 6 November 2026: 5–10 years of experience and
// €2,000 per month. Moved to the Czech Republic with a maximum age of 50 on
// 7 November 2026. Shown as NET EUR per month like the other listings. The
// employer, worksite, routes, schedule, slot count and contract terms are not
// supplied and remain to be confirmed; no benefits are inferred.
export const trailerTruckDriverMaximumAge = 50;
export const trailerTruckDriverAgeRequirement = `Applicants must be ${trailerTruckDriverMaximumAge} years old or below.`;

const trailerTruckDriverSummary =
  "Drive trailer trucks on assigned routes and deliver loads safely and on schedule.";

export const trailerTruckDriverJob: Job = {
  id: "job-order-trailer-truck-driver",
  slug: "trailer-truck-driver",
  title: "Trailer Truck Driver",
  category: "Transport & Logistics",
  location: "Czech Republic",
  employmentType: "Terms to be confirmed",
  summary: trailerTruckDriverSummary,
  description: `${trailerTruckDriverSummary} We are hiring experienced trailer truck drivers for work in the Czech Republic. The displayed salary is a NET amount in EUR per month; the employer, routes, workplace, schedule and contract terms will be confirmed by the recruitment team.`,
  responsibilities: [
    "Drive trailer trucks safely on the assigned routes.",
    "Inspect the truck and trailer before and after each trip and report any defects.",
    "Check that loads are correctly secured before departure.",
    "Deliver goods on schedule and complete delivery documents accurately.",
    "Follow traffic rules, driving and rest-time limits and company safety procedures.",
    "Keep the vehicle clean and in good working order.",
  ],
  requirements: [
    trailerTruckDriverAgeRequirement,
    "5–10 years of experience as a trailer truck driver.",
    "Valid driver’s licence for trucks with trailers (category CE or equivalent); conversion requirements for working in the Czech Republic will be confirmed by the recruitment team.",
    "Good knowledge of road safety, load securing and vehicle checks.",
    "Your CV should clearly state the truck and trailer types you have driven and your years of experience on each.",
    "Upload a copy of your driver’s licence (front and back) with your application.",
  ],
  benefits: [],
  experience: "5–10 years as a trailer truck driver",
  image: "/images/opportunities/transport-logistics.webp",
  imageAlt: "AI-generated illustration of a Filipino truck driver in a high-visibility vest checking a clipboard beside a truck",
  imagePosition: "center",
  postedAt: "2026-11-06T00:00:00.000Z",
  status: "published",
  isExample: false,
  featured: false,
  salary: "€2,000",
  salaryStatus: "proposed-net",
};

export const jobOrderJobs: Job[] = [printingPressOperatorJob, trailerTruckDriverJob];

/** Each received job order is published once under its own migration version. */
export const jobOrderReleases: { version: string; jobs: Job[] }[] = [
  { version: "job-order-printing-press-operator-2026-10-31-v1", jobs: [printingPressOperatorJob] },
  { version: "job-order-trailer-truck-driver-2026-11-06-v1", jobs: [trailerTruckDriverJob] },
];
