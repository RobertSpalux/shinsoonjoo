/**
 * 근거 검증 게이트 — verify_claims의 basis에서 발표연도·증빙 가능성을 검사한다.
 * (CLAUDE.md §6.10 "귀속 문장 = 증빙 의무" / "인용 보도는 증빙 아님", 2026-07-23 B2 실증)
 *
 * ⚠️ 재생성 트리거로 쓰지 않는다 — 근거는 재생성한다고 새 자료가 나오지 않는다.
 *    violation이 있으면 needs_human_review=true로 사람에게 넘긴다(컷 아님).
 * 순수 함수(DB 의존 없음). style-gate와 동일 지점(route.ts)에서 병합 결과에 대해 실행한다.
 *
 * 판정(claim별 독립, 코드가 겹칠 수 있음):
 *  - no_year   : basis에서 연도를 못 찾음 (violation)
 *  - stale     : 발표 후 STALE_YEARS년 이상 경과 + 항구성 키워드 없음 (violation)
 *  - stale_but_durable : 오래됐지만 법령·약관 등 항구성 자료 (notice, 위반 아님)
 *  - not_primary : basis에 '인용 보도' 등 증빙 불가 표기 (violation)
 */

/** 발표 후 이 연수 '이상' 경과하면 stale. (§6.10 "기본 2년 내 자료" — 2년 이상 된 자료는 대체 사유 필요) */
export const STALE_YEARS = 2;

/**
 * 항구성 키워드 — 오래돼도 유효한 자료(법령·약관). stale을 notice로 강등한다.
 * ⚠️ 단일 글자("법", "제도")는 방법·법인·판매방법·제도권 등에 과대매칭 → under-flag(놓침)을 만든다.
 *    게이트는 넓게 잡고 사람이 판단하는 쪽이 안전하므로 구체 완전용어만 둔다.
 *    ("표준사업방법서"는 '방법'을 포함하나 완전용어라 유지 — 부분 매칭이 아니라 그 용어 자체다.)
 */
export const DURABLE_KEYWORDS = [
  "법률",
  "법령",
  "보험업법",
  "상법",
  "금융소비자보호법",
  "민법",
  "시행령",
  "시행세칙",
  "감독규정",
  "표준사업방법서",
  "표준약관",
  "약관",
  "조문",
  "별표",
  "고시",
] as const;

/** 증빙 불가 표기 — basis에 포함되면 원문 증빙이 아니라는 신호(not_primary). */
export const NON_PRIMARY_MARKERS = [
  "인용 보도",
  "원문 확인 권장",
  "원문 보도자료 직접 확인",
  "복수 매체",
  "실무 통용",
  "업계 통용",
] as const;

export type EvidenceCode = "no_year" | "stale" | "not_primary" | "stale_but_durable";
export type EvidenceLevel = "violation" | "notice";

export interface EvidenceIssue {
  claim: string;
  basis: string;
  year: number | null;
  ageYears: number | null;
  level: EvidenceLevel;
  code: EvidenceCode;
}

/** 검사 대상(느슨한 형태 — DB 행/병합 결과 모두 수용). */
export interface EvidenceCheckable {
  verify_claims?: ({ claim?: string; basis?: string; confidence?: string } | null)[] | null;
}

/** basis에서 연도 추출 — 4자리(19xx~20xx) + 어포스트로피 2자리('24년 형태). */
function extractYears(basis: string): number[] {
  const years: number[] = [];
  for (const m of basis.matchAll(/(?:19|20)\d{2}/g)) years.push(parseInt(m[0], 10));
  // '24년 / ’25년 — 어포스트로피가 있어야만 2자리를 연도로 본다('10년' 같은 기간 오탐 방지)
  for (const m of basis.matchAll(/['’‘`]\s?(\d{2})\s?년/g)) years.push(2000 + parseInt(m[1], 10));
  return years;
}

/**
 * basis 한 건의 판정. 여러 코드가 동시에 나올 수 있다(예: not_primary + no_year).
 * @param currentYear 기준연도(테스트에서 고정값 주입). 기본값은 실행 시점 연도.
 */
export function classifyBasis(
  basis: string,
  currentYear: number = new Date().getFullYear()
): { code: EvidenceCode; level: EvidenceLevel; year: number | null; ageYears: number | null }[] {
  const out: { code: EvidenceCode; level: EvidenceLevel; year: number | null; ageYears: number | null }[] = [];
  const text = basis ?? "";

  // c) 증빙 불가 표기 → not_primary
  if (NON_PRIMARY_MARKERS.some((m) => text.includes(m))) {
    out.push({ code: "not_primary", level: "violation", year: null, ageYears: null });
  }

  // a·b) 연도 추출 → no_year / stale / stale_but_durable
  const years = extractYears(text);
  if (years.length === 0) {
    out.push({ code: "no_year", level: "violation", year: null, ageYears: null });
  } else {
    const year = Math.max(...years);
    const ageYears = currentYear - year;
    if (ageYears >= STALE_YEARS) {
      const durable = DURABLE_KEYWORDS.some((k) => text.includes(k));
      out.push({
        code: durable ? "stale_but_durable" : "stale",
        level: durable ? "notice" : "violation",
        year,
        ageYears,
      });
    }
  }
  return out;
}

/** verify_claims 전체 스캔 → 이슈 목록(위반 + 관측). */
export function scanEvidence(
  a: EvidenceCheckable,
  currentYear: number = new Date().getFullYear()
): EvidenceIssue[] {
  const out: EvidenceIssue[] = [];
  const claims = Array.isArray(a.verify_claims) ? a.verify_claims : [];
  for (const c of claims) {
    if (!c) continue;
    const claim = c.claim ?? "";
    const basis = c.basis ?? "";
    for (const r of classifyBasis(basis, currentYear)) {
      out.push({ claim, basis, year: r.year, ageYears: r.ageYears, level: r.level, code: r.code });
    }
  }
  return out;
}

/** code별 건수 요약 — "no_year 2 · stale 1". */
export function summarizeEvidence(issues: EvidenceIssue[]): string {
  const counts: Record<string, number> = {};
  for (const i of issues) counts[i.code] = (counts[i.code] ?? 0) + 1;
  return Object.entries(counts)
    .map(([c, n]) => `${c} ${n}`)
    .join(" · ");
}
