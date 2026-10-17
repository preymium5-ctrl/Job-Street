import type { Job } from "@/lib/types";
import { getJobFairRole } from "./job-fair";
import { maximumAgeRequirement, minimumExperienceRequirement, recruitmentBenefits } from "./employment";
import { hiringWorkerTotal } from "./hiring-allocations";

type Proposal = Pick<
  Job,
  "slug" | "title" | "category" | "openings" | "salary" | "summary" | "responsibilities" | "requirements"
> & { featured?: boolean };

// Operator-supplied salaries and counts, reconciled against the dated job-fair plan.
// Duties and skills remain indicative; the document does not establish final terms.
const proposals: Proposal[] = [
  {
    slug: "fabricator", title: "Fabricator", category: "Metal Fabrication & Welding",
    openings: 68, salary: "€850–€1,100", featured: true,
    summary: "Prepare, shape, and assemble metal components with attention to drawings, dimensions, and finish quality.",
    responsibilities: [
      "Interpret approved fabrication drawings and check dimensions before preparing materials.",
      "Measure, mark, cut, and shape metal components using suitable workshop equipment.",
      "Assemble parts and check alignment, fit, and finish before the next production stage.",
    ],
    requirements: [
      "Relevant metal fabrication experience and familiarity with workshop drawings.",
      "Careful use of measuring tools and the equipment relevant to the assigned fabrication process.",
      "Ability to identify dimensional differences and communicate them to the supervisor.",
    ],
  },
  {
    slug: "tig-rel-welder", title: "TIG / REL Welder", category: "Metal Fabrication & Welding",
    openings: 10, salary: "€1,000–€1,300", featured: true,
    summary: "Prepare and join metal using TIG or REL welding processes within an approved fabrication scope.",
    responsibilities: [
      "Check joint preparation, material identity, and the applicable welding procedure before starting.",
      "Set up TIG or REL welding equipment for the assigned material and joint configuration.",
      "Join components and visually check completed welds before the required quality inspection.",
    ],
    requirements: [
      "Practical experience in the TIG or REL welding processes relevant to the work.",
      "Ability to interpret welding instructions and recognise visible joint defects.",
      "Process qualifications and test requirements must be confirmed by the employer.",
    ],
  },
  {
    slug: "pipe-fitter", title: "Pipe Fitter", category: "Metal Fabrication & Welding",
    openings: 15, salary: "€950–€1,250",
    summary: "Measure, prepare, and fit pipework accurately from approved drawings and assembly instructions.",
    responsibilities: [
      "Read the approved pipework drawings and verify dimensions and component specifications.",
      "Measure, cut, prepare, and align pipes and fittings for the assigned joining process.",
      "Check fitted assemblies and record issues before inspection or testing by authorised staff.",
    ],
    requirements: [
      "Relevant pipe fitting experience and confidence reading pipework drawings.",
      "Accurate measurement and familiarity with suitable pipe preparation and alignment tools.",
      "Material, joining method, and any required qualifications are subject to employer confirmation.",
    ],
  },
  {
    slug: "mg-winding-insulator", title: "M/G Winding Insulator", category: "Motor & Generator Production",
    openings: 5, salary: "€800–€950",
    summary: "Prepare and position insulation materials for motor and generator winding assemblies.",
    responsibilities: [
      "Identify the specified insulation materials and check them against the production instructions.",
      "Prepare and fit insulation around winding components without damaging the material.",
      "Inspect coverage, positioning, and visible condition before passing the assembly onward.",
    ],
    requirements: [
      "Careful manual assembly skills and attention to insulation quality.",
      "Ability to follow material identification and component handling instructions.",
      "Relevant winding or electrical production experience can be described for employer review.",
    ],
  },
  {
    slug: "mg-winding-production-worker", title: "M/G Winding Production Worker", category: "Motor & Generator Production",
    openings: 5, salary: "€800–€950",
    summary: "Support the preparation and production of motor and generator winding components.",
    responsibilities: [
      "Prepare the assigned wire, components, and tooling according to the work order.",
      "Carry out the allocated winding production tasks under documented operating instructions.",
      "Check component condition and record quantities and production issues for the next shift.",
    ],
    requirements: [
      "Ability to follow repeatable production instructions and maintain accurate counts.",
      "Care with wire handling, component identification, and visual quality checks.",
      "Any equipment training and previous production experience requirements must be confirmed.",
    ],
  },
  {
    slug: "mg-winding-processing-worker", title: "M/G Winding Processing Worker", category: "Motor & Generator Production",
    openings: 5, salary: "€850–€1,000",
    summary: "Carry out assigned processing stages for motor and generator windings with consistent quality checks.",
    responsibilities: [
      "Confirm the component, batch information, and processing stage before beginning work.",
      "Perform the assigned winding treatment or finishing tasks to the approved instructions.",
      "Record process observations and separate components requiring further quality review.",
    ],
    requirements: [
      "Attention to detail in a production or component processing environment.",
      "Ability to follow controlled processing instructions and complete traceability records.",
      "The specific process, equipment, materials, and training requirements remain to be confirmed.",
    ],
  },
  {
    slug: "sheet-metal-tinsmith-processor", title: "Sheet Metal / Tinsmith Processor", category: "Metal Fabrication & Welding",
    openings: 5, salary: "€850–€1,050",
    summary: "Measure, cut, form, and finish sheet metal components to the assigned production drawings.",
    responsibilities: [
      "Mark out sheet material and check dimensions and allowances against approved drawings.",
      "Cut, bend, and form components using the tools appropriate to the specified material.",
      "Check edges, shape, and fit and prepare finished parts for assembly or inspection.",
    ],
    requirements: [
      "Relevant sheet metal work, tinsmith work, or metal forming experience.",
      "Confidence using measuring tools and reading fabrication dimensions.",
      "Ability to handle sheet materials safely and identify sharp edges or damaged components.",
    ],
  },
  {
    slug: "mg-assembly-fitter", title: "M/G Assembly Fitter", category: "Motor & Generator Production",
    openings: 10, salary: "€900–€1,150",
    summary: "Fit motor and generator components into carefully aligned assemblies using approved technical instructions.",
    responsibilities: [
      "Check component identity and assembly sequence against the approved work instructions.",
      "Fit and secure mechanical components using the specified tools and assembly methods.",
      "Inspect alignment, clearances, and fastenings and record concerns before quality handover.",
    ],
    requirements: [
      "Relevant mechanical fitting or motor and generator assembly experience.",
      "Ability to interpret assembly drawings and use appropriate measuring and hand tools.",
      "Care in following fastening, alignment, and component handling instructions.",
    ],
  },
  {
    slug: "mig-mag-tig-rel-welder", title: "MIG MAG / TIG / REL Welder", category: "Metal Fabrication & Welding",
    openings: 20, salary: "€950–€1,300",
    summary: "Support fabrication through the MIG MAG, TIG, or REL welding process specified for each assembly.",
    responsibilities: [
      "Confirm the required process, material, joint design, and approved welding instructions.",
      "Prepare joints and set up the welding equipment within the assigned scope of authorisation.",
      "Complete welding and inspect visible joint quality before the required follow-up inspection.",
    ],
    requirements: [
      "Experience in the welding processes relevant to the assigned components.",
      "Ability to read fabrication drawings and follow documented welding procedures.",
      "The employer must confirm which processes, qualifications, and weld tests are required.",
    ],
  },
  {
    slug: "electrical-installer", title: "Electrical Installer", category: "Electrical",
    openings: 35, salary: "€900–€1,200", featured: true,
    summary: "Install electrical components and cable routes from approved drawings within the assigned safety controls.",
    responsibilities: [
      "Review approved electrical drawings and confirm the assigned installation scope.",
      "Fit cable routes, wiring, and electrical components within the authorised work instructions.",
      "Label completed work and document issues for inspection and testing by authorised personnel.",
    ],
    requirements: [
      "Relevant electrical installation experience and familiarity with electrical drawings.",
      "Understanding of electrical isolation and the limits of personal authorisation.",
      "Mandatory licences, credentials, voltage systems, and testing responsibilities must be confirmed.",
    ],
  },
  {
    slug: "electrical-assembler", title: "Electrical Assembler", category: "Electrical",
    openings: 25, salary: "€850–€1,100",
    summary: "Assemble and connect electrical components with care for wiring accuracy, identification, and traceability.",
    responsibilities: [
      "Identify components and wiring from the approved assembly drawings and work order.",
      "Prepare conductors and assemble connections using the specified tools and methods.",
      "Check labels, component placement, and visible connection quality before inspection.",
    ],
    requirements: [
      "Relevant electrical assembly or wiring experience and careful manual working skills.",
      "Ability to follow connection diagrams, component references, and assembly instructions.",
      "Equipment-specific training, testing duties, and credentials are subject to employer confirmation.",
    ],
  },
  {
    slug: "welder", title: "Welder", category: "Metal Fabrication & Welding",
    openings: 10, salary: "€900–€1,200",
    summary: "Prepare and join metal components to the welding procedure and quality standard assigned to the work.",
    responsibilities: [
      "Check fabrication drawings, joint preparation, and material identity before welding.",
      "Set up equipment and join components using the authorised welding process.",
      "Inspect visible weld quality, report defects, and complete the required job records.",
    ],
    requirements: [
      "Relevant welding experience and the ability to follow fabrication instructions.",
      "Attention to joint preparation, weld appearance, and safe equipment handling.",
      "The welding process, material, qualification standard, and any trade test remain to be confirmed.",
    ],
  },
  {
    slug: "mig-mag-tig-welder", title: "MIG MAG / TIG Welder", category: "Metal Fabrication & Welding",
    openings: 5, salary: "€950–€1,250",
    summary: "Join fabricated components using MIG MAG or TIG welding as specified by the approved work instructions.",
    responsibilities: [
      "Confirm the material, joint preparation, and MIG MAG or TIG welding procedure for each task.",
      "Adjust equipment within the approved settings and weld the assigned components.",
      "Check completed joints and identify welds that require corrective work or inspection.",
    ],
    requirements: [
      "Practical experience with MIG MAG or TIG welding relevant to the proposed work.",
      "Ability to read fabrication drawings and recognise visible weld defects.",
      "Required process qualifications, material experience, and testing standards must be confirmed.",
    ],
  },
  {
    slug: "cnc-operator", title: "CNC Operator", category: "CNC & Machining",
    openings: 7, salary: "€900–€1,150", featured: true,
    summary: "Operate assigned CNC equipment and check machined components against documented dimensions and tolerances.",
    responsibilities: [
      "Check the work order, tooling, material, and approved machine setup before operation.",
      "Load and monitor the assigned CNC machining cycle within the authorised operating procedure.",
      "Measure components at the required intervals and report tool wear or dimensional differences.",
    ],
    requirements: [
      "Relevant CNC operating experience and familiarity with technical dimensions and tolerances.",
      "Ability to use the measuring tools appropriate to the assigned machining process.",
      "Machine type, controls, setup duties, and any programming requirements remain to be confirmed.",
    ],
  },
  {
    slug: "industrial-spray-painter", title: "Industrial Spray Painter", category: "Industrial Finishing",
    openings: 13, salary: "€850–€1,050",
    summary: "Prepare industrial components and apply specified coatings with attention to coverage and finish quality.",
    responsibilities: [
      "Check surface preparation, masking, and coating instructions for the assigned component.",
      "Prepare and apply the approved coating using the authorised spray equipment and method.",
      "Inspect visible coverage and finish, record coating information, and report defects.",
    ],
    requirements: [
      "Relevant industrial surface preparation or spray painting experience.",
      "Ability to follow coating instructions and recognise visible finish defects.",
      "Awareness of ventilation, respiratory protection, and safe coating material handling.",
    ],
  },
  {
    slug: "robotic-welding-machine-operator", title: "Robotic Welding Machine Operator", category: "Metal Fabrication & Welding",
    openings: 4, salary: "€950–€1,250",
    summary: "Load, monitor, and check an assigned robotic welding cell within approved machine safety procedures.",
    responsibilities: [
      "Confirm the work order, components, fixtures, and approved welding cell setup.",
      "Load components and operate the authorised cycle while maintaining machine guarding controls.",
      "Inspect completed assemblies and report weld defects, fixture issues, or machine alarms.",
    ],
    requirements: [
      "Relevant automated production or robotic welding cell operating experience.",
      "Ability to follow machine instructions and recognise issues in component fit or weld appearance.",
      "Robot brand, programming duties, equipment training, and qualification requirements must be confirmed.",
    ],
  },
  {
    slug: "grinder-and-cleaner", title: "Grinder and Cleaner", category: "Industrial Finishing",
    openings: 6, salary: "€800–€950",
    summary: "Grind, deburr, and clean metal components to prepare consistent surfaces for the next production stage.",
    responsibilities: [
      "Check the assigned component and identify the edges or surfaces requiring finishing.",
      "Use the approved grinding and cleaning tools to remove burrs and prepare surfaces.",
      "Inspect the finished component and keep the work area clear of dust and debris.",
    ],
    requirements: [
      "Careful handling of hand tools and attention to surface finish quality.",
      "Ability to follow finishing instructions and avoid damaging component dimensions.",
      "Awareness of eye, hearing, dust, and machine safety controls; specific training must be confirmed.",
    ],
  },
];

