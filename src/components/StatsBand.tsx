"use client";

import CountUp from "./CountUp";
import { getCareer } from "@/lib/brand";

/**
 * 통계 스트립 — 딥그린 대비 밴드 (DESIGN-SPEC 3-4).
 * 히어로(크림) → 통계(딥그린) → 신뢰(크림)의 대비 리듬을 만든다.
 */
export default function StatsBand() {
  const { years, days } = getCareer();

  return (
    <section aria-label="경력 통계" className="w-full bg-[var(--color-forest)]">
      <div className="mx-auto max-w-4xl px-6 py-10 md:py-12">
        <div className="grid grid-cols-3 gap-6 border-y border-[var(--color-gold)] py-8 md:gap-10">
          <CountUp end={days} duration={2.8} label="고객과 함께한 날" suffix="일" variant="cream" />
          <CountUp end={8} duration={2} label="우수인증설계사 연속" suffix="년" variant="cream" />
          <CountUp end={years} duration={2} label="현장 경력" suffix="년차" variant="cream" />
        </div>
      </div>
    </section>
  );
}
