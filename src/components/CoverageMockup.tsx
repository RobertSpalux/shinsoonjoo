import { MOCKUP_CASES, MOCKUP_CONCLUSION } from "@/lib/mockup-analysis";

/**
 * 담보 합산 목업 — 실제 분석 결과 2건(익명) + 잔여 공백 경고 (커밋 N4).
 * ⭐ 사례 2건 병렬: 보험료가 준 사례와 는 사례를 나란히 — "결론이 미리 정해져 있지 않다"의 증명.
 * ⚠️ 손익 색상(빨강/초록) 금지 — 증가가 나쁜 결과처럼 보이면 이 설계가 무너진다. 둘 다 동일 톤.
 * ⚠️ 표 대신 행 스택 — 셀 줄바꿈 깨짐(판/단, 만/원) 원천 차단. 합계는 nowrap.
 * ⚠️ 숫자 색은 --color-text-strong/--color-text-body만. 골드는 헤어라인 전용.
 * 배경은 크림(--color-ink) 위에 놓는다 — 딥그린 밴드 사이의 대비 구간(DESIGN-SPEC).
 */

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export default function CoverageMockup() {
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
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
        당신의 표는 상담에서 실제 계약을 조회해야 나옵니다.
      </p>

      {/* 사례 카드 2장 — 줄어든 사례와 늘어난 사례를 같은 톤으로 나란히 */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {MOCKUP_CASES.map((c) => (
          <article
            key={c.id}
            className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-ink-card)] p-5 md:p-6"
          >
            <p className="text-[11px] font-semibold tracking-[0.06em] text-[var(--color-text-muted)]">
              {c.label} · 계약 {c.contractCount}건
            </p>

            {/* ⭐ 보험료 변화 — 방향과 무관하게 동일한 색(둘 다 정답일 수 있으므로) */}
            <p className="mt-3 text-xl font-bold tabular-nums tracking-[-0.01em] text-[var(--color-text-strong)]">
              {won(c.premiumBefore)} <span aria-hidden>→</span> {won(c.premiumAfter)}
            </p>
            <p className="mt-1 text-sm font-medium text-[var(--color-text-body)]">{c.premiumDelta}</p>

            <p className="mt-4 font-serif text-[15px] font-semibold leading-snug text-[var(--color-text-strong)]">
              {c.headline}
            </p>

            {/* 담보 행 스택 — 합계 좌측 골드 헤어라인 세로선 = "여기가 결론" */}
            <div className="mt-4 border-t border-[var(--color-line)]">
              {c.rows.map((r) => (
                <div
                  key={r.name}
                  className="flex items-stretch justify-between gap-6 border-b border-[var(--color-line)] py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-body)]">{r.name}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{r.spread}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span aria-hidden className="w-px self-stretch bg-[var(--color-gold)]" />
                    <div className="text-right">
                      <p className="whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-text-strong)]">
                        {r.total}
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold text-[var(--color-text-body)]">
                        {r.verdict}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      {/* 결론 — 크림 유지(딥그린 밴드 아님). 절감 프레이밍 금지의 핵심 카피 */}
      <div className="mt-8">
        <p className="font-serif text-lg font-semibold leading-snug tracking-[-0.01em] text-[var(--color-text-strong)] md:text-xl">
          {MOCKUP_CONCLUSION.headline}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-body)]">
          {MOCKUP_CONCLUSION.body}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          {MOCKUP_CONCLUSION.note}
        </p>
      </div>

      {/* ⭐ 잔여 공백 경고 — 시스템이 자기 제안의 구멍을 먼저 보고한다 */}
      <div className="mt-8 border-l-[3px] border-[var(--color-gold)] bg-[var(--color-ink-soft)] px-5 py-6 md:px-6">
        <h4 className="font-serif text-base font-semibold text-[var(--color-text-strong)] md:text-lg">
          두 사례 모두, 제안으로도 메워지지 않은 곳이 남았습니다
        </h4>
        <p className="mt-1 text-sm text-[var(--color-text-body)]">
          저희는 제안이 못 메운 구멍을 먼저 보고합니다.
        </p>
        <ul className="mt-4 space-y-3">
          {MOCKUP_CASES.map((c) => (
            <li key={c.id}>
              <p className="text-sm font-semibold text-[var(--color-text-strong)]">
                {c.label} — {c.gaps.length}건
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-[var(--color-text-body)]">
                {c.gaps.join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {/* 하단 각주 — 가상 사례 명시 2회차 */}
      <p className="mt-6 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
        실제 표는 상담에서 전 계약을 조회해 담보 단위로 산출됩니다. 위 화면은 실제 분석 결과를
        익명화한 가상 샘플이며, 결과는 개인의 계약 구성에 따라 완전히 달라집니다.
      </p>
    </section>
  );
}
