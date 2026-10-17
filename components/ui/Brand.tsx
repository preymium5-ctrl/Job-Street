import Image from "next/image";
export function BrandMark({ className = "" }: { className?: string }) {
  return <Image className={className} src="/brand/jobs-in-croatia-mark-512.png" width={64} height={64} alt="" aria-hidden="true" />;
}
export function BrandLockup() {
  return <span className="brand-lockup" aria-label="Jobs Street Croatia"><BrandMark className="brand-mark" /><span className="brand-name"><span className="brand-name-prefix">Jobs Street</span><span className="brand-name-country">Croatia<span className="street-brand-dot">.</span></span></span></span>;
}
