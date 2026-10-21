import Image from "next/image";
import { MessagesSquare } from "lucide-react";
import { socialChannels } from "@/data/social";
import { workAbroadResources } from "@/data/work-abroad-resources";
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

function ResourceLogos({ resources, duplicate = false }: {
  resources: readonly (typeof workAbroadResources)[number][];
  duplicate?: boolean;
}) {
  return (
    <ul className={`${styles.group} ${styles.resourceGroup}`} aria-hidden={duplicate || undefined}>
      {resources.map(({ name, src, href }) => (
        <li className={styles.resourceItem} key={src}>
          <a className={styles.resourceLink} href={href} target="_blank" rel="noopener noreferrer"
            aria-label={`${name} (opens in a new tab)`} title={name} tabIndex={duplicate ? -1 : undefined}>
            <span className={styles.resourceLogo}>
              <Image src={src} alt={name} fill sizes="(max-width: 700px) 138px, 164px" />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function CommunityMarquees() {
  const midpoint = Math.ceil(workAbroadResources.length / 2);
  const resourceRows = [workAbroadResources.slice(0, midpoint), workAbroadResources.slice(midpoint)];

  return (
    <>
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
      <section id="work-abroad-resources" className={`${styles.section} ${styles.resourcesSection}`} aria-labelledby="resources-heading">
        <div className={`container ${styles.socialHeading} ${styles.resourcesHeading}`}>
          <h2 id="resources-heading" className={styles.resourcesTitle}>Partnerships and useful links for work abroad</h2>
          <span>Explore organizations and resources for your next step.</span>
        </div>
        <div className={styles.resourceRows}>
          {resourceRows.map((resources, index) => (
            <div className={styles.socialWindow} key={index}>
              <div className={styles.track} style={{ animationDuration: `${resources.length * 6}s` }}>
                <ResourceLogos resources={resources} />
                <ResourceLogos resources={resources} duplicate />
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
