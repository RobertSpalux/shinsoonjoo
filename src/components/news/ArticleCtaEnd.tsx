"use client";

import Link from "next/link";
import { gaEvent } from "@/lib/ga";

/**
 * 글 끝 CTA 딥그린 밴드 (커밋 N5) — 모든 기사에 자동 삽입 (뉴스·상록수 공통).
 * 주 목적지는 /diagnosis — 진단 페이지의 익명 사례 2건 + 잔여 공백 경고를 보고 오는 리드가
 * 더 좋은 리드다.
 * ⚠️ 카톡 채널 추가 보조 링크는 제거함(2026-07-14) — "새 글과 보험 점검 소식은 카카오톡 채널에서"라고
 * 약속했지만 채널에서 아직 아무 발송도 하지 않는다. 없는 서비스를 약속하는 CTA는 신뢰를 깎는다.
 * 실제로 주 1회 발송을 시작하면 그때 되살린다. 그때까지 CTA는 진단 하나에 집중(주 CTA 하나 원칙).
 */
export default function ArticleCtaEnd({ slug }: { slug: string }) {
  return (
    <aside className="mt-16 rounded-[var(--radius-lg)] bg-[var(--color-forest)] p-8 text-center md:p-10">
      <span aria-hidden className="mx-auto mb-4 block h-px w-6 bg-[var(--color-gold)]" />
      <p className="font-serif text-lg font-semibold text-[var(--color-ink)] md:text-xl">
        이 글은 알려드리는 데까지입니다.
      </p>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--color-ink)]/80">
        실제로 겹쳤는지, 비었는지는 전 계약을 조회해야 알 수 있습니다.
        <br className="hidden md:block" /> 먼저 3분 진단으로 지금 상태를 확인해 보십시오.
      </p>
      <Link
        href="/diagnosis"
        onClick={() => gaEvent("article_cta_end_diagnosis_click", { article_slug: slug })}
        className="mt-6 inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-7 py-3.5 text-sm font-semibold text-[var(--color-forest)] transition-transform duration-300 hover:-translate-y-px"
      >
        3분 진단 받아보기
      </Link>
    </aside>
  );
}
