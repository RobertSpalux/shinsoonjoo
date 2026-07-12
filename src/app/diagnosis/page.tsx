import type { Metadata } from "next";
import DiagnosisQuiz from "@/components/diagnosis/DiagnosisQuiz";
import { getCareer } from "@/lib/brand";

const { years } = getCareer();

export const metadata: Metadata = {
  title: "자산 방어력 진단 — 2분 무료 진단",
  description: `내 보험, 제대로 되어 있을까? 7개 질문으로 자산 방어력을 진단하고 항목별 근거까지 바로 확인하세요. 상담 강요 없음.`,
  alternates: { canonical: "/diagnosis" },
};

const TRUST = [
  ["8년 연속", "우수인증설계사"],
  ["GA명장", "보험GA협회 인증"],
  ["0건", "불완전판매 (인증 필수 요건)"],
] as const;

export default function DiagnosisPage() {
  return (
    <main className="min-h-screen bg-[var(--color-ink)] pt-16">
      <section className="mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div className="mx-auto mb-12 max-w-xl text-center md:mb-16">
          <p className="mb-4 text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)]">
            ASSET DEFENSE CHECK
          </p>
          <h1 className="mb-4 font-serif text-3xl font-semibold leading-[1.22] tracking-[-0.015em] text-[var(--color-text-strong)] md:text-4xl">
            내 자산, 위기에 얼마나 버틸까?
          </h1>
          <p className="text-sm leading-relaxed text-[var(--color-text-body)]">
            질문 7개, 2분이면 끝납니다.
            <br className="hidden md:block" />
            {years}년 현장의 눈으로 직접 봐드립니다.
          </p>
        </div>

        <DiagnosisQuiz />

        <div className="mx-auto mt-16 grid max-w-xl grid-cols-3 gap-4 border-t border-[var(--color-line)] pt-8 text-center">
          {TRUST.map(([big, small]) => (
            <div key={small}>
              <p className="font-serif text-lg font-semibold tabular-nums text-[var(--color-forest)]">
                {big}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-[var(--color-text-muted)]">
                {small}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
