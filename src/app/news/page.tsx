import type { Metadata } from "next";
import Link from "next/link";
import { getPublishedArticles, CATEGORIES } from "@/lib/articles";
import ArticleCard from "@/components/news/ArticleCard";

export const revalidate = 300; // ISR: 5분마다 갱신 — 새벽 자동 발행분 자동 반영

export const metadata: Metadata = {
  title: "금융소식 — 생활경제·보험·보상 인사이트",
  description:
    "금융감독원 보도자료, 생활경제 뉴스, 보험금 분쟁 판례를 23년 차 GA명장이 소비자의 언어로 해설합니다. 매일 아침 업데이트.",
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
          <p className="mb-4 text-xs font-semibold tracking-[0.25em] uppercase text-[var(--color-gold)]">
            Daily Financial Insight
          </p>
          <h1 className="mb-5 text-3xl font-extrabold leading-tight tracking-tight text-white md:text-5xl">
            어려운 금융 뉴스,
            <br />
            <span className="text-[var(--color-gold)]">전문가의 언어</span>로 다시 씁니다
          </h1>
          <p className="text-[15px] leading-relaxed text-zinc-400">
            금융감독원 보도자료·경제 뉴스·보험금 분쟁 판례를 23년 현장 경험으로 해설합니다.
            플랫폼의 익명 콘텐츠가 아닌, 이름을 걸고 쓰는 글입니다.
          </p>
        </div>

        {/* 카테고리 탭 */}
        <nav className="mb-10 flex flex-wrap gap-2.5" aria-label="카테고리">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat}
              href={cat === "전체" ? "/news" : `/news?category=${encodeURIComponent(cat)}`}
              className={`rounded-full border px-5 py-2 text-sm font-medium transition-all duration-300 ${
                active === cat
                  ? "border-[var(--color-gold)] bg-[var(--color-gold)] text-black"
                  : "border-[var(--color-line)] text-zinc-400 hover:border-[var(--color-gold-dim)] hover:text-[var(--color-gold-light)]"
              }`}
            >
              {cat}
            </Link>
          ))}
        </nav>

        {/* 글 목록 */}
        {articles.length === 0 ? (
          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-ink-card)] px-8 py-20 text-center">
            <p className="text-lg font-semibold text-zinc-300">
              콘텐츠 발행을 준비하고 있습니다
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              매일 아침, 금융감독원 소식과 보상 판례 해설이 이곳에 자동 발행됩니다.
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
      </section>
    </main>
  );
}
