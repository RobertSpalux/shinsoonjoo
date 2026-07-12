/**
 * 자산 방어력 진단 점수 로직 (커밋 N7) — 100점 만점, 5개 항목.
 * UI와 분리된 순수 함수(테스트 가능). 근거: 보장성 보험료 적정선 = 월 소득의 5~10%
 * (10% 초과 = 과다 의심 / 3% 미만 = 공백 의심), 점검 주기 업계 표준 3~5년.
 *
 * ⚠️ 카피 컴플라이언스:
 * - 계약이 많다고 나쁜 게 아니다 — "많을수록 합계를 모를 확률이 올라간다"는 프레임만.
 * - 특정 채널 비방 금지 — "지인이 나쁘다"가 아니라 "담당자가 바뀌어 점검이 끊긴다".
 * - 종합 서술은 단정 금지("~일 가능성이 높습니다" 추정 표현만), "무조건 해지" 뉘앙스 금지.
 */

export interface DiagnosisAnswers {
  contracts?: string;
  channel?: string;
  lastCheck?: string;
  premium?: string;
  income?: string;
  coverages?: string[];
  profile?: string;
}

export interface BreakdownItem {
  key: string;
  label: string;
  /** 상태 서술만 — 항목별 점수(숫자)는 노출하지 않는다(계산기처럼 보임) */
  value: string;
}

export interface DiagnosisResult {
  /** 0~100. [A] 제외 시 나머지 75점 만점을 100점 환산 */
  total: number;
  breakdown: BreakdownItem[];
  /** 응답 조합 기반 종합 서술 (추정 표현만) */
  narrative: string;
}

// 구간 중앙값 (만원) — 비율 판정용
const PREMIUM_MID: Record<string, number> = {
  "10만원 미만": 5,
  "10~30만원": 20,
  "30~50만원": 40,
  "50~100만원": 75,
  "100만원 이상": 120,
};
const INCOME_MID: Record<string, number> = {
  "300만원 미만": 250,
  "300~500만원": 400,
  "500~800만원": 650,
  "800만원 이상": 1000,
};

const CONTRACT_SCORE: Record<string, number> = {
  "1~2개": 20, "3~5개": 16, "6~9개": 10, "10개 이상": 6, "잘 모르겠다": 0,
};
const CHECK_SCORE: Record<string, number> = {
  "1년 이내": 15, "1~3년 전": 12, "3~5년 전": 8, "5년 이상": 3, "가입 후 한 번도 없음": 0,
};
const CHANNEL_SCORE: Record<string, number> = {
  "다이렉트·온라인": 10, "설계사 권유": 8, "지인·친척 소개": 5, "여러 곳이 섞임": 4, "기억나지 않음": 2,
};

const CONTRACT_STATUS: Record<string, string> = {
  "1~2개": "1~2개 — 파악하기 쉬운 구간",
  "3~5개": "3~5개 — 담보 합산 확인 권장",
  "6~9개": "6~9개 — 합계를 모르기 쉬운 구간",
  "10개 이상": "10개 이상 — 담보가 흩어져 있기 쉬운 구간",
  "잘 모르겠다": "개수를 모르십니다",
};
const CHECK_STATUS: Record<string, string> = {
  "1년 이내": "1년 이내 점검",
  "1~3년 전": "1~3년 전 — 권장 주기(3~5년) 안",
  "3~5년 전": "3~5년 전 — 점검 주기 도래",
  "5년 이상": "5년 이상 — 권장 주기 경과",
  "가입 후 한 번도 없음": "가입 후 한 번도",
};
const CHANNEL_STATUS: Record<string, string> = {
  "다이렉트·온라인": "직접 가입",
  "설계사 권유": "설계사 권유",
  "지인·친척 소개": "지인 소개",
  "여러 곳이 섞임": "여러 경로 혼재",
  "기억나지 않음": "기억나지 않음",
};

/** [B] 보장 공백 감점표 — [name, 감점] */
const GAP_DEDUCTIONS: [name: string, points: number][] = [
  ["실손의료비", 10],
  ["암 진단비", 7],
  ["뇌·심장 진단비", 6],
  ["수술비", 4],
  ["간병·치매", 3],
];

