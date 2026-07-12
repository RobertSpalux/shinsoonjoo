import { marked } from "marked";
import { BRAND } from "./brand";

/**
 * OSMU 채널별 원고 포맷 변환 — /admin 복사 버튼에서 사용. "복붙 1분"이 목표.
 * 원본(DB의 마크다운 원고)은 건드리지 않고 복사 시점에만 변환한다.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://goodfinance.kr";

/** [이미지①] [이미지 2] 등 카드 삽입 위치 마커 */
const IMG_MARKER = /\[이미지\s*[①②③④⑤⑥⑦⑧⑨⑩0-9]+\]/g;

/**
 * 본진 전용 글 중간 CTA 삽입 마커 (커밋 N5) — /news/[slug] 렌더러가 이 위치에
 * ArticleCtaInline을 치환한다. ⚠️ 외부 채널(네이버/블로그스팟) 원고에는 절대 노출 금지
 * — 아래 두 변환기가 반드시 제거한다.
 */
export const CTA_MARKER = "<!--CTA-->";

/** tags 배열 → "#태그1 #태그2 …" (앞의 # 중복·공백 방어, 도배 방지 상한 10개) */
function toHashtags(tags: string[] | null | undefined): string {
  return (tags ?? [])
    .map((t) => t.replace(/^#/, "").replace(/\s+/g, "").trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((t) => `#${t}`)
    .join(" ");
}

/**
 * 블로그스팟용: 마크다운 → HTML (Blogger "HTML 보기"에 붙여넣기).
 * - ##→<h2>, 불릿→<ul>, 번호→<ol>, 표→<table>, 인용→<blockquote> (marked/GFM)
 * - [이미지] 마커 제거 (블로그스팟은 이미지 미사용 채널)
 * - 본진 언급("신순주의 선한 금융")을 기사 상세 링크 앵커로 — 브랜드명 텍스트는 그대로 유지
 */
export function toBlogspotHtml(markdown: string, slug: string, tags?: string[] | null): string {
  const cleaned = markdown
    .replace(IMG_MARKER, "")
    .replaceAll(CTA_MARKER, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const html = (marked.parse(cleaned, { async: false, gfm: true }) as string).trim();

  const articleUrl = `${SITE_URL}/news/${slug}`;
  const anchor = `<a href="${articleUrl}">${BRAND.siteName}</a>`;
  const linked = html.includes(BRAND.siteName)
    ? // 첫 언급만 앵커로 (보통 말미 "원문 심층 해설" 안내 1회)
      html.replace(BRAND.siteName, anchor)
    : `${html}\n<p>원문 심층 해설 → ${anchor}</p>`;

  const hashtags = toHashtags(tags);
  return hashtags ? `${linked}\n<p>${hashtags}</p>` : linked;
}

/**
 * 네이버용: 마크다운 기호 제거 → 순수 텍스트 (네이버 에디터는 마크다운 미지원).
 * - ## 제거(소제목은 텍스트로), 굵게·기울임·인용(>) 마커 제거, 불릿 - → ·
 * - [이미지] 마커는 유지 (카드 PNG 삽입 위치 표시)
 * - 말미에 본진 기사 링크(네이버→본진 트래픽 다리) + 진단 URL + 해시태그 자동 첨부
 */
export function toNaverText(
  markdown: string,
  opts?: { articleTitle?: string; slug?: string; tags?: string[] | null }
): string {
  let text = markdown
    .replaceAll(CTA_MARKER, "") // 본진 전용 CTA 마커 — 외부 채널 노출 금지
    .replace(/^#{1,6}\s+/gm, "") // 헤딩 마커
    .replace(/^>\s?/gm, "") // 인용 마커
    .replace(/^\s*[-*]\s+/gm, "· ") // 불릿
    .replace(/\*\*([^*]+)\*\*/g, "$1") // 굵게
    .replace(/\*([^*\n]+)\*/g, "$1") // 기울임
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)") // 링크 → 텍스트 (URL)
    .replace(/^[-*_]{3,}\s*$/gm, "") // 수평선
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (opts?.slug) {
    const articleUrl = `${SITE_URL}/news/${opts.slug}`;
    if (!text.includes(articleUrl)) {
      text += `\n\n📄 ${opts.articleTitle ?? "원문 심층 해설"}\n${articleUrl}`;
    }
  }

  const diagnosisUrl = `${SITE_URL}/diagnosis`;
  if (!text.includes(diagnosisUrl)) {
    text += `\n\n무료 보험 리모델링 진단 👉 ${diagnosisUrl}`;
  }

  const hashtags = toHashtags(opts?.tags);
  if (hashtags) {
    text += `\n\n${hashtags}`;
  }
  return text;
}
