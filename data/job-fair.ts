import type { Job } from "../lib/types";
import { hiringAllocations } from "./hiring-allocations";

export interface JobFairEmployer {
  name: string;
  workers: number;
  testing: string;
  roles: { slug: string; title: string; workers: number }[];
}

export interface JobFairRole {
  employers: { name: string; workers: number; testing: string }[];
  nc2: string;
  testing: string[];
  focus?: string;
  drivingLicenseIsPlus: boolean;
}

// Applicant-facing facts from Job_Fair_Philippines_2026_EN.pdf, dated 29 Sep 2026.
// Interview and testing dates were updated by the site owner on 15 Oct 2026.
// This historical organisation plan is not evidence of current accreditation,
// final contract terms, an exact venue, or an approved employment destination.
// Keep these archived counts unchanged. Current displayed counts are supplied
// separately by hiring-allocations.ts; certificate and testing guidance stays here.
export const jobFair = {
  title: "Job Fair Philippines 2026",
  organizers: ["BEI Manpower"],
  sourceDate: "2026-09-29",
  testingDateLabel: "16–20 November 2026",
  interviewDateLabel: "26 October – 14 November 2026",
  location: "Philippines",
  venue: "Testing centre to be confirmed",
  totalWorkers: 248,
  roleCount: 17,
  participationNote: "Participation and employer-specific terms to be confirmed.",
  employers: [
    {
      name: "Končar MK", workers: 5,
      testing: "Written exam.",
      roles: [{ slug: "fabricator", title: "Fabricator", workers: 5 }],
    },
    {
      name: "Đuro Đaković Montaža", workers: 25,
      testing: "Practical TIG / REL welding tests; written exam for pipe fitters.",
      roles: [
        { slug: "tig-rel-welder", title: "TIG / REL Welder", workers: 10 },
        { slug: "pipe-fitter", title: "Pipe Fitter", workers: 15 },
      ],
    },
    {
      name: "Končar GIM", workers: 35,
      testing: "Written exam for all positions except welders. Trade test for welders.",
      roles: [
        { slug: "mg-winding-insulator", title: "M/G Winding Insulator", workers: 5 },
        { slug: "mg-winding-production-worker", title: "M/G Winding Production Worker", workers: 5 },
        { slug: "mg-winding-processing-worker", title: "M/G Winding Processing Worker", workers: 5 },
        { slug: "sheet-metal-tinsmith-processor", title: "Sheet Metal / Tinsmith Processor", workers: 5 },
        { slug: "mg-assembly-fitter", title: "M/G Assembly Fitter", workers: 10 },
        { slug: "mig-mag-tig-rel-welder", title: "MIG MAG / TIG / REL Welder", workers: 5 },
      ],
    },
    {
      name: "Vertiv", workers: 75,
      testing: "Interviews with the client; welder test if needed.",
      roles: [
        { slug: "electrical-installer", title: "Electrical Installer", workers: 35 },
        { slug: "electrical-assembler", title: "Electrical Assembler", workers: 25 },
        { slug: "welder", title: "Welder", workers: 10 },
        { slug: "fabricator", title: "Fabricator", workers: 5 },
      ],
    },
    {
      name: "Novi Ferromont d.o.o.", workers: 30,
      testing: "Trade test.",
      roles: [
        { slug: "fabricator", title: "Fabricator", workers: 15 },
        { slug: "mig-mag-tig-welder", title: "MIG MAG / TIG Welder", workers: 5 },
        { slug: "cnc-operator", title: "CNC Operator", workers: 5 },
        { slug: "industrial-spray-painter", title: "Industrial Spray Painter", workers: 5 },
      ],
    },
    {
      name: "Ferokotao d.o.o.", workers: 78,
      testing: "Trade test.",
      roles: [
        { slug: "fabricator", title: "Fabricator", workers: 43 },
        { slug: "mig-mag-tig-rel-welder", title: "MIG MAG / TIG / REL Welder", workers: 15 },
        { slug: "robotic-welding-machine-operator", title: "Robotic Welding Machine Operator", workers: 4 },
        { slug: "cnc-operator", title: "CNC Operator", workers: 2 },
        { slug: "grinder-and-cleaner", title: "Grinder and Cleaner", workers: 6 },
        { slug: "industrial-spray-painter", title: "Industrial Spray Painter", workers: 8 },
      ],
    },
  ] satisfies JobFairEmployer[],
};

export const fairDocuments = [
  "Valid NC2 certificate",
  "High school diploma",
  "NBI clearance with apostille",
  "Form 18a (for Croatia applicants)",
] as const;

export const fairOptionalDocument = "A driving licence is a plus.";
export const fairDocumentTiming =
  "Documents do not have to be ready on the testing day — candidates must obtain them so the work permit application can be filed.";
export const nc2ElectricalNote =
  "The plan accepts NC2 Electrical categories related to electricians, including industrial electrician, building wiring installation and maintenance, power distribution, lineman, electrical installer and electrical assembler. The work profile specifically calls for industrial electricians.";

