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

  // 상록수(evergreen)는 키워드 소유용 권위 문서 — 뉴스보다 높은 priority로 색인 우선순위를 준다
  const articlePages: MetadataRoute.Sitemap = articles.map((a) => ({
    url: `${BRAND.siteUrl}/news/${a.slug}`,
    lastModified: a.published_at ?? a.created_at,
    changeFrequency: "monthly",
    priority: a.content_type === "evergreen" ? 0.9 : 0.7,
  }));

  return [...staticPages, ...articlePages];
}
