/**
 * GA4 이벤트 헬퍼 — Analytics.tsx가 주입한 gtag를 안전하게 호출.
 * gtag 부재(GA 미설정·광고 차단기)여도 조용히 무시 — 기능 흐름을 절대 막지 않는다.
 *
 * 전환 퍼널 이벤트: diagnosis_start → diagnosis_complete → lead_created / kakao_cta_click
 */
export function gaEvent(name: string, params?: Record<string, string | number>) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { gtag?: (...args: unknown[]) => void };
  if (typeof w.gtag !== "function") return;
  try {
    w.gtag("event", name, params ?? {});
  } catch {
    // 측정 실패는 무시
  }
}
