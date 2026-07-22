/**
 * 담보 합산 분석 목업 싱글소스 (커밋 O4) — 실제 분석 결과 2건을 익명화한 가상 샘플.
 * 진단 결과·(추후) 홈·인스타 케이스카드에서 재사용.
 *
 * ⭐ 구조: 기존 → 신규 2열. 리모델링은 진단이 아니라 처방이다 — 화살표 오른쪽이 본체.
 * ⭐ 행 선정 원칙: '없음 → 없음' 행은 절대 넣지 않는다. "채워진 것"과 "정리된 것"만 보여준다.
 *
 * ⚠️ PIPA·컴플라이언스 하드 룰:
 * - 보험사명·상품명·나이·성별·이름을 절대 넣지 않는다 (익명화 완료 상태 유지).
 * - 이 표는 '기준·평균'이 아니라 '한 사람의 사례'다 — "이 정도면 적정" 류 일반화 카피 금지.
 * - 목업을 진단 응답에 맞춰 동적으로 바꾸지 말 것 — '내 결과'로 오해될 소지 = PIPA·과장광고 리스크.
 *
 * ⭐ 사례가 2건인 이유: 리모델링 결과 보험료는 줄 수도(사례 1), 늘 수도(사례 2) 있다.
 * 한 사례만 보여주면 "리모델링=보험료 절약 약속"으로 오해됨 → 과장광고 + 브랜드 훼손.
 * ⚠️ "절감/할인/저렴" 류 카피 금지 (보험업법 과장광고).
 */

export type Verdict = "유지" | "증액" | "감액" | "신규" | "조정";

export interface MockupRow {
  name: string;
  /** 기존 보장 (없으면 '없음') */
  before: string;
  /** 신규 보장 — 유지되면 '유지', 재배치면 '조정', 신규·변경이면 금액. ⭐ 여기가 결론 */
  after: string;
  verdict: Verdict;
  note?: string;
  /** 신규 담보의 납입기간·만기 (예: '20년납 90세', '10년 갱신') — 갱신형은 추정 보험료 포함 */
  term: string;
}

export interface MockupCase {
  id: string;
  /** 카드 상단 라벨 */
  label: string;
  contractCount: number;
  /** 원 */
  premiumBefore: number;
  /** 원 */
  premiumAfter: number;
  premiumDelta: string;
  deltaDirection: "down" | "up";
  /** 이 사례의 한 줄 핵심 */
  headline: string;
  rows: MockupRow[];
  /** 카드 하단 산출 기준 각주 (연령·성별·직업·기준일·합계 기준·갱신형 추정 고지) */
  premiumBasis: string;
}

export const MOCKUP_CASES: MockupCase[] = [
  {
    id: "case-a",
    label: "사례 1",
    contractCount: 10,
    premiumBefore: 505921,
    premiumAfter: 473983,
    premiumDelta: "월 31,938원 줄었습니다",
    deltaDirection: "down",
    headline: "겹쳐 있던 사망보장을 정리하고, 간병·수술 보장을 보강했습니다.",
    rows: [
      { name: "질병사망", before: "1억 4,740만원", after: "조정", verdict: "조정", note: "5개 계약에 흩어져 있었습니다", term: "20년납 종신" },
      { name: "상해사망", before: "2억 740만원", after: "1억원", verdict: "감액", term: "20년납 90세" },
      { name: "간병인 사용일당", before: "14만원", after: "20만원", verdict: "증액", term: "20년납 90세" },
      { name: "간호간병 통합서비스", before: "5만원", after: "7만원", verdict: "증액", term: "20년납 90세" },
      { name: "질병수술비", before: "20만원", after: "100만원", verdict: "증액", term: "20년납 90세" },
      { name: "특정질병수술비", before: "2,000만원", after: "3,360만원", verdict: "증액", term: "20년납 90세" },
    ],
    premiumBasis:
      "산출 기준 · 만 57세 · 남 · 사무직(상해 2급) · 기준일 2026.7.13 · 기존 계약 10건의 월 보험료 합계 기준. 담보별 납입기간·만기는 각 항목에 표기했으며, 갱신형 상품은 추정 보험료가 포함되어 실제와 다를 수 있습니다.",
  },
  {
    id: "case-b",
    label: "사례 2",
    contractCount: 8,
    premiumBefore: 405026,
    premiumAfter: 465442,
    premiumDelta: "월 60,416원 늘었습니다",
    deltaDirection: "up",
    headline: "운전자보험은 3개인데 항암치료비는 0원이었습니다. 그 자리를 채웠습니다.",
    rows: [
      { name: "일반암", before: "7,000만원", after: "1억원", verdict: "증액", term: "30년납 90세" },
      { name: "유사암", before: "700만원", after: "2,000만원", verdict: "증액", term: "30년납 90세" },
      { name: "표적항암치료비", before: "없음", after: "7,000만원", verdict: "신규", term: "10년 갱신" },
      { name: "항암 방사선치료비", before: "없음", after: "5,000만원", verdict: "신규", term: "30년납 90세" },
      { name: "심장질환진단비", before: "없음", after: "2,000만원", verdict: "신규", term: "30년납 90세" },
      { name: "상해사망", before: "6,000만원", after: "1억 100만원", verdict: "증액", term: "30년납 90세" },
    ],
    premiumBasis:
      "산출 기준 · 만 48세 · 남 · 종교인(상해 1급) · 기준일 2026.6.29 · 기존 계약 8건의 월 보험료 합계 기준. 담보별 납입기간·만기는 각 항목에 표기했으며, 갱신형 상품은 추정 보험료가 포함되어 실제와 다를 수 있습니다.",
  },
];

/** 결론 블록 3단 위계 (O6): [1단] headline+body 크게 / [2단] note 보강 / [3단] footnote 각주(가장 약하게) */
export const MOCKUP_CONCLUSION = {
  headline: "리모델링은 보험료를 깎는 일이 아닙니다.",
  body: "그 돈이 제대로 쓰이게 하는 일입니다. 겹친 곳은 정리하고, 빈 곳은 채웁니다. 그 결과 보험료는 줄 수도, 늘 수도 있습니다.",
  note: "계약이 2개인 분도, 20개인 분도 있습니다. 몇 개든 상관없습니다 — 합쳐봐야 보입니다.",
  /** 잔여 고지 + 상담 산출 각주 통합 — 마지막 문장은 PIPA '가상 샘플' 2회 명시 유지용(N1) */
  footnote:
    "해지로 사라졌는데 신규가 직접 대체하지 않는 담보가 있으면 그것도 함께 말씀드립니다. 실제 표는 상담에서 전 계약을 조회해 담보 단위로 산출되며, 결과는 개인의 계약 구성에 따라 완전히 달라집니다. 위 화면은 익명화한 가상 샘플입니다.",
} as const;
