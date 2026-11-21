"use client";

import { useEffect } from "react";
import { gaEvent } from "@/lib/ga";

/**
 * CF1b — 글 페이지 스크롤 깊이 측정(scroll_50 · scroll_75, 각 1회). 렌더 출력 없음(텍스트 노드 0).
 * 기준 = 글 <article> 요소의 높이 대비 읽은 비율.
 */
export default function ArticleScrollDepth({ slug }: { slug: string }) {
  useEffect(() => {
    const el = document.querySelector("article");
    if (!el) return;
    const sent = new Set<number>();
    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const total = rect.height;
      if (total <= 0) return;
      const read = Math.min(Math.max(window.innerHeight - rect.top, 0), total);
      const pct = (read / total) * 100;
      for (const mark of [50, 75]) {
        if (pct >= mark && !sent.has(mark)) {
          sent.add(mark);
          gaEvent(`scroll_${mark}`, { article_slug: slug });
        }
      }
      if (sent.size === 2) window.removeEventListener("scroll", onScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [slug]);
  return null;
}
