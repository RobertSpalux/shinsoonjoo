import type { Metadata } from "next";
import Link from "next/link";
import { BRAND, getCareer } from "@/lib/brand";

export const metadata: Metadata = {
  title: "인재채용 — GA명장 직속 팀에서 시작하세요",
  description:
    "프라임에셋 140본부 천안. 8년 연속 우수인증설계사 · GA명장 신순주 지사장이 직접 가르치는 정도(正道) 영업. 경력·신입 설계사 상시 채용.",
  alternates: { canonical: "/recruit" },
};

const VALUES = [
  {
    title: "정도(正道) 영업을 배웁니다",
    body: "우수인증설계사의 필수 요건은 '불완전판매 0건'입니다. 한 건의 계약보다 한 명의 고객을 남기는 영업, 8년 연속 인증으로 증명된 방식을 그대로 전수합니다.",
  },
  {
    title: "혼자 뛰게 두지 않습니다",
    body: "천안 오프라인 지사에서 지사장이 직접 동행하고 코칭합니다. 상품 교육부터 보상 처리 실무, 분쟁 대응까지 — 매뉴얼이 아니라 현장에서 배웁니다.",
  },
  {
    title: "콘텐츠가 영업을 돕습니다",
    body: "매일 자동 발행되는 금융 콘텐츠 포털이 팀의 무기입니다. 고객이 먼저 찾아오는 구조를 팀원 모두가 함께 씁니다.",
  },
];

export default function RecruitPage() {
  const { years } = getCareer();

  return (
    <main className="min-h-screen bg-[var(--color-ink)] pt-16">
      <section className="mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div className="max-w-2xl">
          <p className="mb-4 text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)]">
            JOIN US — {BRAND.company}
          </p>
          <h1 className="mb-6 font-serif text-3xl font-semibold leading-[1.22] tracking-[-0.015em] text-[var(--color-text-strong)] md:text-5xl">
            수수료가 아니라
            <br />
            <span className="text-[var(--color-forest)]">사람을 남기는 일</span>을
            배우고 싶다면
          </h1>
          <p className="max-w-lg text-[15px] leading-relaxed text-[var(--color-text-body)]">
            보험영업은 &ldquo;약속이자 누군가의 삶을 지키는 사명&rdquo;입니다.
            {years}년을 그렇게 일해온 GA명장의 팀에서, 오래 가는 설계사의 길을
            시작하세요. 경력·신입 모두 환영합니다.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {VALUES.map((v, i) => (
            <div
              key={v.title}
              className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-ink-card)] p-8 transition-[border-color] duration-300 hover:border-[var(--color-gold-dim)]"
            >
              <p className="mb-4 font-serif text-2xl font-semibold tabular-nums text-[var(--color-forest)]">
                0{i + 1}
              </p>
              <h2 className="mb-3 font-serif text-lg font-semibold text-[var(--color-text-strong)]">
                {v.title}
              </h2>
              <p className="text-sm leading-relaxed text-[var(--color-text-body)]">{v.body}</p>
            </div>
          ))}
        </div>

        {/* 최종 CTA — 딥그린 밴드 */}
        <div className="mt-16 overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-forest)] px-7 py-12 text-center md:mt-20 md:px-12 md:py-16">
          <span aria-hidden className="mx-auto mb-5 block h-px w-6 bg-[var(--color-gold)]" />
          <h2 className="font-serif text-2xl font-semibold leading-[1.3] text-[var(--color-ink)] md:text-[2rem]">
            먼저 커피 한 잔부터 시작하죠
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[var(--color-ink)]/80">
            이력서 없이도 괜찮습니다. 천안 지사에서 이 일이 나와 맞는지
            지사장과 직접 이야기해 보세요.
          </p>
          <Link
            href="/#consultation"
            className="mt-8 inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-7 py-3.5 text-sm font-semibold text-[var(--color-forest)] transition-transform duration-300 hover:-translate-y-px"
          >
            채용 상담 신청하기
          </Link>
        </div>
      </section>
    </main>
  );
}
