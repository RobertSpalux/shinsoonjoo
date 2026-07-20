import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArticleBySlug, getPublishedArticles, incrementViewCount } from "@/lib/articles";
import { getApprovedReview } from "@/lib/ad-reviews";
import { BRAND } from "@/lib/brand";
import ArticleView from "@/components/news/ArticleView";

export const revalidate = 60;
// 빌드 시점에 없던 slug(빌드 후 발행된 초안)도 요청 시 렌더 — SSG 404 방지.
// 초안은 getArticleBySlug의 발행 게이트(is_main_published AND published_at<=now)가 null을 돌려 계속 404.
export const dynamicParams = true;

export async function generateStaticParams() {
  const articles = await getPublishedArticles(undefined, 100);
  return articles.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) return { title: "글을 찾을 수 없습니다" };

  return {
    title: article.title,
    description: article.summary ?? undefined,
    alternates: { canonical: `/news/${article.slug}` },
    openGraph: {
      title: article.title,
      description: article.summary ?? undefined,
      type: "article",
      publishedTime: article.published_at ?? undefined,
      authors: [BRAND.personName],
      images: article.og_image_path ? [article.og_image_path] : undefined,
    },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) notFound();

  incrementViewCount(slug); // fire-and-forget

  const [review, relatedRaw] = await Promise.all([
    getApprovedReview(article.id, "main"),
    getPublishedArticles(article.category, 4),
  ]);
  const related = relatedRaw.filter((a) => a.slug !== article.slug).slice(0, 3);

  // 공개 페이지 = 게시용. 승인 심의필이 없으면 MandatoryNotice가 null → 렌더 안 함(§6.3).
  // 실제로는 trg_publish_gate가 미심의 발행을 막아 이 경로가 공개 상태로 나올 일은 없다.
  return <ArticleView article={article} related={related} review={review} mode="publish" />;
}
