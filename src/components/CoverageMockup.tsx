import {
  MOCKUP_PROFILE,
  MOCKUP_CONTRACTS,
  MOCKUP_COVERAGE,
  MOCKUP_GAPS,
} from "@/lib/mockup-analysis";

/**
 * 담보 합산 목업 + 잔여 공백 경고 (커밋 N1).
 * "상담하면 이런 표를 받습니다" — 가상 사례 1건으로 상담 동기를 만든다.
 * ⚠️ 프레이밍: 이 표는 '기준·평균'이 아니라 '한 사람의 사례'. 일반화 카피 금지.
 * ⚠️ PIPA: 전부 가상 목업 — '가상 사례' 라벨을 화면에 2회(오버라인·하단 각주) 명시.
 * 배경은 크림(--color-ink) 위에 놓는다 — 딥그린 밴드 사이의 대비 구간(DESIGN-SPEC).
 */

function fmtAmount(v: number | string | null): string {
  if (v === null) return "—";
  return typeof v === "number" ? v.toLocaleString("ko-KR") : v;
}

export default function CoverageMockup() {
  return (
    <section aria-label="담보 합산 분석 가상 사례">
      {/* 오버라인 라벨 — 가상 사례 명시 1회차 */}
      <p className="text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)]">
        {MOCKUP_PROFILE.label} · 실제 고객 데이터 아님
      </p>
      <span aria-hidden className="mt-2 block h-px w-6 bg-[var(--color-gold)]" />

      {/* '남의 사례'임이 첫 줄에서 즉시 전달되게 (N3 — 라벨은 안 읽는다는 전제) */}
      <h3 className="mt-5 font-serif text-xl font-semibold tracking-[-0.01em] text-[var(--color-text-strong)] md:text-2xl">
        다른 분의 표는 이렇게 나왔습니다
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
        당신의 표는 상담에서 실제 계약을 조회해야 나옵니다.
      </p>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{MOCKUP_PROFILE.desc}</p>

      {/* 담보 합산표 — md 이상: 표 */}
      <div className="mt-6 hidden overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-ink-card)] md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--color-line)]">
              <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-text-muted)]">
                담보
              </th>
              {MOCKUP_CONTRACTS.map((c) => (
                <th
                  key={c}
                  className="px-2 py-3 text-right text-xs font-medium text-[var(--color-text-muted)]"
                >
                  {c}
                </th>
              ))}
              <th className="px-3 py-3 text-right text-xs font-semibold text-[var(--color-text-strong)]">
                합계
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-text-muted)]">
                판단
              </th>
            </tr>
          </thead>
          <tbody>
            {MOCKUP_COVERAGE.map((row) => (
              <tr key={row.name} className="border-b border-[var(--color-line)] last:border-b-0">
                <td className="px-4 py-3 text-left">
                  <span className="text-[13px] font-medium text-[var(--color-text-body)]">
                    {row.name}
                  </span>
                  {row.note && (
                    <span className="mt-0.5 block text-[11px] leading-snug text-[var(--color-text-muted)]">
                      {row.note}
                    </span>
                  )}
                </td>
                {row.amounts.map((v, i) => (
                  <td
                    key={MOCKUP_CONTRACTS[i]}
                    className="px-2 py-3 text-right text-xs tabular-nums text-[var(--color-text-body)]"
                  >
                    {fmtAmount(v)}
                  </td>
                ))}
                {/* 합계 = 각성 포인트 — 어느 증권에도 안 적힌 숫자 */}
                <td className="px-3 py-3 text-right text-[13px] font-bold tabular-nums text-[var(--color-text-strong)]">
                  {row.total}
                </td>
                <td className="px-4 py-3 text-right text-xs font-semibold text-[var(--color-text-body)]">
                  {row.verdict}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 담보 합산 — md 미만: 카드 스택 (가로스크롤 금지) */}
      <div className="mt-6 space-y-3 md:hidden">
        {MOCKUP_COVERAGE.map((row) => {
          const parts = row.amounts
            .map((v, i) => (v === null ? null : `${MOCKUP_CONTRACTS[i]} ${fmtAmount(v)}`))
            .filter(Boolean);
          return (
            <div
              key={row.name}
              className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-ink-card)] px-5 py-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-[var(--color-text-body)]">{row.name}</span>
                <span className="shrink-0 text-xs font-semibold text-[var(--color-text-body)]">
                  {row.verdict}
                </span>
              </div>
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-[var(--color-text-strong)]">
                {row.total}
              </p>
              {parts.length > 0 && (
                <p className="mt-1 text-[11px] tabular-nums text-[var(--color-text-muted)]">
                  {parts.join(" · ")}
                </p>
              )}
              {row.note && (
                <p className="mt-1 text-[11px] leading-snug text-[var(--color-text-muted)]">
                  {row.note}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* ★ 핵심 카피 — 기준이 아니라 사례. 일반화 금지 프레이밍 */}
      <div className="mt-8">
        <p className="font-serif text-lg font-semibold leading-snug tracking-[-0.01em] text-[var(--color-text-strong)] md:text-xl">
          사람마다 다 다릅니다. 그래서 합산해봐야 압니다.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-body)]">
          위 숫자는 기준이 아니라 한 사람의 사례입니다. 적정 보장액은 나이·가족력·기존 계약에 따라
          전부 달라집니다.
        </p>
      </div>

      {/* ⭐ 잔여 공백 경고 — 시스템이 자기 제안의 구멍을 먼저 보고한다 */}
      <div className="mt-8 border-l-[3px] border-[var(--color-gold)] bg-[var(--color-ink-soft)] px-5 py-6 md:px-6">
        <h4 className="font-serif text-base font-semibold text-[var(--color-text-strong)] md:text-lg">
          이 재설계안으로도 메워지지 않는 곳
        </h4>
        <p className="mt-1 text-sm text-[var(--color-text-body)]">
          제안이 못 메운 구멍을 먼저 보고합니다.
        </p>
        <ul className="mt-4 space-y-3">
          {MOCKUP_GAPS.map((g) => (
            <li key={g.title}>
              <p className="text-sm font-semibold text-[var(--color-text-strong)]">{g.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-[var(--color-text-body)]">{g.body}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* 하단 각주 — 가상 사례 명시 2회차 */}
      <p className="mt-6 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
        실제 표는 상담 시 전 계약을 조회해 담보 단위로 산출됩니다. 위 화면은 이해를 돕기 위한 가상
        샘플입니다.
      </p>
    </section>
  );
}
