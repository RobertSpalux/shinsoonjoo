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
 * 블로그스팟용: 마크다운 → HTML (Blogger "HTML 보기"에 붙여넣기).
 * - ##→<h2>, 불릿→<ul>, 번호→<ol>, 표→<table>, 인용→<blockquote> (marked/GFM)
 * - [이미지] 마커 제거 (블로그스팟은 이미지 미사용 채널)
 * - 본진 언급("신순주의 선한 금융")을 기사 상세 링크 앵커로 — 브랜드명 텍스트는 그대로 유지
 */
export function toBlogspotHtml(markdown: string, slug: string): string {
  const cleaned = markdown
    .replace(IMG_MARKER, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const html = (marked.parse(cleaned, { async: false, gfm: true }) as string).trim();

  const articleUrl = `${SITE_URL}/news/${slug}`;
  const anchor = `<a href="${articleUrl}">${BRAND.siteName}</a>`;
  if (html.includes(BRAND.siteName)) {
    // 첫 언급만 앵커로 (보통 말미 "원문 심층 해설" 안내 1회)
    return html.replace(BRAND.siteName, anchor);
  }
  return `${html}\n<p>원문 심층 해설 → ${anchor}</p>`;
}

/**
 * 네이버용: 마크다운 기호 제거 → 순수 텍스트 (네이버 에디터는 마크다운 미지원).
 * - ## 제거(소제목은 텍스트로), 굵게·기울임·인용(>) 마커 제거, 불릿 - → ·
 * - [이미지] 마커는 유지 (카드 PNG 삽입 위치 표시)
 * - 말미 CTA에 본진 진단 실제 URL 삽입 (모든 채널 CTA = 보험 리모델링 진단)
 */
export function toNaverText(markdown: string): string {
  let text = markdown
    .replace(/^#{1,6}\s+/gm, "") // 헤딩 마커
    .replace(/^>\s?/gm, "") // 인용 마커
    .replace(/^\s*[-*]\s+/gm, "· ") // 불릿
    .replace(/\*\*([^*]+)\*\*/g, "$1") // 굵게
    .replace(/\*([^*\n]+)\*/g, "$1") // 기울임
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)") // 링크 → 텍스트 (URL)
    .replace(/^[-*_]{3,}\s*$/gm, "") // 수평선
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const diagnosisUrl = `${SITE_URL}/diagnosis`;
  if (!text.includes(diagnosisUrl)) {
    text += `\n\n무료 보험 리모델링 진단 👉 ${diagnosisUrl}`;
  }
  return text;
}
