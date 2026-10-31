import { proposedJobs } from "./jobs";
import { additionalApplicationJobs } from "./application-jobs";
import { jobOrderJobs } from "./job-orders";

/** Shared by public pages, the application chooser and upload/submission validation. */
export const publishedCatalogJobs = [...proposedJobs, ...additionalApplicationJobs, ...jobOrderJobs];
