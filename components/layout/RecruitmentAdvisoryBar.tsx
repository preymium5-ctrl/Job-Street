"use client";

import { useEffect, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import { recruitmentAdvisory } from "@/data/employment";

/**
 * Fixed across the top of every page. The bar publishes its real height as
 * --advisory-bar-h so the floating header, sticky panels and anchor scrolling
 * sit below it when the text wraps on small screens.
 */
export function RecruitmentAdvisoryBar() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--advisory-bar-h", `${bar.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--advisory-bar-h");
    };
  }, []);
  return (
    <aside ref={ref} className="recruitment-advisory-bar" aria-label="Recruitment advisory">
      <p>
        <TriangleAlert size={16} aria-hidden="true" />
        <span>{recruitmentAdvisory.map((sentence) => <strong key={sentence}>{sentence}</strong>)}</span>
      </p>
    </aside>
  );
}
