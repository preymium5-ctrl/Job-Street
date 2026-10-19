import Image from "next/image";
import { MessagesSquare } from "lucide-react";
import { socialChannels } from "@/data/social";
import styles from "./CommunityMarquees.module.css";

function SocialLabel({ name, icon }: { name: string; icon: string | null }) {
  return (
    <>
      <span className={styles.socialIcon} aria-hidden="true">
        {icon ? (
          <Image src={`/images/social/${icon}.svg`} alt="" width={28} height={28} loading="eager" />
        ) : (
          <MessagesSquare size={28} strokeWidth={1.7} />
        )}
      </span>
      <span className={name === "X" ? styles.screenReaderOnly : undefined}>{name}</span>
    </>
  );
}

function SocialIcons({ duplicate = false }: { duplicate?: boolean }) {
  return (
    <ul className={`${styles.group} ${styles.socialGroup}`} aria-hidden={duplicate || undefined}>
      {socialChannels.map(({ name, icon, href }) => (
        <li className={styles.socialItem} key={name} title={href ? undefined : `${name} — coming soon`}>
          {href ? (
            <a className={styles.socialLink} href={href} target="_blank" rel="noopener noreferrer"
              aria-label={`${name} (opens in a new tab)`} tabIndex={duplicate ? -1 : undefined}>
              <SocialLabel name={name} icon={icon} />
            </a>
          ) : <SocialLabel name={name} icon={icon} />}
          <span className={styles.separator} aria-hidden="true">✳</span>
        </li>
      ))}
    </ul>
  );
}

export function CommunityMarquees() {
  return (
    <section id="community" className={styles.section} aria-labelledby="community-heading">
      <div className={`container ${styles.socialHeading}`}>
        <h2 id="community-heading" className="eyebrow">Around the web</h2>
        <span>Follow us on Facebook and TikTok.</span>
      </div>
      <div className={styles.socialWindow} aria-label="Social channels">
        <div className={styles.track}>
          <SocialIcons />
          <SocialIcons duplicate />
        </div>
      </div>
    </section>
  );
}
