/**
 * verify_claims 근거에 원문 쪽수가 적혀 있는가 — 「근거 대조 완료 — 전체 확인」의 전제 조건.
 *
 * B등급(통계치·문맥 의존 표현)을 한꺼번에 확인 처리하려면, 각 주장이 원문 몇 쪽에서
 * 왔는지 먼저 적혀 있어야 한다. 쪽수 없는 일괄 확인은 확인이 아니다.
 * 서버(API)와 클라이언트(버튼 활성)가 이 함수 하나를 쓴다.
 */

type Claim = { claim?: string | null; basis?: string | null } | null | undefined;

/** 「71쪽」 「71·126쪽」 「p.71」 「p71」 형태를 쪽수로 인정한다. */
const PAGE_RE = /\d+\s*쪽|\bp\.?\s*\d+/i;

export function hasPageRef(basis: string | null | undefined): boolean {
  return typeof basis === "string" && PAGE_RE.test(basis);
}

/** 항목이 1개 이상이고, 전 항목의 basis 에 쪽수가 있을 때만 true. */
export function allClaimsHavePages(verifyClaims: unknown): boolean {
  if (!Array.isArray(verifyClaims) || verifyClaims.length === 0) return false;
  return (verifyClaims as Claim[]).every((c) => !!c && hasPageRef(c.basis));
}

/** 쪽수가 빠진 항목 수(버튼 옆 안내용). */
export function claimsMissingPages(verifyClaims: unknown): number {
  if (!Array.isArray(verifyClaims)) return 0;
  return (verifyClaims as Claim[]).filter((c) => !c || !hasPageRef(c.basis)).length;
}
