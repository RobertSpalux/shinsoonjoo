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

/** 두 번째 ## 직전에서 분할 — 첫 h2 섹션 끝에 카드 갤러리를 끼워 텍스트를 끊는다 */
function splitAtSecondH2(markdown: string): [string, string] {
  const matches = [...markdown.matchAll(/^##\s+.+$/gm)];
  if (matches.length < 2 || matches[1].index === undefined) return [markdown, ""];
  return [markdown.slice(0, matches[1].index), markdown.slice(matches[1].index)];
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

  // 리드 이미지 = og(항상 카드 1번) → 갤러리는 카드 2번부터 (중복 방지)
  const imagePaths = article.image_paths ?? [];
  const leadImage = article.og_image_path ?? imagePaths[0] ?? null;
  const galleryImages =
    leadImage && leadImage === imagePaths[0] ? imagePaths.slice(1) : imagePaths;
  const [mdPart1, mdPart2] =
    galleryImages.length > 0 ? splitAtSecondH2(markdown) : [markdown, ""];

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
        <nav className="mb-8 flex items-center gap-2 text-xs text-[var(--color-text-muted)]" aria-label="breadcrumb">
          <Link href="/news" className="transition-colors hover:text-[var(--color-text-body)]">금융소식</Link>
          <span aria-hidden>/</span>
          <Link href={`/news?category=${encodeURIComponent(article.category)}`} className="transition-colors hover:text-[var(--color-text-body)]">
            {article.category}
          </Link>
        </nav>

        <header className="mb-8">
          <h1
            className="mb-6 text-3xl font-semibold leading-[1.25] tracking-[-0.015em] text-[var(--color-forest)] md:text-4xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {article.title}
          </h1>

          {/* 저자 바이라인 — 실명·경력 명시 (E-E-A-T) */}
          <div className="flex items-center gap-4 border-y border-[var(--color-line)] py-4">
            <div className="relative h-11 w-11 overflow-hidden rounded-full">
              <Image src="/soonjoo.jpg" alt={BRAND.personName} fill className="object-cover object-top" sizes="44px" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--color-text-strong)]">
                {BRAND.personName} <span className="font-normal text-[var(--color-text-muted)]">{BRAND.title}</span>
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {years}년 차 · 우수인증설계사 8년 연속 · GA명장
              </p>
            </div>
            <div className="text-right text-xs text-[var(--color-text-muted)]">
              <time dateTime={article.published_at ?? undefined}>{date}</time>
              <p className="mt-0.5">약 {readMinutes}분 읽기</p>
            </div>
          </div>
        </header>

        {/* 리드 이미지 — 카드 1번 (1080×1350). 없으면 생략 */}
        {leadImage && (
          <figure className="mb-10">
            <div className="relative mx-auto aspect-[4/5] w-full max-w-md overflow-hidden rounded-lg border border-[var(--color-line)]">
              <Image
                src={leadImage}
                alt={article.title}
                fill
                priority
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 448px"
              />
            </div>
          </figure>
        )}

        {/* 핵심 3줄 요약 — 바쁜 독자를 붙잡는 첫 블록 */}
        {keyPoints.length > 0 && (
          <aside className="mb-8 rounded-lg border border-[var(--color-gold-dim)] bg-gradient-to-br from-[#fdf9ef] to-white p-6">
            <p className="mb-3 text-xs font-semibold tracking-[0.08em] text-[var(--color-gold)]">
              핵심만 3줄
            </p>
            <ol className="space-y-2">
              {keyPoints.map((p, i) => (
                <li key={i} className="flex gap-3 text-[15px] font-medium leading-relaxed text-[var(--color-text-body)]">
                  <span className="font-semibold tabular-nums text-[var(--color-gold)]">{i + 1}</span>
                  {p}
                </li>
              ))}
            </ol>
          </aside>
        )}

        {/* 목차 — 기본 접힘으로 상단 밀도 완화 */}
        {toc.length >= 3 && (
          <nav className="mb-10" aria-label="목차">
            <details className="group rounded-lg border border-[var(--color-line)] bg-white px-6 py-4">
              <summary className="cursor-pointer list-none text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)]">
                목차 펼치기
                <span aria-hidden className="ml-1.5 inline-block transition-transform group-open:rotate-180">⌄</span>
              </summary>
              <ul className="mt-3 space-y-1.5">
                {toc.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="text-sm text-[var(--color-text-body)] transition-colors hover:text-[var(--color-text-strong)]">
                      · {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          </nav>
        )}

        {/* 본문 — 갤러리가 있으면 첫 h2 섹션 직후에 삽입해 텍스트를 끊는다 */}
        <div className="article-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]}>
            {mdPart1}
          </ReactMarkdown>
        </div>

        {galleryImages.length > 0 && (
          <CardGallery images={galleryImages} title={article.title} />
        )}

        {mdPart2 && (
          <div className="article-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]}>
              {mdPart2}
            </ReactMarkdown>
          </div>
        )}

        {/* 원문 출처 — 신뢰 신호 */}
        {article.raw_source_url && (
          <p className="mt-10 rounded-lg border border-[var(--color-line)] bg-white px-5 py-4 text-xs leading-relaxed text-[var(--color-text-muted)]">
            원문 출처: {article.raw_source_name ?? "외부 자료"} —{" "}
            <a href={article.raw_source_url} target="_blank" rel="noopener noreferrer"
               className="text-[var(--color-text-strong)] underline decoration-[var(--color-gold-dim)] underline-offset-2 transition-colors hover:decoration-[var(--color-gold)]">
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
            <h2
              className="mb-6 text-xl font-semibold text-[var(--color-forest)]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              자주 묻는 질문
            </h2>
            <div className="space-y-3">
              {faqs.map((f, i) => (
                <details key={i} className="group rounded-lg border border-[var(--color-line)] bg-white px-6 py-4">
                  <summary className="cursor-pointer list-none text-[15px] font-semibold text-[var(--color-text-body)] transition-colors group-open:text-[var(--color-text-strong)]">
                    Q. {f.question}
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-body)]">{f.answer}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* 상담 CTA */}
        <aside className="mt-16 rounded-lg border border-[var(--color-gold-dim)] bg-gradient-to-br from-white to-[#f7f2e6] p-8 text-center md:p-10">
          <p
            className="text-lg font-semibold text-[var(--color-forest)] md:text-xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            내 상황에는 어떻게 적용될까요?
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--color-text-body)]">
            같은 뉴스도 자산 구조에 따라 답이 다릅니다. {years}년 차 GA명장이 직접 확인해 드립니다.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
            <Link href="/diagnosis"
              className="rounded-sm bg-[var(--color-forest)] px-7 py-3.5 text-sm font-semibold text-[var(--color-ink)] transition-[background-color,transform] duration-300 hover:-translate-y-px hover:bg-[var(--color-forest-soft)]">
              내 보험 진단받기
            </Link>
            <Link href="/#consultation"
              className="border-b border-[var(--color-gold-dim)] pb-0.5 text-sm font-medium text-[var(--color-text-strong)] transition-colors duration-300 hover:border-[var(--color-gold)]">
              1:1 상담 예약
            </Link>
          </div>
        </aside>

        {/* 관련 글 — 내부 순환으로 체류시간 연장 */}
        {related.length > 0 && (
          <section className="mt-16 border-t border-[var(--color-line)] pt-10">
            <h2
              className="mb-6 text-lg font-semibold text-[var(--color-forest)]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              함께 보면 좋은 글
            </h2>
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
