import { MOCKUP_CASES, MOCKUP_CONCLUSION } from "@/lib/mockup-analysis";

/**
 * 담보 리모델링 목업 — 실제 분석 결과 2건(익명), 기존 → 신규 2열 (커밋 O4).
 * ⭐ 리모델링은 진단이 아니라 처방 — 화살표 오른쪽(신규값)이 본체이자 시선의 종착지.
 * ⭐ 사례 2건 병렬: 보험료가 준 사례와 는 사례를 나란히 — "결론이 미리 정해져 있지 않다"의 증명.
 * ⚠️ 손익 색상(빨강/초록) 금지 — 증가가 나쁜 결과처럼 보이면 이 설계가 무너진다. 둘 다 동일 톤.
 * ⚠️ 표 대신 행 스택 — 셀 줄바꿈 깨짐 원천 차단. 금액 값은 nowrap.
 * ⚠️ 숫자 색은 --color-text-strong/--color-text-body/--color-text-muted만. 골드는 헤어라인 전용.
 * 배경은 크림(--color-ink) 위에 놓는다 — 딥그린 밴드 사이의 대비 구간(DESIGN-SPEC).
 */

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export type ContractAnswer = "1~2개" | "3~5개" | "6~9개" | "10개 이상" | "잘 모르겠다";

/**
 * 응답별 도입 문장 (N8) — 진단 응답(계약 개수)과 목업의 논리를 잇는다.
 * ⚠️ 문장은 확정 카피 — 임의로 다듬지 말 것. 목업 데이터는 절대 응답에 맞춰 바꾸지 않는다
 * (실제 분석 결과를 조작하는 것 = 과장광고·PIPA 리스크. 바뀌는 건 도입 문장뿐).
 */
const INTRO_BY_CONTRACTS: Record<ContractAnswer, string> = {
  "1~2개":
    "계약이 적다는 건 새는 곳이 없다는 뜻이지, 비어 있지 않다는 뜻은 아닙니다. 아래 두 분은 계약이 많았지만 — 두 분 모두 비어 있던 곳이 나왔습니다.",
  "3~5개":
    "계약이 여러 개면 같은 담보가 반드시 흩어집니다. 본인은 그 합계를 알 수 없습니다. 아래 두 분이 그랬습니다.",
  "6~9개":
    "계약이 여러 개면 같은 담보가 반드시 흩어집니다. 본인은 그 합계를 알 수 없습니다. 아래 두 분이 그랬습니다.",
  "10개 이상":
    "계약이 여러 개면 같은 담보가 반드시 흩어집니다. 본인은 그 합계를 알 수 없습니다. 아래 두 분이 그랬습니다.",
  "잘 모르겠다": "개수를 모르신다면, 합계는 더더욱 모르십니다. 아래 두 분도 그랬습니다.",
};

