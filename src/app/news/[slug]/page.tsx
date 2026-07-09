import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getArticleBySlug, getPublishedArticles, incrementViewCount } from "@/lib/articles";
import { articleSchema, faqSchema, personSchema, jsonLdString } from "@/lib/jsonld";
import { BRAND, getCareer } from "@/lib/brand";

export const revalidate = 300;

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

  const { years } = getCareer();
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";
  const faqs = article.faq_json ?? [];

  return (
    <main className="min-h-screen bg-[var(--color-ink)] pt-16">
      {/* JSON-LD: Article + Person (+ FAQPage) — YMYL E-E-A-T 핵심 신호 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(articleSchema(article)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(personSchema()) }}
      />
      {faqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(faqSchema(faqs)) }}
        />
      )}

      <article className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        {/* 브레드크럼 */}
        <nav className="mb-8 flex items-center gap-2 text-xs text-zinc-500" aria-label="breadcrumb">
          <Link href="/news" className="hover:text-[var(--color-gold-light)]">금융소식</Link>
          <span aria-hidden>/</span>
          <Link
            href={`/news?category=${encodeURIComponent(article.category)}`}
            className="hover:text-[var(--color-gold-light)]"
          >
            {article.category}
          </Link>
        </nav>

        <header className="mb-10">
          <h1 className="mb-6 text-3xl font-extrabold leading-tight tracking-tight text-white md:text-4xl">
            {article.title}
          </h1>

          {/* 저자 바이라인 — 실명·경력 명시 (E-E-A-T) */}
          <div className="flex items-center gap-4 border-y border-[var(--color-line)] py-4">
            <div className="relative h-11 w-11 overflow-hidden rounded-full">
              <Image src="/soonjoo.jpg" alt={BRAND.personName} fill className="object-cover object-top" sizes="44px" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-white">
                {BRAND.personName}{" "}
                <span className="font-medium text-zinc-500">{BRAND.title}</span>
              </p>
              <p className="text-xs text-zinc-500">
                {years}년 차 · 우수인증설계사 8년 연속 · GA명장
              </p>
            </div>
            <time className="text-xs text-zinc-600" dateTime={article.published_at ?? undefined}>
              {date}
            </time>
          </div>
        </header>

        {/* 본문 */}
        <div className="article-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {article.main_website_markdown ?? ""}
          </ReactMarkdown>
        </div>

        {/* 원문 출처 — 신뢰 신호 */}
        {article.raw_source_url && (
          <p className="mt-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] px-5 py-4 text-xs leading-relaxed text-zinc-500">
            원문 출처: {article.raw_source_name ?? "외부 자료"} —{" "}
            <a
              href={article.raw_source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-gold-dim)] underline underline-offset-2 hover:text-[var(--color-gold-light)]"
            >
              원문 보기 ↗
            </a>
            <span className="mt-1 block">
              본 글은 공개 자료를 기반으로 한 전문가 해설이며, 특정 상품의 권유가 아닙니다.
            </span>
          </p>
        )}

        {/* FAQ 섹션 (FAQPage 스키마와 쌍) */}
        {faqs.length > 0 && (
          <section className="mt-14">
            <h2 className="mb-6 text-xl font-bold text-white">
              자주 묻는 질문
            </h2>
            <div className="space-y-3">
              {faqs.map((f, i) => (
                <details
                  key={i}
                  className="group rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] px-6 py-4"
                >
                  <summary className="cursor-pointer list-none text-[15px] font-semibold text-zinc-200 transition-colors group-open:text-[var(--color-gold-light)]">
                    Q. {f.question}
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-zinc-400">{f.answer}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* 상담 CTA */}
        <aside className="mt-16 rounded-2xl border border-[var(--color-gold-dim)]/40 bg-gradient-to-br from-[var(--color-ink-card)] to-black p-8 text-center md:p-10">
          <p className="text-lg font-bold text-white md:text-xl">
            내 상황에는 어떻게 적용될까요?
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400">
            같은 뉴스도 자산 구조에 따라 답이 다릅니다.
            {years}년 차 GA명장이 직접 확인해 드립니다.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/diagnosis"
              className="rounded-full bg-[var(--color-gold)] px-7 py-3.5 text-sm font-bold text-black transition-all duration-300 hover:bg-[var(--color-gold-light)]"
            >
              3분 자산 방어력 진단
            </Link>
            <Link
              href="/#consultation"
              className="rounded-full border border-zinc-700 px-7 py-3.5 text-sm font-semibold text-zinc-300 transition-all duration-300 hover:border-[var(--color-gold-dim)] hover:text-[var(--color-gold-light)]"
            >
              1:1 상담 예약
            </Link>
          </div>
        </aside>
      </article>
    </main>
  );
}
