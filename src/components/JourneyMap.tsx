// 고객 여정 지도 6단계 (벤치마킹 A) — 정적 정보 블록. 애니메이션·hover 없음.
// 문구는 BENCHMARK-IMPROVEMENTS.md A 표 정본. 변경 금지(별건 광고심의 대상).

type Step = {
  n: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    n: "1",
    title: "발견",
    body: "검색과 금융소식에서 '내 보험, 제대로 쓰이고 있나' 질문이 시작됩니다.",
  },
  {
    n: "2",
    title: "자가진단",
    body: "7개 문항으로 담보의 공백과 중복을 스스로 확인합니다.",
  },
  {
    n: "3",
    title: "상담 신청",
    body: "카카오톡이나 상담 예약으로 지사장과 바로 연결됩니다.",
  },
  {
    n: "4",
    title: "정밀 분석",
    body: "가입한 모든 계약을 함께 놓고, 흩어진 담보를 단위로 합산해 보이지 않던 실제 보장을 펼칩니다.",
  },
  {
    n: "5",
    title: "리모델링 처방",
    body: "무엇을 남기고 무엇을 채울지, 빈 곳까지 짚어 재설계안을 드립니다.",
  },
  {
    n: "6",
    title: "사후관리",
    body: "제도가 개편되거나 상황이 달라지면 정기 점검으로 이어갑니다.",
  },
];

export default function JourneyMap() {
  return (
    <section className="w-full bg-[var(--color-ink)] py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        {/* 섹션 헤더 (DESIGN-SPEC 4-4) */}
        <p className="text-[0.75rem] font-semibold tracking-[0.08em] uppercase text-[var(--color-text-muted)]">
          Customer Journey
        </p>
        <h2
          className="mt-5 text-[1.75rem] font-semibold leading-[1.3] tracking-[-0.01em] text-[var(--color-forest)] md:text-[2.25rem]"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          발견에서 사후관리까지, 여섯 걸음
        </h2>
        <span
          className="mt-6 block h-px w-8 bg-[var(--color-gold)]"
          aria-hidden="true"
        />
        <p className="mt-6 max-w-[52ch] text-[1.0625rem] leading-[1.85] text-[var(--color-text-body)]">
          숙제를 드리지 않습니다. 흩어진 담보를 대신 합산해, 보이지 않던 보장을 펼쳐 드립니다.
        </p>

        {/* 카드 6개 */}
        <ol className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step) => {
            const highlight = step.n === "4";
            return (
              <li
                key={step.n}
                className={
                  highlight
                    ? "rounded-[16px] border border-transparent bg-[var(--color-forest)] p-7 md:p-8"
                    : "rounded-[16px] border border-[var(--color-line)] bg-[var(--color-ink-card)] p-7 md:p-8"
                }
              >
                <span
                  className={
                    highlight
                      ? "flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-gold)] text-[0.875rem] font-semibold tabular-nums text-[var(--color-gold)]"
                      : "flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-forest)] text-[0.875rem] font-semibold tabular-nums text-[var(--color-ink)]"
                  }
                >
                  {step.n}
                </span>
                <h3
                  className={
                    highlight
                      ? "mt-5 text-[1.25rem] font-semibold text-[var(--color-ink)] md:text-[1.5rem]"
                      : "mt-5 text-[1.25rem] font-semibold text-[var(--color-forest)] md:text-[1.5rem]"
                  }
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  {step.title}
                </h3>
                <p
                  className={
                    highlight
                      ? "mt-3 text-[0.9375rem] leading-[1.75] text-[var(--color-ink)]/80 md:text-[1rem]"
                      : "mt-3 text-[0.9375rem] leading-[1.75] text-[var(--color-text-body)] md:text-[1rem]"
                  }
                >
                  {step.body}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
