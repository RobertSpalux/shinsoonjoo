/**
 * 진단 결과 넛지 — 응답 프로필 → "자주 나타나는 패턴" 매핑 테이블.
 *
 * ⚠️ 컴플라이언스 (CLAUDE.md 2·6절):
 * - 단정 금지: "~가능성", "자주 나타나는 패턴", "~인 경우가 많습니다" 등 추정 표현만 사용
 * - 특정사·상품 언급 금지, 수익률·환급 보장 금지, "무조건 해지" 금지 — "점검·재설계" 프레임
 * - 웹은 설문 기반 추정까지만. 실계약 조회·분석은 상담 이후 설계사 권한으로만(오프라인)
 */

export interface DiagnosisAnswers {
  premium?: string;
  coverages?: string[];
  risk?: string;
  profile?: string;
}

interface PatternRule {
  /** 우선순위 낮을수록 먼저 노출 */
  priority: number;
  when: (a: DiagnosisAnswers) => boolean;
  text: string;
}

const SENIOR = ["5060 · 자녀 독립 준비", "60+ · 은퇴 전후"];

const PATTERN_RULES: PatternRule[] = [
  {
    // 걱정하는 리스크와 보유 보장의 불일치 — 가장 강한 신호라 최우선
    priority: 1,
    when: (a) => a.risk === "암·중대질병 치료비" && !(a.coverages ?? []).includes("암 진단비"),
    text: "가장 걱정하시는 암·중대질병 보장이 비어 있을 가능성",
  },
  {
    priority: 1,
    when: (a) => a.risk === "병원비(실손) 공백" && !(a.coverages ?? []).includes("실손의료비"),
    text: "병원비 방어의 기본인 실손 보장이 공백일 가능성",
  },
  {
    priority: 1,
    when: (a) => a.risk === "은퇴 후 생활비" && !(a.coverages ?? []).includes("연금·저축"),
    text: "은퇴 생활비를 걱정하시지만 연금 준비가 비어 있을 가능성",
  },
  {
    priority: 2,
    when: (a) => SENIOR.includes(a.profile ?? "") && !(a.coverages ?? []).includes("간병·치매"),
    text: "이 연령대에서 가장 자주 발견되는 공백 — 간병·치매 보장 공백 가능성",
  },
  {
    priority: 2,
    when: (a) => SENIOR.includes(a.profile ?? "") && (a.coverages ?? []).includes("종신·사망보장"),
    text: "자녀 독립 이후에도 종신 중심 구조가 유지되는 패턴 — 보장 목적 재점검 여지",
  },
  {
    priority: 2,
    when: (a) => a.profile === "2030 · 싱글" && (a.coverages ?? []).includes("종신·사망보장"),
    text: "사회초년기에 종신 비중이 큰 패턴 — 보장 우선순위 재점검 여지",
  },
  {
    priority: 3,
    when: (a) => a.premium === "50~100만원" || a.premium === "100만원 이상",
    text: "보험료 규모가 큰 프로필에서 자주 나타나는 패턴 — 유사 보장 중복으로 보험료 과다 가능성",
  },
  {
    priority: 3,
    when: (a) => a.premium === "잘 모르겠어요",
    text: "보험료 총액을 모르는 경우, 점검 시 새는 보험료가 발견되는 경우가 많습니다",
  },
  {
    priority: 3,
    when: (a) => (a.coverages ?? []).includes("하나도 없거나 모름"),
    text: "보장 구조를 본인이 파악하지 못한 경우 — 중복 가입과 보장 공백이 함께 발견되는 경우가 많습니다",
  },
  {
    priority: 4,
    when: (a) => a.risk === "가장의 소득 상실" && ["3040 · 신혼/영유아 자녀", "4050 · 학령기 자녀"].includes(a.profile ?? ""),
    text: "가장 유고 시 소득 방어 장치가 얇은 프로필에서 자주 나타나는 패턴",
  },
  {
    priority: 4,
    when: (a) => a.risk === "상속세·증여",
    text: "상속·증여 대비는 보장 구조 전체와 함께 설계해야 하는 영역 — 부분 가입만으로 공백이 남는 경우가 많습니다",
  },
];

const FALLBACK_PATTERN =
  "비슷한 응답 프로필에서 중복 가입·과설계·보장 공백 중 하나 이상이 발견되는 경우가 많습니다";

/** 응답 프로필에 해당하는 패턴 2~3개 반환 (없으면 공통 패턴 1개) */
export function getDiagnosisPatterns(answers: DiagnosisAnswers): string[] {
  const matched = PATTERN_RULES.filter((r) => r.when(answers))
    .sort((a, b) => a.priority - b.priority)
    .map((r) => r.text)
    .slice(0, 3);
  return matched.length > 0 ? matched : [FALLBACK_PATTERN];
}
