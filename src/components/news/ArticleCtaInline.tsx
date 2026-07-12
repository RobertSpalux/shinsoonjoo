"use client";

import Link from "next/link";
import { gaEvent } from "@/lib/ga";

/**
 * 글 중간 진단 다리 (커밋 N5) — 담보 합산표 직후 "내 건 얼마지?"가 생기는 지점에 놓는다.
 * 본문 마크다운의 <!--CTA--> 마커 위치에 렌더러가 치환 삽입 (기사당 최대 1회).
 * ⚠️ 에디토리얼 원칙: 카드·채움 버튼·딥그린·알약 배지 금지 — 흐름을 끊지 않는 텍스트 다리.
 * 골드는 위아래 헤어라인(허용 용도)만.
 */
export default function ArticleCtaInline({ slug }: { slug: string }) {
  return (
    <aside
      aria-label="보험 진단 안내"
      className="my-8 flex flex-col gap-3 border-y border-[var(--color-gold)] py-6 sm:flex-row sm:items-center sm:justify-between md:py-8"
    >
      <p className="text-[15px] font-semibold text-[var(--color-text-strong)]">
        내 담보 합계는 얼마일까요?
      </p>
      <Link
        href="/diagnosis"
        onClick={() => gaEvent("article_cta_inline_click", { article_slug: slug })}
        className="self-start border-b border-[var(--color-gold-dim)] pb-0.5 text-sm font-medium text-[var(--color-text-strong)] transition-colors duration-300 hover:border-[var(--color-gold)] sm:self-auto"
      >
        3분 진단받기 →
      </Link>
    </aside>
  );
}
