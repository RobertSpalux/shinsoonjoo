import type { MetadataRoute } from "next";
import { getPublishedArticles } from "@/lib/articles";
import { BRAND } from "@/lib/brand";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await getPublishedArticles(undefined, 1000);

  const staticPages: MetadataRoute.Sitemap = [
    { url: BRAND.siteUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${BRAND.siteUrl}/news`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BRAND.siteUrl}/diagnosis`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BRAND.siteUrl}/recruit`, changeFrequency: "monthly", priority: 0.5 },
  ];

  const articlePages: MetadataRoute.Sitemap = articles.map((a) => ({
    url: `${BRAND.siteUrl}/news/${a.slug}`,
    lastModified: a.published_at ?? a.created_at,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [...staticPages, ...articlePages];
}
