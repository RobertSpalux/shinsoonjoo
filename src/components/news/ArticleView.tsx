import Link from "next/link";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Root, Blockquote, Nodes } from "mdast";
import rehypeSlug from "rehype-slug";
import GithubSlugger from "github-slugger";
import type { Article } from "@/lib/articles";
import type { ReviewInfo } from "@/lib/brand";
import { articleSchema, faqSchema, personSchema, jsonLdString } from "@/lib/jsonld";
import { BRAND, getCareer } from "@/lib/brand";
import { CTA_MARKER } from "@/lib/osmu-format";
import ReadingProgress from "@/components/news/ReadingProgress";
import ArticleCard from "@/components/news/ArticleCard";
import ArticleCtaInline from "@/components/news/ArticleCtaInline";
import ArticleCtaEnd from "@/components/news/ArticleCtaEnd";
import MandatoryNotice from "@/components/news/MandatoryNotice";
import ArticleNotice from "@/components/news/ArticleNotice";

/** ## 소제목 추출 → 목차 (rehype-slug와 동일한 slugger로 앵커 일치) */
function extractToc(markdown: string) {
  const slugger = new GithubSlugger();
  return [...markdown.matchAll(/^##\s+(.+)$/gm)].map((m) => {
    const text = m[1].trim();
    return { text, id: slugger.slug(text) };
  });
}

const ADVICE_MARKER = /<!--\s*advice\s*-->/i;

/** mdast 노드의 텍스트만 재귀 수집 (라벨 판별용) */
function nodeText(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map((c) => nodeText(c as Nodes)).join("");
  }
  return "";
}

/** blockquote가 「한 줄 조언」이면 advice-callout 클래스를 부여(mdast→hast로 전달) */
function markAdvice(bq: Blockquote) {
  let isAdvice = false;
  const kids = bq.children;
  // 1) 마커 판별 — HTML 주석 `<!-- advice -->`. 문구가 아니라 마커로 판별한다
  //    ("한 줄 조언"은 brand.ts에서 조립되는 문구라 직급이 바뀌면 조용히 깨진다).
  const idx = kids.findIndex((c) => c.type === "html" && ADVICE_MARKER.test(c.value));
  if (idx >= 0) {
    isAdvice = true;
    kids.splice(idx, 1); // 마커 자체는 렌더하지 않는다
  } else {
    // 2) 폴백 — 마커 도입 이전 원고 대응. 첫 단락이 강조 라벨이고 그 안에
    //    BRAND.personName이 포함되면 조언 블록으로 본다. ⚠️ 전량 마커 전환 후 이 폴백은 제거.
    const first = kids[0];
    if (first?.type === "paragraph") {
      const lead = first.children[0];
      if (lead?.type === "strong" && nodeText(lead).includes(BRAND.personName)) isAdvice = true;
    }
  }
  if (!isAdvice) return;
  const data = (bq.data ??= {}) as { hProperties?: { className?: string | string[] } };
  const hProps = (data.hProperties ??= {});
  const cls = hProps.className;
  hProps.className = Array.isArray(cls) ? [...cls, "advice-callout"] : "advice-callout";
}

/**
 * remark 플러그인 — 「한 줄 조언」 blockquote에 advice-callout 클래스 부여(§DESIGN-SPEC 3-4 대비 밴드).
 * ⚠️ react-markdown 기본 설정은 HTML 주석을 렌더 전에 제거하므로, 마커 판별은 렌더러가 아니라
 *    이 mdast 단계에서 해야 한다(렌더러의 children에는 마커가 도달하지 않는다).
 */
function remarkAdviceCallout() {
  return (tree: Root) => {
    const walk = (node: Nodes) => {
      if (!("children" in node) || !Array.isArray(node.children)) return;
      for (const child of node.children) {
        if (child.type === "blockquote") markAdvice(child);
        walk(child);
      }
    };
    walk(tree);
  };
}

/**
 * 기사 렌더링 본체 — 공개 페이지(/news/[slug])와 심의 프리뷰(/preview/news/[slug])가
 * 공유한다. ⚠️ 두 경로의 화면은 픽셀 단위로 같아야 한다(심의 통과 후 원안 수정 불가).
 * 차이는 호출부에서 주입하는 review·mode(필수안내사항 심의필 줄)와 noindex뿐이다.
 */
export default function ArticleView({
  article,
  related,
  review,
  mode,
}: {
  article: Article;
  related: Article[];
  review: ReviewInfo | null;
  mode: "submission" | "publish";
}) {
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

  // 글 중간 CTA (커밋 N5) — <!--CTA--> 마커 첫 번째 위치에만 치환, 나머지 마커는 제거(화면 노출 금지)
  const markerIdx = markdown.indexOf(CTA_MARKER);
  const bodyBeforeCta =
    markerIdx === -1 ? markdown.replaceAll(CTA_MARKER, "") : markdown.slice(0, markerIdx);
  const bodyAfterCta =
    markerIdx === -1 ? "" : markdown.slice(markerIdx + CTA_MARKER.length).replaceAll(CTA_MARKER, "");

  return (
    <main className="min-h-screen bg-[var(--color-ink)] pt-16 print:pt-0">
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

        {/* 본문 — 마커가 있으면 그 지점에 인라인 진단 다리 삽입 (커밋 N5) */}
        <div className="article-body">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkAdviceCallout]} rehypePlugins={[rehypeSlug]}>
            {bodyBeforeCta}
          </ReactMarkdown>
          {markerIdx !== -1 && (
            <>
              <ArticleCtaInline slug={article.slug} />
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkAdviceCallout]} rehypePlugins={[rehypeSlug]}>
                {bodyAfterCta}
              </ReactMarkdown>
            </>
          )}
        </div>

        {/* 원문 출처 + 비권유 고지 — 출처 줄은 raw_source_url이 있을 때만(§6.10 출처 4요소 미충족이면
            데이터를 비워 이 줄만 감춘다). 비권유 고지는 출처 유무와 무관하게 상시 노출(§6 업무광고 입장). */}
        <div className="mt-10 rounded-lg border border-[var(--color-line)] bg-white px-5 py-4 text-xs leading-relaxed text-[var(--color-text-muted)]">
          {article.raw_source_url && (
            <p>
              원문 출처: {article.raw_source_name ?? "외부 자료"} —{" "}
              <a href={article.raw_source_url} target="_blank" rel="noopener noreferrer"
                 className="text-[var(--color-text-strong)] underline decoration-[var(--color-gold-dim)] underline-offset-2 transition-colors hover:decoration-[var(--color-gold)]">
                원문 보기 ↗
              </a>
            </p>
          )}
          <p className={article.raw_source_url ? "mt-1" : ""}>
            본 글은 공개 자료를 기반으로 한 전문가 해설이며, 특정 상품의 권유가 아닙니다.
          </p>
        </div>

        {/* 게시글 필수 유의문구 2종 — 심의필과 무관하게 상시(§6.11-4, 회신 2026-07-21).
            MandatoryNotice(심의필 조건부)와 별개 블록. */}
        <ArticleNotice />

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

        {/* 글 끝 CTA — 딥그린 밴드, 모든 기사 자동 삽입 (커밋 N5 — 기존 골드 카드 CTA 대체) */}
        <ArticleCtaEnd slug={article.slug} />

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

        {/* 필수안내사항 — 광고형태 "홈페이지"로 심의받는 광고물이므로 화면에 상시 표기 (§6.3) */}
        <MandatoryNotice review={review} mode={mode} />
      </article>
    </main>
  );
}
