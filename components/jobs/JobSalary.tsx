import type { Job } from "@/lib/types";
import { SalaryConversion } from "./SalaryConversion";

export function JobSalary({ job, compact = false }: { job: Job; compact?: boolean }) {
  if (!job.salary) return null;
  const proposed = job.salaryStatus === "proposed-net";
  return (
    <div className={`job-pay${compact ? " job-pay-compact" : ""}`}>
      <span className="job-pay-label">
        Salary range
      </span>
      <div className="job-pay-amount">
        <strong>{job.salary}</strong>
        {proposed && <span>EUR / month</span>}
      </div>
      {proposed && <SalaryConversion salary={job.salary} />}
    </div>
  );
}

export function ProposedTermsNotice() {
  return (
    <div className="proposed-terms-notice">
      <span className="status-dot" />
      <div>
        <strong>Salary ranges in EUR per month</strong>
      </div>
    </div>
  );
}
