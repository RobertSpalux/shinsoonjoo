import type { Metadata } from "next";
import DiagnosisQuiz from "@/components/diagnosis/DiagnosisQuiz";
import { getCareer } from "@/lib/brand";

const { years } = getCareer();

export const metadata: Metadata = {
  title: "자산 방어력 진단 — 3분 무료 진단",
  description: `내 보험, 제대로 되어 있을까? 4개 질문으로 자산 방어력을 진단하고 ${years}년 차 GA명장의 맞춤 리포트를 무료로 받아보세요. 상담 강요 없음.`,
  alternates: { canonical: "/diagnosis" },
};

export default function DiagnosisPage() {

  return (
    <main className="min-h-screen bg-[var(--color-ink)] pt-16">
      <section className="mx-auto max-w-7xl px-6 py-16 md:py-24">
        <div className="mx-auto mb-12 max-w-xl text-center md:mb-16">
          <p className="mb-4 text-xs font-semibold tracking-[0.25em] uppercase text-[var(--color-gold)]">
            Asset Defense Check
          </p>
          <h1 className="mb-4 text-3xl font-extrabold leading-tight tracking-tight text-slate-900 md:text-4xl">
            내 자산, 위기에 얼마나 버틸까?
          </h1>
          <p className="text-sm leading-relaxed text-slate-600">
            질문 4개, 3분이면 끝납니다. 플랫폼의 자동 분석이 아닌
            <br className="hidden md:block" />
            {years}년 현장 경험의 눈으로 직접 봐드립니다.
          </p>
        </div>

        <DiagnosisQuiz />

        <div className="mx-auto mt-16 grid max-w-xl grid-cols-3 gap-4 border-t border-[var(--color-line)] pt-8 text-center">
          {[
            ["8년 연속", "우수인증설계사"],
            ["GA명장", "보험GA협회 인증"],
            ["불완전판매 0건", "인증 필수 요건"],
          ].map(([big, small]) => (
            <div key={small}>
              <p className="text-sm font-bold text-[var(--color-gold-light)]">{big}</p>
              <p className="mt-1 text-[11px] text-slate-400">{small}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
