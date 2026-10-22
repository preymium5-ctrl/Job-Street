import { BrandLockup } from "@/components/ui/Brand";
import { socialChannels } from "@/data/social";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, MessageSquare } from "lucide-react";

export function Footer() {
  return (
    <footer className="street-footer">
      <div className="container street-footer-top">
        <div>
          <Link href="/" aria-label="Jobs Street Croatia home"><BrandLockup /></Link>
          <p>Filipino skills. Croatian possibilities.<br />A new street to your next chapter.</p>
          <span className="street-footer-fee" data-fee-glow="badge">NO PLACEMENT FEE</span>
        </div>
        <div className="street-footer-nav">
          <div>
            <span>Explore</span>
            <Link href="/jobs">Available jobs</Link>
            <Link href="/apply">General application</Link>
            <Link href="/#industries">Our industries</Link>
            <Link href="/about#working-in-croatia">Working in Croatia</Link>
            <Link href="/#how-it-works">How to apply</Link>
          </div>
          <div>
            <span>Jobs Street Croatia</span>
            <Link href="/about">About us</Link>
            <Link href="/contact">Application help <ArrowUpRight size={14} /></Link>
            <Link href="/#faq">Common questions</Link>
            <Link href="/admin">Recruitment team</Link>
          </div>
          <div>
            <span>Around the web</span>
            <p>Follow us on Facebook and TikTok.</p>
            <ul className="street-socials" aria-label="Social channels">
              {socialChannels.map(({ name, icon, href }) => {
                const label = href ? name : `${name} — coming soon`;
                const image = icon ? (
                  <Image src={`/images/social/${icon}.svg`} alt={href ? "" : label} width={21} height={21} />
                ) : <MessageSquare size={21} aria-label={label} />;
                return (
                  <li key={name} title={href ? name : label}>
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${name} (opens in a new tab)`}>
                        {image}
                      </a>
                    ) : image}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
      <div className="container street-footer-bottom">
        <span>© {new Date().getFullYear()} Jobs Street Croatia</span>
        <div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms of use</Link></div>
        <span>Philippines <span aria-hidden="true">↗</span> Croatia</span>
      </div>
    </footer>
  );
}
