import { TriangleAlert } from "lucide-react";
import { recruitmentAdvisory } from "@/data/employment";

/** Shown in the site footer, on every job page and on the application forms. */
export function RecruitmentAdvisory({ variant = "inline" }: { variant?: "band" | "inline" }) {
  const content = (
    <p className="recruitment-advisory-text">
      <TriangleAlert size={variant === "band" ? 20 : 17} aria-hidden="true" />
      <span>
        {recruitmentAdvisory.map((sentence) => <strong key={sentence}>{sentence}</strong>)}
      </span>
    </p>
  );
  return (
    <aside className={`recruitment-advisory recruitment-advisory-${variant}`} aria-label="Recruitment advisory">
      {variant === "band" ? <div className="container">{content}</div> : content}
    </aside>
  );
}