// Keep the previous seed content for precise, non-destructive upgrades of existing
// database records. This version is never used as the public catalog.
export const proposalV1Jobs: Job[] = proposals.map((proposal, index) => ({
  ...proposal,
  id: `proposed-${proposal.slug}-${String(index + 1).padStart(2, "0")}`,
  location: "Location to be confirmed",
  employmentType: "Terms to be confirmed",
  description: `${proposal.summary} This role is part of an operator-supplied workforce proposal. The duties and skills listed here are indicative, and the employer, work location, schedule, contract, and final requirements remain to be confirmed. The displayed salary is a proposed NET amount in EUR per month, not a confirmed employer offer.`,
  responsibilities: [
    ...proposal.responsibilities,
    "Keep clear work records and communicate defects, missing information, or production concerns promptly.",
    "Follow the employer's confirmed safety procedures and operate equipment only after appropriate training and authorisation.",
  ],
  requirements: [
    ...proposal.requirements,
    "Final duties, experience requirements, licences, and any trade tests are subject to employer confirmation.",
  ],
  benefits: [],
  experience: "Relevant experience to be reviewed; employer requirements to be confirmed",
  image: `/images/jobs/proposed/${proposal.slug}.webp`,
  imageAlt: `AI-generated illustration of ${proposal.title.toLowerCase()} work; not a photograph of a confirmed employer or workplace`,
  imagePosition: "center",
  postedAt: new Date(Date.parse("2026-10-15T00:00:00.000Z") - index).toISOString(),
  status: "published",
  isExample: false,
  featured: proposal.featured ?? false,
  salaryStatus: "proposed-net",
}));