export default function CoverageMockup({ contractAnswer }: { contractAnswer?: ContractAnswer } = {}) {
  const intro = contractAnswer ? INTRO_BY_CONTRACTS[contractAnswer] : undefined;
  return (
    <section aria-label="담보 합산 분석 가상 사례">
      {/* 오버라인 라벨 — 가상 사례 명시 1회차 */}
      <p className="text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)]">
        가상 사례 · 실제 고객 데이터 아님
      </p>
      <span aria-hidden className="mt-2 block h-px w-6 bg-[var(--color-gold)]" />

      <h3 className="mt-5 font-serif text-xl font-semibold tracking-[-0.01em] text-[var(--color-text-strong)] md:text-2xl">
        다른 분들의 표는 이렇게 나왔습니다
      </h3>
      {intro ? (
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-body)]">{intro}</p>
      ) : (
        // 기본 문장 — 다른 페이지에서 응답 없이 재사용할 때
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
          당신의 표는 상담에서 실제 계약을 조회해야 나옵니다.
        </p>
      )}

      {/* 사례 카드 2장 — 줄어든 사례와 늘어난 사례를 같은 톤으로 나란히 */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {MOCKUP_CASES.map((c) => (
          <article
            key={c.id}
            // 상단 4px 딥그린 바 = 서류·리포트 질감 (배경 이미지 없이 — O5)
            className="rounded-[var(--radius-lg)] border border-[var(--color-line)] border-t-4 border-t-[var(--color-forest)] bg-[var(--color-ink-card)] p-7 md:p-8"
          >
            <p className="text-[11px] font-semibold tracking-[0.06em] text-[var(--color-text-muted)]">
              {c.label} · 계약 {c.contractCount}건
            </p>

            {/* ⭐ 보험료 변화 — 세리프 숫자(결론 숫자는 헤드라인급). 방향과 무관하게 동일한 색 */}
            <p className="mt-3 font-serif text-xl font-bold tabular-nums tracking-[-0.01em] text-[var(--color-text-strong)]">
              {won(c.premiumBefore)} <span aria-hidden>→</span> {won(c.premiumAfter)}
            </p>
            <p className="mt-1 text-sm font-medium text-[var(--color-text-body)]">{c.premiumDelta}</p>

            {/* 헤드라인 3줄 기준 고정(O6-1) — 좌우 카드의 행 시작 Y를 맞춘다. 모바일은 해제(세로 스택) */}
            <p className="mt-4 font-serif text-[15px] font-semibold leading-snug text-[var(--color-text-strong)] md:min-h-[62px]">
              {c.headline}
            </p>

            {/* 담보 행 스택 — [담보명(+note)] … [기존 → ⭐신규(+판단)]. 신규 금액 = 딥그린 세리프(O5).
                모든 행 동일 min-h(O6-1) — note 유무와 무관하게 좌우 카드의 행 Y가 맞는다.
                ⚠️ 여백을 하단으로 밀어내는 flex-1/justify-between 금지 — 행이 맞아야 정렬이다.
                모바일은 min-h 해제(나란히 놓이지 않음) */}
            <div className="mt-4 border-t border-[var(--color-line)]">
              {c.rows.map((r) => {
                // after가 verdict와 같으면('조정'·'유지') 금액이 아님 → muted + 판단 캡션 생략(중복 방지)
                const isAmount = r.after !== r.verdict;
                return (
                  <div
                    key={r.name}
                    className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] py-4 last:border-b-0 md:min-h-[78px]"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text-body)]">{r.name}</p>
                      {r.note && (
                        <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-text-muted)]">
                          {r.note}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p>
                        <span className="whitespace-nowrap text-xs tabular-nums text-[var(--color-text-muted)]">
                          {r.before}
                        </span>
                        <span aria-hidden className="mx-1.5 text-xs text-[var(--color-text-muted)]">
                          →
                        </span>
                        {isAmount ? (
                          <span className="whitespace-nowrap font-serif text-lg font-bold tabular-nums text-[var(--color-forest)]">
                            {r.after}
                          </span>
                        ) : (
                          <span className="whitespace-nowrap text-sm font-medium text-[var(--color-text-muted)]">
                            {r.after}
                          </span>
                        )}
                      </p>
                      {isAmount && (
                        <p className="mt-0.5 text-[11px] font-semibold text-[var(--color-text-body)]">
                          {r.verdict}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>

      {/* 결론 — 3단 위계 (O6): 1단이 확실히 크고 3단이 확실히 작아야 한다. 크림 유지(딥그린 아님) */}

      {/* [1단 · 결론] — 이 페이지의 결론. 여백을 크게 줘서 숨 쉬게 한다 */}
      <div className="py-8 md:py-10">
        <p className="font-serif text-2xl font-semibold leading-snug tracking-[-0.015em] text-[var(--color-text-strong)] md:text-[1.75rem]">
          {MOCKUP_CONCLUSION.headline}
        </p>
        <p className="mt-3 text-base leading-relaxed text-[var(--color-text-body)]">
          {MOCKUP_CONCLUSION.body}
        </p>
      </div>

      {/* [2단 · 보강] — 골드 헤어라인으로 구분 */}
      <div>
        <span aria-hidden className="block h-px w-6 bg-[var(--color-gold)]" />
        <p className="mt-4 text-[15px] leading-relaxed text-[var(--color-text-body)]">
          {MOCKUP_CONCLUSION.note}
        </p>
      </div>

      {/* [3단 · 각주] — 가장 약하게. 잔여 고지 + 상담 산출 + 가상 샘플(PIPA 2회차) 통합 */}
      <p className="mt-6 text-[13px] leading-relaxed text-[var(--color-text-muted)]">
        {MOCKUP_CONCLUSION.footnote}
      </p>
    </section>
  );
}