/** Published certificate groups; roles without a confirmed category stay unlisted. */
export const fairNc2Requirements = [
  { position: "Fabricators", nc2: "NC2 Fabricator", electrical: false, slugs: ["fabricator"] },
  { position: "Welders", nc2: "NC2 Welding", electrical: false, slugs: ["tig-rel-welder", "mig-mag-tig-rel-welder", "welder", "mig-mag-tig-welder"] },
  { position: "Electrical assemblers / installers", nc2: "NC2 Electrical", electrical: true, slugs: ["electrical-assembler", "electrical-installer"] },
  { position: "Motor & generator winding", nc2: "NC2 Fabricator or Electrical", electrical: true, slugs: ["mg-winding-insulator", "mg-winding-production-worker", "mg-winding-processing-worker"] },
  { position: "Motor & generator fitters / assemblers", nc2: "NC2 Electrical", electrical: true, slugs: ["mg-assembly-fitter"] },
  { position: "CNC operators", nc2: "NC2 Fabricator", electrical: false, slugs: ["cnc-operator"] },
  { position: "Industrial spray painters", nc2: "NC2 Fabricator", electrical: false, slugs: ["industrial-spray-painter"] },
  { position: "Grinders", nc2: "NC2 Fabricator", electrical: false, slugs: ["grinder-and-cleaner"] },
] as const;

export const jobFairFaqs: [string, string][] = [
  ["What is Job Fair Philippines 2026?", "It is a recruitment and skills-assessment plan for Filipino applicants exploring work abroad in Croatia. The plan lists 248 workers across 17 role types and six employer groups."],
  ["When are the online interviews and skills testing?", `Online interviews are scheduled for ${jobFair.interviewDateLabel}. Five full days of skills testing are planned for ${jobFair.testingDateLabel}, Monday to Friday. Confirm your appointment with the recruitment team.`],
  ["Which jobs abroad can I explore?", "The listed roles cover welding, fabrication, pipe fitting, electrical installation and assembly, CNC operation, industrial painting, motor and generator work, robotic welding, and grinding. Open a role to review its salary, experience and certificate guidance."],
  ["Where in the Philippines will the job fair testing take place?", "Testing is planned in the Philippines. Confirm the testing-centre address and individual attendance arrangements with the recruitment team."],
  ["How do I apply for the Croatia job fair from the Philippines?", "Choose a role, select Apply now, fill in your contact details and experience, and upload your CV. You can also attach supporting documents and provide NC2 details. A driver's license is a plus; the license details and copy are optional. Save the reference shown after submitting your application."],
];

const knownRoles: { slug: string; nc2: string; testing?: string[]; focus?: string }[] = [
  { slug: "fabricator", nc2: "NC2 Fabricator" },
  {
    slug: "tig-rel-welder", nc2: "NC2 Welding",
    testing: [
      "TIG welding exclusively in a fixture to simulate a difficult position and prevent weaving.",
      "SMAW (REL) welding.",
      "Candidates who pass both initial tests complete a TIG root pass and 1–2 REL passes on a larger-diameter pipe, minimum Ø139.7 × 12 mm.",
      "Visual inspection (VT); radiographic testing (RT) is not required in the plan.",
    ],
  },
  { slug: "pipe-fitter", nc2: "Valid NC2 certificate; category to be confirmed", testing: ["Written exam for pipe fitters."] },
  { slug: "mg-winding-insulator", nc2: "NC2 Fabricator or Electrical" },
  { slug: "mg-winding-production-worker", nc2: "NC2 Fabricator or Electrical" },
  { slug: "mg-winding-processing-worker", nc2: "NC2 Fabricator or Electrical" },
  { slug: "sheet-metal-tinsmith-processor", nc2: "Valid NC2 certificate; category to be confirmed" },
  { slug: "mg-assembly-fitter", nc2: "NC2 Electrical" },
  { slug: "mig-mag-tig-rel-welder", nc2: "NC2 Welding" },
  {
    slug: "electrical-installer", nc2: "NC2 Electrical",
    focus: "This role calls for industrial electricians. Lineman or data-centre experience alone does not match the work profile in the plan.",
  },
  {
    slug: "electrical-assembler", nc2: "NC2 Electrical",
    focus: "This role calls for industrial electricians. Lineman or data-centre experience alone does not match the work profile in the plan.",
  },
  { slug: "welder", nc2: "NC2 Welding" },
  { slug: "mig-mag-tig-welder", nc2: "NC2 Welding" },
  { slug: "cnc-operator", nc2: "NC2 Fabricator" },
  { slug: "industrial-spray-painter", nc2: "NC2 Fabricator" },
  { slug: "robotic-welding-machine-operator", nc2: "Valid NC2 certificate; category to be confirmed" },
  { slug: "grinder-and-cleaner", nc2: "NC2 Fabricator" },
  { slug: "cleaner", nc2: "Any role-specific certificate category to be confirmed", testing: ["Trade test."] },
];

/** Match source-controlled records by both ID and slug, never unrelated staff jobs. */
export function getJobFairRole(job: Pick<Job, "id" | "slug">): JobFairRole | undefined {
  const index = knownRoles.findIndex((role) => role.slug === job.slug);
  if (index === -1 || job.id !== `proposed-${job.slug}-${String(index + 1).padStart(2, "0")}`)
    return undefined;
  const role = knownRoles[index];
  const employers = jobFair.employers.flatMap((employer) => {
    const allocation = employer.roles.find((item) => item.slug === job.slug);
    if (!allocation) return [];
    const testing = employer.name === "Končar GIM"
      ? job.slug === "mig-mag-tig-rel-welder" ? "Trade test." : "Written exam."
      : job.slug === "pipe-fitter" ? "Written exam."
      : employer.name === "Vertiv" ? job.slug === "welder" ? "Interview with the client; welder test if needed." : "Interview with the client."
      : employer.testing;
    return [{ name: employer.name, workers: hiringAllocations[job.slug]?.[employer.name] ?? allocation.workers, testing }];
  });
  return {
    employers,
    nc2: role.nc2,
    // Page 5 explicitly places this optional advantage under "All positions".
    drivingLicenseIsPlus: true,
    testing: role.testing ?? [...new Set(employers.map((employer) => employer.testing))],
    ...(role.focus ? { focus: role.focus } : {}),
  };
}
