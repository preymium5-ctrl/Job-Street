import { CalendarClock, CheckCircle2, FileCheck2 } from "lucide-react";
import { fairDocuments, fairDocumentTiming, fairNc2Requirements, fairOptionalDocument, nc2ElectricalNote } from "@/data/job-fair";
import styles from "./ApplicationRequirements.module.css";

export function ApplicationRequirements() {
  return (
    <section className={styles.requirements} aria-labelledby="application-requirements-heading">
      <div className={styles.heading}>
        <span className={styles.headingIcon}><FileCheck2 size={22} aria-hidden="true" /></span>
        <div>
          <h3 id="application-requirements-heading">Document requirements</h3>
          <p>All positions:</p>
        </div>
      </div>
      <ul className={styles.documentList}>
        {fairDocuments.map((document) => (
          <li key={document}><CheckCircle2 size={19} aria-hidden="true" /><span>{document}</span></li>
        ))}
      </ul>
      <p className={styles.optional}>{fairOptionalDocument}</p>

      <div className={styles.timing}>
        <CalendarClock size={23} aria-hidden="true" />
        <div><strong>IMPORTANT</strong><p>{fairDocumentTiming}</p></div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption>NC2 certificate required by position</caption>
          <thead><tr><th scope="col">Position</th><th scope="col">Required NC2</th></tr></thead>
          <tbody>
            {fairNc2Requirements.map((requirement) => (
                <tr key={requirement.position}>
                  <th scope="row">{requirement.position}</th>
                  <td aria-describedby={requirement.electrical ? "application-electrical-note" : undefined}>{requirement.nc2}{requirement.electrical && "*"}</td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.electricalNote} id="application-electrical-note">* {nc2ElectricalNote}</p>
    </section>
  );
}
