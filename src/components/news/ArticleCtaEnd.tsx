"use client";

import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { gaEvent } from "@/lib/ga";

/**
 * 글 끝 CTA 딥그린 밴드 (커밋 N5) — 모든 기사에 자동 삽입 (뉴스·상록수 공통).
 * 주 목적지는 /diagnosis — 진단 페이지의 익명 사례 2건 + 잔여 공백 경고를 보고 오는 리드가
 * 더 좋은 리드다. 카톡은 보조 텍스트 링크(채움 버튼 2개 나란히 금지 — CLAUDE.md 4절).
 * 보조 링크는 상담이 아니라 '채널 추가'(관계 장치 — CONTENT-STRATEGY §10, 커밋 P3-2):
 * 진단까지 안 간 독자를 카톡 채널 친구로 저장해 주 1회 재노출로 되돌아오게 한다.
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
      <p className="mt-4">
        <a
          href={BRAND.social.kakao}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => gaEvent("kakao_channel_add_click", { article_slug: slug, location: "article_end" })}
          className="text-xs text-[var(--color-ink)]/75 underline decoration-[var(--color-gold)]/60 underline-offset-4 transition-colors hover:text-[var(--color-ink)] hover:decoration-[var(--color-gold)]"
        >
          새 글과 보험 점검 소식은 카카오톡 채널에서 — 채널 추가 →
        </a>
      </p>
    </aside>
  );
}
