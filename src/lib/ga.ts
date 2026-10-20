/**
 * GA4 이벤트 헬퍼 — Analytics.tsx가 주입한 gtag를 안전하게 호출.
 * gtag 부재(GA 미설정·광고 차단기·내부 트래픽 제외)여도 조용히 무시 — 기능 흐름을 절대 막지 않는다.
 *
 * 전환 이벤트(IX1 표준 4종 — 주간 유입 지수가 이 이름으로 센다):
 *   generate_lead(상담 신청 제출) · kakao_click(카카오 채널 링크 클릭) · diagnosis_complete(진단 완료) · tel_click(전화 링크 클릭)
 * 퍼널 세부 이벤트(기존 유지 — weekly_lead_report·content_analysis 가 읽는다):
 *   diagnosis_start · kakao_cta_click(position 구분) · article_cta_*_click
 * 모든 이벤트에 page_path · article_slug 가 붙는다(명시 파라미터가 이긴다).
 */

/** 내부 트래픽 경로 — GA 태그를 싣지 않는다. Analytics.tsx 인라인 스크립트와 같은 규칙. */
export const INTERNAL_PATH = /^\/(admin|preview)(\/|$)/;

/** 지금 보는 글 slug — /news/<slug> · /preview/news/<slug>, 아니면 ?ref=<slug>(글 CTA → 진단). 없으면 "". */
export function articleSlugOf(pathname: string, search: string): string {
  const m = pathname.match(/^\/(?:preview\/)?news\/([^/?#]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  return new URLSearchParams(search).get("ref") ?? "";
}

export function pageContext(pathname: string, search: string): { page_path: string; article_slug: string } {
  return { page_path: pathname, article_slug: articleSlugOf(pathname, search) };
}

export function gaEvent(name: string, params?: Record<string, string | number>) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { gtag?: (...args: unknown[]) => void };
  if (typeof w.gtag !== "function") return;
  try {
    w.gtag("event", name, { ...pageContext(window.location.pathname, window.location.search), ...(params ?? {}) });
  } catch {
    // 측정 실패는 무시
  }
}
