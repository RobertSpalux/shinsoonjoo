/**
 * 상담 일화 뱅크 — 검증된 실제 상담 패턴만 프롬프트에 공급 (일화뱅크 커밋).
 *
 * 목적: 상록수 생성 시 모델이 일화를 지어내지 않도록(CLAUDE.md 일화 날조 금지),
 * 여기 구조화된 실제 패턴만 재료로 준다. 매칭 0건이면 "일화 없이 쓴다" —
 * 그럴듯한 사례를 만들어 채우는 폴백은 없다(팩트 없는 원고 금지 원칙과 동일).
 *
 * ⚠️ 운영 규칙 (엔트리 추가 시 필독):
 * - 엔트리 추가는 신순주 지사장이 실제 겪은 "반복 패턴"만.
 *   특정 날짜·특정 고객의 단건 서사 금지("어제 만난 50대 고객님이…" 류).
 * - 수치는 익명화·범위화된 것만. 웹에 이미 공개된 수준(src/lib/mockup-analysis.ts)을
 *   넘지 않는다(PIPA). 보험사명·상품명·나이·성별·이름 절대 금지.
 * - "리모델링=절감" 인상을 주는 감소 사례 단독 인용 금지 —
 *   감소·증가 균형 서술(PROGRESS 핵심 결정, 보험업법 과장광고 방지).
 *
 * 첫 2개 엔트리의 facts는 진단 페이지 목업 싱글소스(src/lib/mockup-analysis.ts,
 * MOCKUP_CASES case-a/case-b)의 수치를 그대로 옮긴 것 — 새 수치 창작 금지.
 * ⚠️ mockup-analysis.ts 수치를 고치면 여기도 함께 갱신할 것.
 */

export const ANECDOTES = [
  {
    key: "case-premium-down", // 진단 페이지 사례 1 (case-a) — 보험료 감소
    seeds: [
      "remodeling-hub",
      "remodeling-checklist-7",
      "leaky-insurance-patterns",
      "before-switching-4",
      "family-insurance-audit",
      "income-change-premium-ratio",
      "pre-retirement-restructure",
    ],
    pattern:
      "상담하다 보면 사망보장은 여러 계약에 겹쳐 있는데, 정작 간병·수술처럼 지금 쓰이는 보장은 비어 있는 분이 많습니다.",
    facts: {
      contracts: 10,
      premiumBefore: 505921,
      premiumAfter: 473983,
      delta: "월 31,938원 줄었습니다",
      changes: [
        "질병사망 1억 4,740만원이 5개 계약에 흩어져 있었음 → 조정",
        "상해사망 2억 740만원 → 1억원 감액",
        "간병인 사용일당 14만원 → 20만원 증액",
        "간호간병 통합서비스 없음 → 7만원 신규",
        "질병수술비 없음 → 200만원 신규",
        "특정질병수술비 없음 → 3,360만원 신규",
      ],
    },
    framing:
      "보험료가 줄어든 사례. 단독 인용 금지 — 증가 사례(case-premium-up)와 균형 서술. '절감/할인/저렴' 카피 금지(보험업법 과장광고).",
  },
  {
    key: "case-premium-up", // 진단 페이지 사례 2 (case-b) — 보험료 증가
    seeds: [
      "remodeling-hub",
      "remodeling-checklist-7",
      "leaky-insurance-patterns",
      "before-switching-4",
      "three-major-coverage",
      "driver-insurance-checkup",
    ],
    pattern:
      "상담하다 보면 운전자보험처럼 익숙한 담보는 두세 개씩 겹쳐 있는데, 항암치료비 같은 큰 위험은 0원인 분이 많습니다.",
    facts: {
      contracts: 8,
      premiumBefore: 405026,
      premiumAfter: 465442,
      delta: "월 60,416원 늘었습니다",
      changes: [
        "운전자보험 3개 중복, 항암치료비는 0원이었던 구성",
        "일반암 7,800만원 → 유지",
        "유사암 없음 → 1억원 신규",
        "표적항암치료비 없음 → 7,000만원 신규",
        "항암 방사선치료비 없음 → 5,000만원 신규",
        "심장질환진단비 없음 → 2,000만원 신규",
        "상해사망 6,000만원 → 1억 100만원 증액",
      ],
    },
    framing: "보험료가 늘어난 사례. 단독 인용 금지 — 감소 사례(case-premium-down)와 균형 서술.",
  },
];

/**
 * 시드 key로 매칭 엔트리를 골라 프롬프트 주입 섹션을 만든다.
 * 매칭 0건 → "일화 사용 금지" 지시 섹션 (일화 없이 쓴다 — 폴백 금지).
 * 반환: { count, section }
 */
export function buildAnecdoteSection(seedKey) {
  const matched = ANECDOTES.filter((a) => a.seeds.includes(seedKey));
  if (matched.length === 0) {
    return {
      count: 0,
      section: [
        "[일화 사용 금지]",
        "이 주제에는 검증된 상담 사례가 없다.",
        "일화·사례 서술 없이 제도·수치 사실만으로 쓴다.",
      ].join("\n"),
    };
  }
  const entries = matched.map((a, i) =>
    [
      `(사례 ${i + 1} — ${a.key})`,
      `· 패턴 화법: ${a.pattern}`,
      `· 사실(익명화 실사례 — 수치 변형·창작 금지): 계약 ${a.facts.contracts}건 / 월 보험료 ${a.facts.premiumBefore.toLocaleString("ko-KR")}원 → ${a.facts.premiumAfter.toLocaleString("ko-KR")}원 (${a.facts.delta})`,
      ...a.facts.changes.map((c) => `  - ${c}`),
      `· 서술 조건: ${a.framing}`,
    ].join("\n")
  );
  return {
    count: matched.length,
    section: [
      "[실제 상담 패턴 — 이 재료만 사용 가능]",
      "아래는 검증된 실제 패턴이다. 일화·사례는 반드시 이 안에서만 인용하고,",
      "'상담하다 보면 ~많습니다' 반복 패턴 화법으로 서술한다.",
      "여기 없는 사례·날짜·고객 서사를 만들어내지 않는다.",
      "",
      entries.join("\n\n"),
    ].join("\n"),
  };
}