export function computeDiagnosis(a: DiagnosisAnswers): DiagnosisResult {
  const breakdown: BreakdownItem[] = [];

  // ── [A] 보험료 비율 25점 — ⭐양방향 감점 (과다도, 과소도 신호다)
  const pm = PREMIUM_MID[a.premium ?? ""];
  const im = INCOME_MID[a.income ?? ""];
  const ratio = pm != null && im != null ? pm / im : null; // '모르겠다/밝히고 싶지 않음' → null
  let scoreA: number | null = null;
  if (ratio != null) {
    const pct = Math.round(ratio * 100);
    let status: string;
    if (ratio >= 0.05 && ratio <= 0.1) { scoreA = 25; status = "적정"; }
    else if (ratio >= 0.03 && ratio < 0.05) { scoreA = 18; status = "다소 부족"; }
    else if (ratio > 0.1 && ratio <= 0.13) { scoreA = 15; status = "다소 과다"; }
    else if (ratio > 0.13) { scoreA = 8; status = "과다 구간"; }
    else { scoreA = 8; status = "공백 의심"; } // 3% 미만
    breakdown.push({
      key: "ratio",
      label: "보험료 비율",
      value: `소득의 ${pct}% (권장 5~10%) → ${status}`,
    });
  }

  // ── [B] 보장 공백 30점
  const cov = a.coverages ?? [];
  const unknownCov = cov.includes("하나도 없거나 모름");
  const isYoungSingle = a.profile === "2030 · 싱글";
  let scoreB: number;
  let missing: string[] = [];
  if (unknownCov) {
    scoreB = 0;
    breakdown.push({ key: "gaps", label: "보장 공백", value: "보유 보장을 모르십니다" });
  } else {
    missing = GAP_DEDUCTIONS.filter(
      ([name]) => !cov.includes(name) && !(name === "간병·치매" && isYoungSingle)
    ).map(([name]) => name);
    const deducted = GAP_DEDUCTIONS.filter(([name]) => missing.includes(name)).reduce(
      (sum, [, p]) => sum + p,
      0
    );
    scoreB = Math.max(0, 30 - deducted);
    breakdown.push({
      key: "gaps",
      label: "보장 공백",
      value: missing.length ? `${missing.join("·")} 없음` : "핵심 보장 확인됨",
    });
  }

  // ── [C] 계약 파악도 20점 / [D] 점검 이력 15점 / [E] 가입 경로 10점
  const scoreC = CONTRACT_SCORE[a.contracts ?? ""] ?? 0;
  const scoreD = CHECK_SCORE[a.lastCheck ?? ""] ?? 0;
  const scoreE = CHANNEL_SCORE[a.channel ?? ""] ?? 0;
  breakdown.push({
    key: "contracts",
    label: "계약 파악",
    value: CONTRACT_STATUS[a.contracts ?? ""] ?? "—",
  });
  breakdown.push({
    key: "check",
    label: "점검 이력",
    value: CHECK_STATUS[a.lastCheck ?? ""] ?? "—",
  });
  breakdown.push({
    key: "channel",
    label: "가입 경로",
    value: CHANNEL_STATUS[a.channel ?? ""] ?? "—",
  });

  // ── 총점 — [A] 제외 시 75점 만점 → 100점 환산 (이탈 방지: 소득 무응답 페널티 없음)
  const rest = scoreB + scoreC + scoreD + scoreE;
  const total =
    scoreA == null
      ? Math.max(0, Math.min(100, Math.round((rest * 100) / 75)))
      : Math.max(0, Math.min(100, scoreA + rest));

  return { total, breakdown, narrative: buildNarrative(a, ratio, missing, unknownCov) };
}

/** 신호 문장 — [연결형, 종결형] 쌍으로 두어 조합 시 어미가 깨지지 않게 한다 */
function buildNarrative(
  a: DiagnosisAnswers,
  ratio: number | null,
  missing: string[],
  unknownCov: boolean
): string {
  const pct = ratio != null ? Math.round(ratio * 100) : null;
  const signals: [link: string, end: string][] = [];

  if (a.contracts === "잘 모르겠다") {
    signals.push(["계약이 몇 개인지 모르시고", "계약이 몇 개인지 모르십니다"]);
  } else if (a.contracts === "6~9개" || a.contracts === "10개 이상") {
    signals.push([
      `계약이 ${a.contracts}로 흩어져 있고`,
      `계약이 ${a.contracts}로 흩어져 있습니다`,
    ]);
  }

  if (a.lastCheck === "가입 후 한 번도 없음") {
    signals.push(["가입 후 한 번도 보장을 확인한 적이 없으며", "가입 후 한 번도 보장을 확인한 적이 없습니다"]);
  } else if (a.lastCheck === "5년 이상") {
    signals.push(["마지막 확인이 5년 넘게 지났으며", "마지막 확인이 5년 넘게 지났습니다"]);
  }

  if (ratio != null && ratio > 0.1) {
    signals.push([`소득의 ${pct}%를 보험료로 내고 계시며`, `소득의 ${pct}%를 보험료로 내고 계십니다`]);
  } else if (ratio != null && ratio < 0.03) {
    signals.push([`보험료는 소득의 ${pct}%에 그치며`, `보험료는 소득의 ${pct}%에 그칩니다`]);
  }

  if (unknownCov) {
    signals.push(["어떤 보장을 갖고 계신지도 확실하지 않으며", "어떤 보장을 갖고 계신지도 확실하지 않습니다"]);
  } else if (missing.length >= 2) {
    signals.push([
      `${missing.slice(0, 2).join("·")} 등 ${missing.length}곳이 비어 있으며`,
      `${missing.slice(0, 2).join("·")} 등 ${missing.length}곳이 비어 있습니다`,
    ]);
  }

  // 결론 — 우선순위 분기 (⚠️ 전부 추정 표현. "무조건 해지" 뉘앙스 금지 — 점검·재설계 프레임)
  let conclusion: string;
  const opaque =
    a.contracts === "잘 모르겠다" ||
    a.contracts === "6~9개" ||
    a.contracts === "10개 이상" ||
    a.lastCheck === "5년 이상" ||
    a.lastCheck === "가입 후 한 번도 없음";
  if (ratio != null && ratio > 0.1 && opaque) {
    conclusion = "이 조건이 겹치면 중복·과설계가 발견되는 경우가 많습니다.";
  } else if (ratio != null && ratio < 0.03) {
    conclusion = "이 경우 실손·진단비 같은 핵심 보장이 비어 있을 가능성이 높습니다.";
  } else if (unknownCov || missing.length >= 2) {
    conclusion = "비슷한 조합에서 보장 공백이 확인되는 경우가 많습니다.";
  } else if (signals.length === 0) {
    return "기본기는 갖춰져 있습니다. 다만 담보 단위 합계는 증권을 전부 펼쳐 더해봐야 알 수 있습니다.";
  } else {
    conclusion = "지금 구조를 담보 단위로 한 번 펼쳐볼 시점입니다.";
  }

  const top = signals.slice(0, 3);
  const facts =
    top.length === 1
      ? top[0][1]
      : `${top.slice(0, -1).map(([link]) => link).join(" ")} ${top[top.length - 1][1]}`;
  return `${facts}. ${conclusion}`;
}
