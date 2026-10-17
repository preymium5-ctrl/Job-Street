import Link from "next/link";
import { ArrowUpRight, ArrowRight } from "lucide-react";
export function ActionLink({
  href,
  children,
  variant = "primary",
  diagonal = true,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "dark" | "outline" | "light";
  diagonal?: boolean;
  className?: string;
}) {
  return (
    <Link href={href} className={`button button-${variant} ${className}`}>
      {children}
      {diagonal ? <ArrowUpRight size={19} /> : <ArrowRight size={19} />}
    </Link>
  );
}
