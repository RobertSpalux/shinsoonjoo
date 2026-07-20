import type { Metadata } from "next";
import Link from "next/link";
import { getPublishedArticles, CATEGORIES } from "@/lib/articles";
import { getCareer } from "@/lib/brand";
import ArticleCard from "@/components/news/ArticleCard";

export const revalidate = 300; // ISR: 5분마다 갱신 — 새벽 자동 발행분 자동 반영

const { years } = getCareer();

export const metadata: Metadata = {
  title: "금융소식 — 절약·청구·실손·리모델링 인사이트",
  description: `보험료 절약 꿀팁부터 보험금 청구·보상, 실손·보장성 가이드, 보험 리모델링, 금융·경제 뉴스까지 — ${years}년 차 GA명장이 소비자의 언어로 해설합니다. 매일 아침 업데이트.`,
  alternates: { canonical: "/news" },
};

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const active = category && CATEGORIES.includes(category as never) ? category : "전체";
  const articles = await getPublishedArticles(active);

  return (
    <main className="min-h-screen bg-[var(--color-ink)] pt-16">
      <section className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
        {/* 헤더 */}
        <div className="mb-12 max-w-2xl md:mb-16">
          <p className="mb-4 text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)]">
            DAILY FINANCIAL INSIGHT
          </p>
          <h1 className="mb-5 font-serif text-3xl font-semibold leading-[1.22] tracking-[-0.015em] text-[var(--color-text-strong)] md:text-5xl">
            어려운 금융,
            <br />
            <span className="text-[var(--color-forest)]">전문가의 언어</span>로 다시 씁니다
          </h1>
          <p className="text-[15px] leading-relaxed text-[var(--color-text-body)]">
            보험료 절약·청구/보상·실손 가이드·리모델링·금융 뉴스를 {years}년 현장 경험으로 알기 쉽게 전해드립니다.
          </p>
        </div>

        {/* 카테고리 탭 */}
        <nav
          className="mb-10 flex flex-wrap gap-x-6 gap-y-3 border-b border-[var(--color-line)] pb-1"
          aria-label="카테고리"
        >
          {CATEGORIES.map((cat) => (
            <Link
              key={cat}
              href={cat === "전체" ? "/news" : `/news?category=${encodeURIComponent(cat)}`}
              aria-current={active === cat ? "page" : undefined}
              className={`-mb-px border-b-2 pb-2.5 text-sm transition-colors duration-200 ${
                active === cat
                  ? "border-[var(--color-gold)] font-semibold text-[var(--color-text-strong)]"
                  : "border-transparent font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-strong)]"
              }`}
            >
              {cat}
            </Link>
          ))}
        </nav>

        {/* 글 목록 */}
        {articles.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-ink-card)] px-8 py-20 text-center">
            <p className="font-serif text-lg font-semibold text-[var(--color-text-strong)]">
              콘텐츠 발행을 준비하고 있습니다
            </p>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              매일 아침, 금융 소식과 보험 인사이트가 이곳에 자동 발행됩니다.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {articles.map((a, i) => (
              <ArticleCard
                key={a.id}
                slug={a.slug}
                title={a.title}
                category={a.category}
                summary={a.summary}
                publishedAt={a.published_at}
                viewCount={a.view_count}
                index={i}
              />
            ))}
          </div>
        )}

        {/* 리드 훅 — 기사 열람 후 진단(리드)으로 흘려보내는 딥그린 밴드 */}
        <div className="mt-16 overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-forest)] px-7 py-12 text-center md:mt-20 md:px-12 md:py-16">
          <span aria-hidden className="mx-auto mb-5 block h-px w-6 bg-[var(--color-gold)]" />
          <p className="mb-3 text-xs font-semibold tracking-[0.08em] text-[var(--color-ink)]/70">
            보험 리모델링 진단
          </p>
          <h2 className="mx-auto max-w-xl font-serif text-2xl font-semibold leading-[1.3] tracking-[-0.01em] text-[var(--color-ink)] md:text-[2rem]">
            읽으셨다면, 이제 내 보험 차례입니다.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[var(--color-ink)]/80">
            {years}년 노하우로 만든 진단으로, 지금 새고 있는 보장을 3분 만에 짚어드립니다.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <Link
              href="/diagnosis"
              className="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-7 py-3.5 text-sm font-semibold text-[var(--color-forest)] transition-transform duration-300 hover:-translate-y-px"
            >
              내 보험 리모델링 진단받기
            </Link>
            <p className="text-[11px] text-[var(--color-ink)]/60">
              상담 강요 없음 · 결과 리포트 제공
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
