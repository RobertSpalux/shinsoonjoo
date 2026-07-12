/**
 * 담보 합산 분석 목업 싱글소스 — 진단 결과·(추후) 홈·인스타 케이스카드에서 재사용.
 * ⚠️ 전부 가상 사례다(PIPA — CLAUDE.md 6절). 실데이터를 절대 넣지 않는다.
 * ⚠️ 이 표는 '기준·평균'이 아니라 '한 사람의 사례'다 — "이 정도면 적정" 류 일반화 카피 금지.
 */

export const MOCKUP_PROFILE = {
  label: "가상 사례",
  desc: "40대 남성 · 계약 5건 · 월 보험료 42만원",
} as const;

export const MOCKUP_CONTRACTS = ["계약A", "계약B", "계약C", "계약D", "계약E"] as const;

export type CoverageVerdict = "유지" | "보완" | "조정" | "검토";

export interface CoverageRow {
  name: string;
  /** 계약별 금액(만원). null = 해당 담보 없음. 문자열은 그대로 표기(예: '4세대') */
  amounts: (number | string | null)[];
  total: string;
  verdict: CoverageVerdict;
  note: string;
}

export const MOCKUP_COVERAGE: CoverageRow[] = [
  { name: "암 진단비",         amounts: [2000, null, 1000, 2000, null],   total: "5,000만원",     verdict: "유지", note: "3개 계약에 흩어져 있었습니다" },
  { name: "뇌혈관 진단비",      amounts: [null, null, 1000, null, null],   total: "1,000만원",     verdict: "보완", note: "" },
  { name: "허혈성심장 진단비",  amounts: [null, null, 1000, null, null],   total: "1,000만원",     verdict: "보완", note: "" },
  { name: "질병사망",          amounts: [5000, 3000, null, 2000, 2700],   total: "1억 2,700만원", verdict: "조정", note: "4개 계약에 흩어진 과설계 구간입니다" },
  { name: "상해사망",          amounts: [null, 1000, null, null, 1000],   total: "2,000만원",     verdict: "유지", note: "" },
  { name: "실손의료비",        amounts: [null, null, null, null, "4세대"], total: "1건",          verdict: "유지", note: "" },
  { name: "수술비",            amounts: [null, null, null, null, null],   total: "없음",          verdict: "검토", note: "" },
  { name: "간병·장기요양",     amounts: [null, null, null, null, null],   total: "없음",          verdict: "검토", note: "" },
];

export const MOCKUP_GAPS = [
  { title: "간병·장기요양 — 미반영", body: "보험료 여력 안에서 우선순위를 뒤로 뒀습니다. 3년 내 재검토가 필요합니다." },
  { title: "뇌혈관 진단비 — 권고액 중 일부만 확보", body: "건강고지 이력으로 나머지는 인수가 어렵습니다." },
  { title: "수술비 — 대체 담보로 우회", body: "완전한 대체는 아닙니다. 조건이 바뀌면 다시 봅니다." },
];