export const previousRecruitmentJobs: Job[] = proposalV1Jobs.map((job) => {
  const fairRole = getJobFairRole(job);
  if (!fairRole) return job;
  return {
    ...job,
    image: `/images/jobs/filipino/${job.slug}.webp`,
    imageAlt: `AI-generated illustration of a Filipino worker performing ${job.title.toLowerCase()} work`,
    description: `${job.summary} This position is included in the Job Fair Philippines organisation plan dated 29 September 2026. Employer allocations, planned screening and candidate document guidance are listed below. Duties are indicative; the work location, schedule, contract and employer-specific terms still need confirmation. The displayed salary is a proposed NET amount in EUR per month.`,
    requirements: [
      ...job.requirements,
      `NC2 requirement in the job fair plan: ${fairRole.nc2}.`,
      ...(fairRole.focus ? [fairRole.focus] : []),
    ],
  };
});

export const proposedJobs: Job[] = previousRecruitmentJobs.map((job) => ({
  ...job,
  image: `/images/street-v2/${job.slug}.webp`,
  imageAlt: `AI-generated illustration of a Filipino worker performing ${job.title.toLowerCase()} work for Jobs Street Croatia`,
  openings: hiringWorkerTotal(job.slug) ?? job.openings,
  location: "Croatia",
  experience: "Minimum 3 years of relevant work experience",
  description: `${job.summary} We are hiring skilled Filipino workers for this position in Croatia. Review the responsibilities, qualifications, salary range and benefits below, then apply with your CV and relevant supporting documents.`,
  requirements: [maximumAgeRequirement, minimumExperienceRequirement, ...job.requirements.map((item) => item
    .replace("NC2 requirement in the job fair plan:", "NC2 requirement:")
    .replace(" in the plan", ""))],
  benefits: [...recruitmentBenefits],
}));

// Kept for the existing read-only route smoke script and other catalog consumers.
export const sampleJobs = proposedJobs;
