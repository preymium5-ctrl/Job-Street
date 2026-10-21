import assert from "node:assert/strict";
import { test } from "node:test";
import { proposedJobs } from "../data/jobs";
import { additionalApplicationJobs, isAdditionalApplicationJob } from "../data/application-jobs";
import { site } from "../data/site";
import { getApplicationJobs, getPublicJobBySlug, getPublicJobs, usesPublishedCatalog } from "../lib/public-jobs";
import config from "../next.config";
import { breadcrumbData, buildSitemap, canIndexSite, jobDirectoryData, jobPageMetadata, robotsRules, searchRobots, serializeJsonLd, siteUrl, webPageData } from "../lib/seo";

test("production indexing is enabled while local, preview and explicit pauses stay noindex", () => {
  assert.equal(canIndexSite({ VERCEL_ENV: "production" }), true);
  assert.equal(canIndexSite({ NODE_ENV: "production" }), true);
  assert.equal(canIndexSite({ INDEX_SITE: "true" }), true);
  for (const env of [
    {}, { NODE_ENV: "development" },
    { VERCEL_ENV: "preview", NODE_ENV: "production", INDEX_SITE: "true" },
    { VERCEL_ENV: "development", INDEX_SITE: "true" },
    { NODE_ENV: "production", CHAPTER_LOCAL_MODE: "true", INDEX_SITE: "true" },
    { VERCEL_ENV: "production", INDEX_SITE: "false" },
  ]) assert.equal(canIndexSite(env), false);
  const privatePage = searchRobots(false, { VERCEL_ENV: "production" });
  assert.ok(privatePage && typeof privatePage === "object");
  assert.equal(privatePage.index, false);
});

test("sitemap includes all listed application roles and excludes retired event pages, examples, closed jobs and applications", () => {
  const base = proposedJobs[0];
  const jobs = [...proposedJobs, ...additionalApplicationJobs,
    { ...base, slug: "example-role", isExample: true },
    { ...base, slug: "closed-role", status: "closed" as const },
    { ...base, slug: "draft-role", status: "draft" as const },
  ];
  const sitemap = buildSitemap(jobs, { VERCEL_ENV: "production" });
  assert.equal(sitemap.length, proposedJobs.length + additionalApplicationJobs.length + 4);
  assert.equal(new Set(sitemap.map(({ url }) => url)).size, proposedJobs.length + additionalApplicationJobs.length + 4);
  assert.ok(sitemap.every(({ url }) => !url.includes("/job-fair")));
  for (const job of [...proposedJobs, ...additionalApplicationJobs]) assert.ok(sitemap.some(({ url }) => url === siteUrl(`/jobs/${job.slug}`)));
  assert.ok(sitemap.every(({ url }) => url.startsWith(site.url) && !/apply|example-role|closed-role|draft-role|localhost/.test(url)));
  assert.deepEqual(buildSitemap(jobs, { VERCEL_ENV: "preview", INDEX_SITE: "true" }), []);
});

test("robots advertises the canonical sitemap and permits crawlers to see application noindex tags", () => {
  const robots = robotsRules({ VERCEL_ENV: "production" });
  assert.equal(robots.sitemap, siteUrl("/sitemap.xml"));
  assert.deepEqual(robots.rules, { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] });
  assert.deepEqual(robotsRules({ VERCEL_ENV: "preview" }), { rules: { userAgent: "*", disallow: "/" } });
});

test("role metadata uses unique canonical URLs and Philippines hiring descriptions", () => {
  const role = proposedJobs.find(({ slug }) => slug === "electrical-installer")!;
  const metadata = jobPageMetadata(role);
  assert.match(String(metadata.title), /Electrical Installer.*Hiring Filipino Workers in Croatia/);
  assert.match(metadata.description!, /salary range.*no placement fee/);
  assert.doesNotMatch(JSON.stringify(metadata), /job fair|proposed net salary/i);
  assert.equal(metadata.alternates?.canonical, siteUrl("/jobs/electrical-installer"));
  assert.equal(metadata.openGraph?.url, siteUrl("/jobs/electrical-installer"));
  const additionalRole = additionalApplicationJobs.find((job) => job.location !== "Croatia")!;
  const additionalMetadata = jobPageMetadata(additionalRole);
  assert.ok(String(additionalMetadata.title).includes(additionalRole.location));
  assert.ok(additionalMetadata.description!.includes(additionalRole.location));
  assert.equal(additionalMetadata.alternates?.canonical, siteUrl(`/jobs/${additionalRole.slug}`));
});

test("structured data describes published content and escapes untrusted script text", () => {
  const data = jobDirectoryData([...proposedJobs, ...additionalApplicationJobs, { ...proposedJobs[0], slug: "example", isExample: true }]);
  assert.equal(data.mainEntity.itemListElement.length, proposedJobs.length + additionalApplicationJobs.length);
  assert.equal(data["@type"], "CollectionPage");
  const serialized = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
  assert.equal(serialized.includes("<"), false);
  assert.equal(JSON.parse(serialized).name, "</script><script>alert(1)</script>");
  assert.equal(breadcrumbData([{ name: "Home", path: "/" }, { name: "Job fair", path: "/job-fair" }]).itemListElement[1].item, siteUrl("/job-fair"));
  assert.equal(webPageData("Job fair", "Event guide", "/job-fair")["@type"], "WebPage");
  assert.equal(/JobPosting|baseSalary|EventScheduled/.test(serializeJsonLd(data)), false);
});

test("configured alternate domains redirect to the primary host without a loop", async () => {
  const redirects = await config.redirects!();
  assert.equal(redirects.length, site.alternateHosts.length);
  for (const redirect of redirects) {
    assert.equal(redirect.destination, `${site.url}/:path*`);
    assert.equal(redirect.permanent, true);
    const pattern = redirect.has?.find(({ type }) => type === "host")?.value;
    assert.ok(pattern);
    assert.equal(new RegExp(`^(?:${pattern})$`).test(new URL(site.url).hostname), false);
  }
});

test("database-free production renders the published fair catalog without touching applicant storage", async () => {
  assert.equal(usesPublishedCatalog({ NODE_ENV: "production" }), true);
  assert.equal(usesPublishedCatalog({ NODE_ENV: "production", DATABASE_URL: "postgresql://configured" }), false);
  assert.equal(usesPublishedCatalog({ NODE_ENV: "production", CHAPTER_LOCAL_MODE: "true" }), false);
  assert.equal(usesPublishedCatalog({ NODE_ENV: "development" }), false);
  const original = { ...process.env };
  try {
    process.env = { ...original, NODE_ENV: "production" };
    delete process.env.DATABASE_URL;
    delete process.env.CHAPTER_LOCAL_MODE;
    const publicJobs = await getPublicJobs();
    const applicationJobs = await getApplicationJobs();
    assert.equal(publicJobs.length, proposedJobs.length + additionalApplicationJobs.length);
    assert.equal(publicJobs.filter(isAdditionalApplicationJob).length, additionalApplicationJobs.length);
    assert.equal(applicationJobs.length, proposedJobs.length + additionalApplicationJobs.length);
    assert.equal(applicationJobs.filter(isAdditionalApplicationJob).length, additionalApplicationJobs.length);
    assert.equal((await getPublicJobBySlug(additionalApplicationJobs[0].slug))?.id, additionalApplicationJobs[0].id);
    assert.equal((await getPublicJobBySlug("electrical-installer"))?.title, "Electrical Installer");
    assert.equal(await getPublicJobBySlug("missing-job"), undefined);
  } finally {
    process.env = original;
  }
});
