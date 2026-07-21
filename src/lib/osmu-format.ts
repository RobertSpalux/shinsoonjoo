import { marked } from "marked";
import { BRAND, REQUIRED_NOTICES, renderMandatoryNotice, type ReviewInfo } from "./brand";

/**
 * OSMU 채널별 원고 포맷 변환 — /admin 복사 버튼에서 사용. "복붙 1분"이 목표.
 * 원본(DB의 마크다운 원고)은 건드리지 않고 복사 시점에만 변환한다.
 *
 * ⚠️ 금소법 심의 체제(CLAUDE.md §6.3/§6.6/§6.9/§6.10):
 *   - 외부 채널(네이버/블로그스팟)은 게시 전 사전 심의 대상 = 업무광고.
 *   - 필수안내사항은 승인된 심의필(ad_reviews)이 있을 때만 말미에 붙는다(없으면 생략).
 *   - 필수 유의문구 2종(REQUIRED_NOTICES)은 바이럴 본문에 1회 이상 노출한다(§6.11-4, 회신 2026-07-21).
 *   - /diagnosis CTA는 심의 전까지 내린다(includeDiagnosisCta로 게이트, 기본 off).
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

/** osmu 변환 공통 옵션 — 채널 공통 신규 필드(심의 체제). */
export type OsmuOptions = {
  channel: "naver" | "blogspot";
  /**
   * 렌더 모드. 기본 'publish'.
   * - 'submission': 심의 신청용 캡처 원고. 필수안내사항 전문을 항상 붙이되 심의필 줄은 공란.
   * - 'publish': 게시용. 승인 심의필이 있을 때만 실번호로 필수안내사항을 붙인다.
   * ⚠️ 두 모드 출력물은 심의필 줄 한 줄 외에는 완전히 동일해야 한다(원안 수정 방지).
   */
  mode?: "submission" | "publish";
  /** 승인된 심의필. 있으면 필수안내사항을 말미에 붙인다. null/미지정이면 생략(미심의). */
  review?: ReviewInfo | null;
  /**
   * /diagnosis CTA 노출 여부. 기본 false.
   * §6.6 "링크는 금지가 아니라 절차다. 심의 전 임시로 내린 링크는 심의 완료 후 복원한다."
   * 첫 심의 판정(§6.11) 이후 이 플래그를 true로 주면 한 줄로 되살아난다.
   */
  includeDiagnosisCta?: boolean;
};

/** 개인의견 귀속 문구가 삽입될 기준점 — 조언 블록 제목(본진 원고에만 있을 수 있음). */
const ADVICE_ANCHOR = `${BRAND.personName} ${BRAND.title}의 한 줄 조언`;

