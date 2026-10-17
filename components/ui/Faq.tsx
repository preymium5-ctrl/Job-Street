
export const applicationFaqs = [
  [
    "How do I apply for a job?",
    "Find a role that fits your experience, read its requirements, and select Apply now. Complete the four steps, attach your CV, and submit. Each application is linked to the position you choose.",
  ],
  [
    "What documents are required?",
    "Upload your current CV as a PDF, DOC, or DOCX file up to 5 MB. You can also attach a diploma or education certificate, NC2 certificate, NBI clearance, Form 18a, and another relevant document. Supporting documents are optional and accept PDF, DOC, DOCX, JPG, or PNG files up to 3 MB each; all uploads together must stay within 15 MB. You can apply while documents are still in progress.",
  ],
  [
    "Can I apply for multiple positions?",
    "Yes. Submit a separate application for each position that matches your skills. Tailor your professional summary to the role and keep the reference number for each application.",
  ],
  [
    "How will I know my application was received?",
    "After a successful submission, a confirmation appears with your position and a unique reference number. Save that reference. If an error appears, your application has not been confirmed and you can try again.",
  ],
  [
    "What happens after I apply?",
    "The recruitment team reviews the information you provide. Shortlisted applicants may be invited to an interview or skills assessment. The stages and timing depend on the position and employer; submission does not guarantee selection.",
  ],
  [
    "Where can I find salary details?",
    "Each opportunity shows its salary range and payment period. Check the role details and confirm the written employment terms with the recruitment team.",
  ],
  [
    "When are interviews and testing?",
    "Shortlisted applicants are contacted by the recruitment team to arrange an interview and any skills assessment required for the role. You will receive your own schedule and preparation instructions.",
  ],
  [
    "How can I contact the recruitment team?",
    "Visit Application help for guidance and available recruitment contact details. Keep your application reference handy so the team can find your records.",
  ],
];
export function Faq({ items = applicationFaqs }: { items?: string[][] }) {
  return (
    <div className="faq-list">
      {items.map(([q, a], i) => (
        <details key={q} className="faq-item">
          <summary>
            <span className="faq-number">0{i + 1}</span>
            <span>{q}</span>
            <span className="faq-plus" aria-hidden="true">
              +
            </span>
          </summary>
          <p>{a}</p>
        </details>
      ))}
    </div>
  );
}
