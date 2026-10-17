import type { MetadataRoute } from "next";
import { getPublicJobs } from "@/lib/public-jobs";
import { buildSitemap, canIndexSite } from "@/lib/seo";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!canIndexSite()) return [];
  return buildSitemap(await getPublicJobs());
}
