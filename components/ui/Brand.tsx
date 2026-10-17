import Image from "next/image";
export function BrandMark({ className = "" }: { className?: string }) {
  return <Image className={className} src="/brand/jobstreet-croatia-ribbon.png" width={192} height={100} style={{ objectFit: "contain" }} alt="" aria-hidden="true" />;
}
export function BrandLockup() {
  return <span className="brand-lockup" aria-label="Jobs Street Croatia"><BrandMark className="brand-mark" /><span className="brand-name"><span className="brand-name-prefix">Jobstreet</span><span className="brand-name-country">Croatia</span></span></span>;
}
