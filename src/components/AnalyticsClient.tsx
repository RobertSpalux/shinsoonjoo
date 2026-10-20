"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { gaEvent, INTERNAL_PATH } from "@/lib/ga";

/**
 * GA4 보조(IX1) — 화면에 아무것도 그리지 않는다(텍스트 노드 0, §6.11-9).
 *  ① 공개 페이지에서 /admin·/preview 로 클라이언트 이동하면 그때부터 hit 를 끈다(ga-disable-<ID>) + 내부 표식.
 *  ② 문서 전체 클릭 위임 — 카카오 채널 링크 → kakao_click, tel: 링크 → tel_click.
 *     컴포넌트마다 onClick 을 달지 않으니 새 링크가 생겨도 빠지지 않는다. 위치는 가장 가까운 랜드마크로 잡는다.
 */
export default function AnalyticsClient({ gaId }: { gaId: string }) {
  const pathname = usePathname();

  useEffect(() => {
    const internal = INTERNAL_PATH.test(pathname ?? "");
    (window as unknown as Record<string, unknown>)[`ga-disable-${gaId}`] = internal;
    if (internal) {
      try {
        localStorage.setItem("gf_internal", "1");
      } catch {
        // 저장소 차단 — 표식만 못 남긴다
      }
    }
  }, [pathname, gaId]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      const position = a.dataset.gaPosition || (a.closest("footer") ? "footer" : a.closest("header") ? "header" : "body");
      if (href.startsWith("tel:")) gaEvent("tel_click", { position });
      else if (/pf\.kakao\.com/i.test(href)) gaEvent("kakao_click", { position });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
