/**
 * 담보 합산 분석 목업 싱글소스 (커밋 N4) — 실제 분석 결과 2건을 익명화한 가상 샘플.
 * 진단 결과·(추후) 홈·인스타 케이스카드에서 재사용.
 *
 * ⚠️ PIPA·컴플라이언스 하드 룰:
 * - 보험사명·상품명·나이·성별·이름을 절대 넣지 않는다 (익명화 완료 상태 유지).
 * - 이 표는 '기준·평균'이 아니라 '한 사람의 사례'다 — "이 정도면 적정" 류 일반화 카피 금지.
 * - 목업을 진단 응답에 맞춰 동적으로 바꾸지 말 것 — '내 결과'로 오해될 소지 = PIPA·과장광고 리스크.
 *
 * ⭐ 사례가 2건인 이유: 리모델링 결과 보험료는 줄 수도(사례 1), 늘 수도(사례 2) 있다.
 * 한 사례만 보여주면 "리모델링=보험료 절감"으로 오해됨 → 과장광고 + 브랜드 훼손.
 * 두 사례를 나란히 놓아야 "결론이 미리 정해져 있지 않다"가 증명된다.
 * ⚠️ "절감/할인/저렴" 류 카피 금지 (보험업법 과장광고).
 */

export type Verdict = "유지" | "조정" | "감액" | "증액" | "신규" | "보완";

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
  rows: { name: string; total: string; spread: string; verdict: Verdict }[];
  /** 잔여 공백 담보명 */
  gaps: string[];
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
    headline: "사망보장이 5개 계약에 흩어져 1억 4,740만원이었습니다.",
    rows: [
      { name: "질병사망",      total: "1억 4,740만원", spread: "5개 계약에 흩어짐", verdict: "조정" },
      { name: "상해사망",      total: "2억 740만원",   spread: "6개 계약에 흩어짐", verdict: "감액" },
      { name: "일반암",        total: "7,600만원",     spread: "5개 계약에 흩어짐", verdict: "유지" },
      { name: "뇌혈관질환",    total: "500만원",       spread: "1개 계약뿐",        verdict: "보완" },
      { name: "간병·장기요양", total: "없음",          spread: "—",                 verdict: "신규" },
    ],
    gaps: ["허혈성심장질환", "암수술비", "뇌혈관질환수술비", "허혈성심장질환수술비"],
  },
  {
    id: "case-b",
    label: "사례 2",
    contractCount: 8,
    premiumBefore: 405026,
    premiumAfter: 465442,
    premiumDelta: "월 60,416원 늘었습니다",
    deltaDirection: "up",
    headline: "운전자보험은 3개인데, 항암치료비는 0원이었습니다.",
    rows: [
      { name: "교통사고처리지원금", total: "5억 6,000만원", spread: "운전자보험 3개", verdict: "유지" },
      { name: "일반암",             total: "7,800만원",     spread: "2개 계약",       verdict: "유지" },
      { name: "항암 방사선치료비",  total: "없음",          spread: "—",              verdict: "신규" },
      { name: "항암 약물치료비",    total: "없음",          spread: "—",              verdict: "신규" },
      { name: "심장질환진단비",     total: "없음",          spread: "—",              verdict: "신규" },
    ],
    gaps: [
      "질병80%미만후유장해",
      "허혈성심장질환",
      "암수술비",
      "뇌혈관질환수술비",
      "허혈성심장질환수술비",
      "질병입원일당",
      "보철치료비",
    ],
  },
];

export const MOCKUP_CONCLUSION = {
  headline: "리모델링은 보험료를 깎는 일이 아닙니다.",
  body: "그 돈이 제대로 쓰이게 하는 일입니다. 겹친 곳은 정리하고, 빈 곳은 채웁니다. 그 결과 보험료는 줄 수도, 늘 수도 있습니다.",
  note: "계약이 2개인 분도, 20개인 분도 있습니다. 몇 개든 상관없습니다 — 합쳐봐야 보입니다.",
} as const;
