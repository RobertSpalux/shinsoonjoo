import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import GithubSlugger from "github-slugger";
import { getArticleBySlug, getPublishedArticles, incrementViewCount } from "@/lib/articles";
import { articleSchema, faqSchema, personSchema, jsonLdString } from "@/lib/jsonld";
import { BRAND, getCareer } from "@/lib/brand";
import ReadingProgress from "@/components/news/ReadingProgress";
import CardGallery from "@/components/news/CardGallery";
import ArticleCard from "@/components/news/ArticleCard";

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

/** ## 소제목 추출 → 목차 (rehype-slug와 동일한 slugger로 앵커 일치) */
function extractToc(markdown: string) {
  const slugger = new GithubSlugger();
  return [...markdown.matchAll(/^##\s+(.+)$/gm)].map((m) => {
    const text = m[1].trim();
    return { text, id: slugger.slug(text) };
  });
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
  const markdown = article.main_website_markdown ?? "";
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString("ko-KR", {
        year: "numeric", month: "long", day: "numeric",
      })
    : "";
  const faqs = article.faq_json ?? [];
  const keyPoints = article.key_points ?? [];
  const toc = extractToc(markdown);
  const readMinutes = Math.max(1, Math.round(markdown.length / 600));

  const related = (await getPublishedArticles(article.category, 4))
    .filter((a) => a.slug !== article.slug)
    .slice(0, 3);

  return (
    <main className="min-h-screen bg-[var(--color-ink)] pt-16">
      <ReadingProgress />

      {/* JSON-LD: Article + Person (+ FAQPage) — YMYL E-E-A-T 핵심 신호 */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(articleSchema(article)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(personSchema()) }} />
      {faqs.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(faqSchema(faqs)) }} />
      )}

      <article className="mx-auto max-w-3xl px-6 py-14 md:py-20">
        {/* 브레드크럼 */}
        <nav className="mb-8 flex items-center gap-2 text-xs text-slate-500" aria-label="breadcrumb">
          <Link href="/news" className="hover:text-[var(--color-gold)]">금융소식</Link>
          <span aria-hidden>/</span>
          <Link href={`/news?category=${encodeURIComponent(article.category)}`} className="hover:text-[var(--color-gold)]">
            {article.category}
          </Link>
        </nav>

        <header className="mb-8">
          <h1 className="mb-6 text-3xl font-extrabold leading-tight tracking-tight text-slate-900 md:text-4xl">
            {article.title}
          </h1>

          {/* 저자 바이라인 — 실명·경력 명시 (E-E-A-T) */}
          <div className="flex items-center gap-4 border-y border-[var(--color-line)] py-4">
            <div className="relative h-11 w-11 overflow-hidden rounded-full">
              <Image src="/soonjoo.jpg" alt={BRAND.personName} fill className="object-cover object-top" sizes="44px" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-900">
                {BRAND.personName} <span className="font-medium text-slate-500">{BRAND.title}</span>
              </p>
              <p className="text-xs text-slate-500">
                {years}년 차 · 우수인증설계사 8년 연속 · GA명장
              </p>
            </div>
            <div className="text-right text-xs text-slate-400">
              <time dateTime={article.published_at ?? undefined}>{date}</time>
              <p className="mt-0.5">약 {readMinutes}분 읽기</p>
            </div>
          </div>
        </header>

        {/* 핵심 3줄 요약 — 바쁜 독자를 붙잡는 첫 블록 */}
        {keyPoints.length > 0 && (
          <aside className="mb-8 rounded-2xl border border-[var(--color-gold-dim)] bg-gradient-to-br from-[#fdf9ef] to-white p-6">
            <p className="mb-3 text-xs font-bold tracking-[0.15em] uppercase text-[var(--color-gold)]">
              ⚡ 핵심만 3줄
            </p>
            <ol className="space-y-2">
              {keyPoints.map((p, i) => (
                <li key={i} className="flex gap-3 text-[15px] font-medium leading-relaxed text-slate-800">
                  <span className="font-extrabold text-[var(--color-gold)]">{i + 1}</span>
                  {p}
                </li>
              ))}
            </ol>
          </aside>
        )}

        {/* 목차 */}
        {toc.length >= 3 && (
          <nav className="mb-10 rounded-2xl border border-[var(--color-line)] bg-white p-6" aria-label="목차">
            <p className="mb-3 text-xs font-bold tracking-[0.15em] uppercase text-slate-400">목차</p>
            <ul className="space-y-1.5">
              {toc.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} className="text-sm text-slate-600 transition-colors hover:text-[var(--color-gold)]">
                    · {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {/* 본문 */}
        <div className="article-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]}>
            {markdown}
          </ReactMarkdown>
        </div>

        {/* 카드뉴스 갤러리 — 텍스트 피로를 끊는 시각 블록 */}
        {article.image_paths?.length > 0 && (
          <CardGallery images={article.image_paths} title={article.title} />
        )}

        {/* 원문 출처 — 신뢰 신호 */}
        {article.raw_source_url && (
          <p className="mt-10 rounded-xl border border-[var(--color-line)] bg-white px-5 py-4 text-xs leading-relaxed text-slate-500">
            원문 출처: {article.raw_source_name ?? "외부 자료"} —{" "}
            <a href={article.raw_source_url} target="_blank" rel="noopener noreferrer"
               className="text-[var(--color-gold)] underline underline-offset-2 hover:text-[var(--color-gold-light)]">
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
            <h2 className="mb-6 text-xl font-bold text-slate-900">자주 묻는 질문</h2>
            <div className="space-y-3">
              {faqs.map((f, i) => (
                <details key={i} className="group rounded-xl border border-[var(--color-line)] bg-white px-6 py-4">
                  <summary className="cursor-pointer list-none text-[15px] font-semibold text-slate-700 transition-colors group-open:text-[var(--color-gold)]">
                    Q. {f.question}
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">{f.answer}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* 상담 CTA */}
        <aside className="mt-16 rounded-2xl border border-[var(--color-gold-dim)] bg-gradient-to-br from-white to-[#f7f2e6] p-8 text-center md:p-10">
          <p className="text-lg font-bold text-slate-900 md:text-xl">내 상황에는 어떻게 적용될까요?</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
            같은 뉴스도 자산 구조에 따라 답이 다릅니다. {years}년 차 GA명장이 직접 확인해 드립니다.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/diagnosis"
              className="rounded-full bg-[var(--color-gold)] px-7 py-3.5 text-sm font-bold text-white transition-all duration-300 hover:bg-[var(--color-gold-light)]">
              3분 자산 방어력 진단
            </Link>
            <Link href="/#consultation"
              className="rounded-full border border-slate-300 px-7 py-3.5 text-sm font-semibold text-slate-700 transition-all duration-300 hover:border-[var(--color-gold-dim)] hover:text-[var(--color-gold)]">
              1:1 상담 예약
            </Link>
          </div>
        </aside>

        {/* 관련 글 — 내부 순환으로 체류시간 연장 */}
        {related.length > 0 && (
          <section className="mt-16 border-t border-[var(--color-line)] pt-10">
            <h2 className="mb-6 text-lg font-bold text-slate-900">함께 보면 좋은 글</h2>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((a, i) => (
                <ArticleCard key={a.id} slug={a.slug} title={a.title} category={a.category}
                  summary={a.summary} publishedAt={a.published_at} viewCount={a.view_count} index={i} />
              ))}
            </div>
          </section>
        )}
      </article>
    </main>
  );
}
