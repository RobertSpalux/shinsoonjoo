import type { Metadata } from "next";
import { notFound } from "next/navigation";
import crypto from "node:crypto";
import { getArticleBySlugPreview, getPublishedArticles } from "@/lib/articles";
import { getApprovedReview } from "@/lib/ad-reviews";
import { checkArticleBySlug } from "@/lib/compliance/server";
import ArticleView from "@/components/news/ArticleView";

// ⚠️ 심의 프리뷰 — is_main_published=false여도 '실제 게시될 화면'을 보여준다(§6.9 5-2~5-3).
// ISR 캐시를 타면 안 되므로 항상 동적 렌더.
export const dynamic = "force-dynamic";

// 검색 색인 절대 금지 — sitemap/llms에도 없고 robots.ts에서 /preview/ Disallow.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** 타이밍 세이프 토큰 비교(길이 선검사 후 timingSafeEqual). 불일치·누락은 404로 존재를 숨긴다. */
function tokenOk(provided: string | undefined): boolean {
  const secret = process.env.PREVIEW_SECRET;
  if (!secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export default async function PreviewArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { slug } = await params;
  const { token } = await searchParams;
  // 인증 실패 = 404 (401 아님). 라우트 존재 자체를 노출하지 않는다.
  if (!tokenOk(typeof token === "string" ? token : undefined)) notFound();

  const article = await getArticleBySlugPreview(slug);
  if (!article) notFound();

  const [review, relatedRaw, compliance] = await Promise.all([
    getApprovedReview(article.id, "main"),
    getPublishedArticles(article.category, 4),
    checkArticleBySlug(slug),
  ]);
  const related = relatedRaw.filter((a) => a.slug !== article.slug).slice(0, 3);

  // ⚠️ 서버 게이트(§6.10) — 버튼 우회로 URL을 직접 열어도 미통과면 캡처 화면을 내주지 않는다.
  //    A등급 또는 미확인 B등급이 있으면 사유를 보여주고 /admin으로 돌린다.
  if (compliance && compliance.level !== "clean") {
    const blocking = compliance.findings.filter((f) => f.grade === "A" || !f.acked);
    return (
      <main className="mx-auto max-w-2xl px-6 py-24 text-[var(--color-text-body)]">
        <h1 className="mb-4 text-xl font-bold text-red-700">컴플라이언스 검사 미통과 (§6.10)</h1>
        <p className="mb-6 text-sm">
          이 기사는 금지 표현 게이트를 통과하지 못해 심의용 캡처를 만들 수 없습니다.
          <b>{blocking.length}건</b>을 /admin에서 정리·확인한 뒤 다시 열어주세요.
        </p>
        <ul className="space-y-2 text-sm">
          {blocking.slice(0, 20).map((f, i) => (
            <li key={i} className="rounded border border-red-200 bg-red-50 px-3 py-2">
              <span className={`mr-2 font-bold ${f.grade === "A" ? "text-red-700" : "text-amber-700"}`}>
                [{f.grade}]
              </span>
              <b>{f.term}</b> · <span className="text-[var(--color-text-muted)]">{f.field}</span> — {f.guidance}
            </li>
          ))}
        </ul>
      </main>
    );
  }

  // 심의 신청용 = submission. 필수안내사항 전문 + 심의필 줄 공란(§6.3).
  // ⚠️ 워터마크·배너를 넣지 않는다 — 캡처에 찍히면 게시본과 달라진다.
  return <ArticleView article={article} related={related} review={review} mode="submission" />;
}