/** tags 배열 → "#태그1 #태그2 …" (앞의 # 중복·공백 방어, 도배 방지 상한 10개) */
function toHashtags(tags: string[] | null | undefined): string {
  return (tags ?? [])
    .map((t) => t.replace(/^#/, "").replace(/\s+/g, "").trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((t) => `#${t}`)
    .join(" ");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 플레인 텍스트(네이버)에 게시글 필수 유의문구 2종을 1회 삽입.
 * - 조언 블록이 있으면 그 블록 바로 아래, 없으면 본문 최하단.
 * - 멱등: 2종이 모두 이미 있으면 그대로 둔다.
 */
function insertBodyNoticesText(text: string): string {
  if (REQUIRED_NOTICES.every((n) => text.includes(n))) return text;
  const block = REQUIRED_NOTICES.join("\n\n");

  const idx = text.indexOf(ADVICE_ANCHOR);
  if (idx >= 0) {
    const blockEnd = text.indexOf("\n\n", idx); // 조언 블록 끝(다음 빈 줄)
    if (blockEnd >= 0) {
      return `${text.slice(0, blockEnd)}\n\n${block}${text.slice(blockEnd)}`;
    }
  }
  return `${text.trimEnd()}\n\n${block}`;
}

/**
 * HTML(블로그스팟)에 게시글 필수 유의문구 2종을 <p>로 1회 삽입.
 * - 조언 인용블록(</blockquote>) 뒤, 없으면 본문 끝.
 * - 멱등: 2종이 모두 이미 있으면 그대로 둔다. (문구에 <,>,& 없음 → 이스케이프본과 동일)
 */
function insertBodyNoticesHtml(html: string): string {
  if (REQUIRED_NOTICES.every((n) => html.includes(n))) return html;
  const block = REQUIRED_NOTICES.map((n) => `<p>${escapeHtml(n)}</p>`).join("\n");

  const aIdx = html.indexOf(ADVICE_ANCHOR);
  if (aIdx >= 0) {
    const close = html.indexOf("</blockquote>", aIdx);
    if (close >= 0) {
      const at = close + "</blockquote>".length;
      return `${html.slice(0, at)}\n${block}${html.slice(at)}`;
    }
  }
  return `${html}\n${block}`;
}

/** 필수안내사항 전문(플레인) → HTML 단락들. 빈 줄=단락 분리, 줄바꿈=<br /> (이스케이프). */
function noticeToHtml(notice: string): string {
  return notice
    .split(/\n{2,}/)
    .map((block) => `<p>${block.split("\n").map(escapeHtml).join("<br />")}</p>`)
    .join("\n");
}

/**
 * 블로그스팟용: 마크다운 → HTML (Blogger "HTML 보기"에 붙여넣기).
 * - ##→<h2>, 불릿→<ul>, 번호→<ol>, 표→<table>, 인용→<blockquote> (marked/GFM)
 * - [이미지] 마커 제거 (블로그스팟은 이미지 미사용 채널)
 * - 본진 언급("신순주의 선한 금융")을 기사 상세 링크 앵커로 — 브랜드명 텍스트는 그대로 유지
 * - 필수 유의문구 2종(§6.11-4)을 본문에 1회 삽입
 * - 승인 심의필(review)이 있으면 <hr /> 뒤에 필수안내사항 전문을 붙인다(없으면 생략)
 */
export function toBlogspotHtml(
  markdown: string,
  slug: string,
  tags?: string[] | null,
  opts?: Pick<OsmuOptions, "review" | "mode">
): string {
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
  let out = hashtags ? `${linked}\n<p>${hashtags}</p>` : linked;

  // 필수 유의문구 2종 (§6.11-4 — 바이럴은 본문에 1회 이상, 회신 2026-07-21)
  out = insertBodyNoticesHtml(out);

  // 필수안내사항 — submission이면 항상(공란 심의필), publish면 승인 심의필 있을 때만.
  const notice = renderMandatoryNotice(opts?.review ?? undefined, opts?.mode ?? "publish");
  if (notice) {
    out += `\n<hr />\n${noticeToHtml(notice)}`;
  }

  return out;
}

/**
 * 네이버용: 마크다운 기호 제거 → 순수 텍스트 (네이버 에디터는 마크다운 미지원).
 * - ## 제거(소제목은 텍스트로), 굵게·기울임·인용(>) 마커 제거, 불릿 - → ·
 * - [이미지] 마커는 유지 (카드 PNG 삽입 위치 표시)
 * - 말미에 본진 기사 링크(네이버→본진 트래픽 다리) + 해시태그 자동 첨부
 * - 필수 유의문구 2종(§6.11-4)을 본문에 1회 삽입
 * - /diagnosis CTA는 includeDiagnosisCta일 때만(기본 off, §6.6)
 * - 승인 심의필(review)이 있으면 말미에 구분선과 함께 필수안내사항 전문(없으면 생략)
 */
export function toNaverText(
  markdown: string,
  opts?: { articleTitle?: string; slug?: string; tags?: string[] | null } & Pick<
    OsmuOptions,
    "review" | "includeDiagnosisCta" | "mode"
  >
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

  // 필수 유의문구 2종 (§6.11-4 — 조언 블록 아래, 없으면 본문 최하단, 회신 2026-07-21)
  text = insertBodyNoticesText(text);

  if (opts?.slug) {
    const articleUrl = `${SITE_URL}/news/${opts.slug}`;
    if (!text.includes(articleUrl)) {
      text += `\n\n📄 ${opts.articleTitle ?? "원문 심층 해설"}\n${articleUrl}`;
    }
  }

  // /diagnosis CTA — 심의 전까지 내린다(§6.6). 심의 완료 후 includeDiagnosisCta=true로 복원.
  if (opts?.includeDiagnosisCta) {
    const diagnosisUrl = `${SITE_URL}/diagnosis`;
    if (!text.includes(diagnosisUrl)) {
      text += `\n\n보험 리모델링 진단 👉 ${diagnosisUrl}`;
    }
  }

  const hashtags = toHashtags(opts?.tags);
  if (hashtags) {
    text += `\n\n${hashtags}`;
  }

  // 필수안내사항 — submission이면 항상(공란 심의필), publish면 승인 심의필 있을 때만.
  // 앞에 빈 줄 2개 + 구분선(플레인 텍스트).
  const notice = renderMandatoryNotice(opts?.review ?? undefined, opts?.mode ?? "publish");
  if (notice) {
    text += `\n\n\n─────────────\n\n${notice}`;
  }

  return text;
}
