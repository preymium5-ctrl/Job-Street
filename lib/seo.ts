import type { Metadata, MetadataRoute } from "next";
import type { Job } from "./types";
import { site } from "../data/site";

type SeoEnvironment = Record<string, string | undefined>;

export function siteUrl(path = "/") {
  return new URL(path, site.url).toString();
}

/** Production is discoverable; local and Vercel preview deployments stay out of search. */
export function canIndexSite(env: SeoEnvironment = process.env) {
  if (env.CHAPTER_LOCAL_MODE === "true" || env.INDEX_SITE === "false") return false;
  if (env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development") return false;
  return env.INDEX_SITE === "true" || env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

export function searchRobots(indexable = true, env: SeoEnvironment = process.env): Metadata["robots"] {
  const index = indexable && canIndexSite(env);
  return {
    index,
    follow: true,
    googleBot: {
      index,
      follow: true,
      ...(index ? { "max-image-preview": "large" as const, "max-snippet": -1, "max-video-preview": -1 } : {}),
    },
  };
}

export function pageMetadata({ title, description, path, image = "/images/street-v2/hero-career.webp", imageAlt = "Filipino workers — Jobs Street Croatia, hiring in the Philippines", indexable = true }: {
  title: string;
  description: string;
  path: string;
  image?: string;
  imageAlt?: string;
  indexable?: boolean;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: siteUrl(path) },
    robots: searchRobots(indexable),
    openGraph: {
      title: `${title} | ${site.name}`,
      description,
      url: siteUrl(path),
      siteName: site.name,
      locale: "en_PH",
      type: "website",
      images: [{ url: siteUrl(image), alt: imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${site.name}`,
      description,
      images: [{ url: siteUrl(image), alt: imageAlt }],
    },
  };
}

export function discoverableJob(job: Job) {
  return job.status === "published" && !job.isExample;
}

export function jobPageMetadata(job: Job): Metadata {
  return pageMetadata({
    title: `${job.title} — Hiring Filipino Workers in ${job.location}`,
    description: `${job.title} in ${job.location} for Filipino applicants. Review the salary range, free accommodation and transportation, no placement fee, requirements and online application.`,
    path: `/jobs/${encodeURIComponent(job.slug)}`,
    image: job.image,
    imageAlt: job.imageAlt,
    indexable: discoverableJob(job),
  });
}

export function buildSitemap(jobs: Job[], env: SeoEnvironment = process.env): MetadataRoute.Sitemap {
  if (!canIndexSite(env)) return [];
  return [
    ...["/", "/jobs", "/about", "/contact"].map((path) => ({ url: siteUrl(path) })),
    ...jobs.filter(discoverableJob).map((job) => ({ url: siteUrl(`/jobs/${encodeURIComponent(job.slug)}`) })),
  ];
}

export function robotsRules(env: SeoEnvironment = process.env): MetadataRoute.Robots {
  const index = canIndexSite(env);
  return {
    rules: {
      userAgent: "*",
      ...(index ? { allow: "/", disallow: ["/admin", "/api/"] } : { disallow: "/" }),
    },
    ...(index ? { sitemap: siteUrl("/sitemap.xml") } : {}),
  };
}

/** Escaping < prevents applicant/staff-authored text from closing a JSON-LD script. */
export function serializeJsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function breadcrumbData(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: siteUrl(item.path),
    })),
  };
}

export function websiteData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": siteUrl("/#organization"), name: site.name, url: siteUrl(), logo: siteUrl("/icon.svg") },
      { "@type": "WebSite", "@id": siteUrl("/#website"), name: site.name, url: siteUrl(), inLanguage: "en-PH", publisher: { "@id": siteUrl("/#organization") } },
    ],
  };
}

export function webPageData(title: string, description: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": siteUrl(`${path}#webpage`),
    url: siteUrl(path),
    name: title,
    description,
    inLanguage: "en-PH",
    isPartOf: { "@id": siteUrl("/#website") },
  };
}

export function jobDirectoryData(jobs: Job[]) {
  return {
    ...webPageData("Jobs Street Croatia — Hiring in the Philippines", "Explore roles across our European destinations, with salaries, requirements and online applications.", "/jobs"),
    "@type": "CollectionPage",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: jobs.filter(discoverableJob).map((job, index) => ({
        "@type": "ListItem", position: index + 1, name: job.title, url: siteUrl(`/jobs/${encodeURIComponent(job.slug)}`),
      })),
    },
  };
}
