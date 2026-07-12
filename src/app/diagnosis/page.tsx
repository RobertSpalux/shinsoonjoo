import type { Metadata } from "next";
import DiagnosisQuiz from "@/components/diagnosis/DiagnosisQuiz";
import { getCareer } from "@/lib/brand";

const { years } = getCareer();

export const metadata: Metadata = {
  title: "자산 방어력 진단 — 2분 무료 진단",
  description: `내 보험, 제대로 되어 있을까? 7개 질문으로 자산 방어력을 진단하고 항목별 근거까지 바로 확인하세요. 상담 강요 없음.`,
  alternates: { canonical: "/diagnosis" },
};

export default function DiagnosisPage() {
  return (
    // overflow-x-clip: 퀴즈 하단 인증 밴드가 w-screen 풀블리드라 가로 스크롤 방지 (N9)
    <main className="min-h-screen overflow-x-clip bg-[var(--color-ink)] pt-16">
      <section className="mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
        {/* 히어로 — 히어로급만 중앙정렬. 본문과 좌측 라인을 맞추기 위해 폭은 질문 블록과 동일(max-w-2xl) */}
        <div className="mx-auto mb-12 max-w-2xl text-center">
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
      </section>
    </main>
  );
}
