"use client";

import { useEffect, useRef } from "react";
import { gaEvent } from "@/lib/ga";

/**
 * CF1b — CTA 노출 측정. 요소가 화면에 절반 이상 들어오면 cta_view 를 1회만 보낸다.
 * 화면 텍스트·DOM 은 건드리지 않고 ref 만 붙인다. IntersectionObserver 미지원이면 조용히 무시.
 */
export function useCtaView<T extends Element>(position: "inline" | "end", slug: string) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          gaEvent("cta_view", { position, article_slug: slug });
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [position, slug]);
  return ref;
}
