/**
 * verify_claims 근거에 원문 위치(쪽수 또는 법령 조문)가 적혀 있는가 — 「근거 대조 완료 — 전체 확인」의 전제 조건.
 *
 * B등급(통계치·문맥 의존 표현)을 한꺼번에 확인 처리하려면, 각 주장이 원문 어디에서
 * 왔는지 먼저 적혀 있어야 한다. 위치 없는 일괄 확인은 확인이 아니다.
 * 법령 조문은 쪽수가 없는 게 정상이므로 「제N조」(선택적으로 항·호)를 위치로 인정한다.
 * 서버(API)와 클라이언트(버튼 활성)가 이 함수 하나를 쓴다.
 */

type Claim = { claim?: string | null; basis?: string | null } | null | undefined;

/** 「71쪽」 「71·126쪽」 「p.71」 「p71」 형태를 쪽수로 인정한다. */
const PAGE_RE = /\d+\s*쪽|\bp\.?\s*\d+/i;

/** 「제16조」 「제16조의2」 「제16조 제1항 제9호」 형태를 법령 조문으로 인정한다. 항·호만 단독으로는 불인정. */
const ARTICLE_RE = /제\s*\d+\s*조/;

export function hasPageRef(basis: string | null | undefined): boolean {
  return typeof basis === "string" && (PAGE_RE.test(basis) || ARTICLE_RE.test(basis));
}

/** 항목이 1개 이상이고, 전 항목의 basis 에 위치(쪽수·조문)가 있을 때만 true. */
export function allClaimsHavePages(verifyClaims: unknown): boolean {
  if (!Array.isArray(verifyClaims) || verifyClaims.length === 0) return false;
  return (verifyClaims as Claim[]).every((c) => !!c && hasPageRef(c.basis));
}

/** 위치(쪽수·조문)가 빠진 항목 수(버튼 옆 안내용). */
export function claimsMissingPages(verifyClaims: unknown): number {
  if (!Array.isArray(verifyClaims)) return 0;
  return (verifyClaims as Claim[]).filter((c) => !c || !hasPageRef(c.basis)).length;
}
