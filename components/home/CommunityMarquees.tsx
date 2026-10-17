import Image from "next/image";
import { MessagesSquare } from "lucide-react";
import styles from "./CommunityMarquees.module.css";

const socialChannels = [
  { name: "Facebook", icon: "facebook-color" },
  { name: "Instagram", icon: "instagram-color" },
  { name: "TikTok", icon: "tiktok-color" },
  { name: "Threads", icon: "threads" },
  { name: "X", icon: "x" },
  { name: "Reddit", icon: "reddit-color" },
  { name: "Forums", icon: null },
];

function SocialIcons({ duplicate = false }: { duplicate?: boolean }) {
  return (
    <ul className={`${styles.group} ${styles.socialGroup}`} aria-hidden={duplicate || undefined}>
      {socialChannels.map(({ name, icon }) => (
        <li className={styles.socialItem} key={name}>
          <span className={styles.socialIcon} aria-hidden="true">
            {icon ? (
              <Image src={`/images/social/${icon}.svg`} alt="" width={28} height={28} loading="eager" />
            ) : (
              <MessagesSquare size={28} strokeWidth={1.7} />
            )}
          </span>
          <span className={name === "X" ? styles.screenReaderOnly : undefined}>{name}</span>
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
        <span>Our social channels are coming soon.</span>
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
