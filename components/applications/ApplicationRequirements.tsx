import { CalendarClock, CheckCircle2, FileCheck2, Info } from "lucide-react";
import type { Job } from "@/lib/types";
import { fairDocuments, fairDocumentTiming, fairNc2Requirements, fairOptionalDocument, getJobFairRole, nc2ElectricalNote } from "@/data/job-fair";
import styles from "./ApplicationRequirements.module.css";

export function ApplicationRequirements({ job }: { job: Job }) {
  const role = getJobFairRole(job);

  return (
    <section className={styles.requirements} aria-labelledby="application-requirements-heading">
      <div className={styles.heading}>
        <span className={styles.headingIcon}><FileCheck2 size={22} aria-hidden="true" /></span>
        <div>
          <h4 id="application-requirements-heading">Documents required for every position</h4>
          <p>Plan ahead for your work permit application.</p>
        </div>
      </div>
      <ul className={styles.documentList}>
        {fairDocuments.map((document) => (
          <li key={document}><CheckCircle2 size={19} aria-hidden="true" /><span>{document}</span></li>
        ))}
      </ul>
      <p className={styles.optional}>{fairOptionalDocument} It is optional.</p>

      <div className={styles.timing}>
        <CalendarClock size={23} aria-hidden="true" />
        <div><strong>Important: document timing</strong><p>{fairDocumentTiming}</p></div>
      </div>
      <div className={styles.applicationNote}>
        <Info size={19} aria-hidden="true" />
        <p><strong>For this online application, your CV is the only required upload.</strong> Supporting documents are optional when you apply. You must obtain the required documents before the work permit application can be filed.</p>
      </div>

      <div className={styles.nc2Heading}>
        <h4>NC2 requirements by position</h4>
        <p>Check the certificate category for your trade.</p>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.screenReaderOnly}>Required NC2 certificates for the listed position groups</caption>
          <thead><tr><th scope="col">Position</th><th scope="col">Required NC2</th></tr></thead>
          <tbody>
            {fairNc2Requirements.map((requirement) => {
              const selected = Boolean(role && requirement.slugs.some((slug) => slug === job.slug));
              return (
                <tr key={requirement.position} className={selected ? styles.selectedRow : undefined}>
                  <th scope="row">{requirement.position}{selected && <span className={styles.rowHint}>Your role</span>}</th>
                  <td aria-describedby={requirement.electrical ? "application-electrical-note" : undefined}>{requirement.nc2}{requirement.electrical && "*"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.electricalNote} id="application-electrical-note"><strong>* Electrical categories:</strong> {nc2ElectricalNote}</p>
      <p className={styles.selectedRole}>
        <span>For {job.title}</span>
        <strong>{role?.nc2 || "Valid NC2 certificate; category to be confirmed by the recruitment team"}</strong>
      </p>
    </section>
  );
}
