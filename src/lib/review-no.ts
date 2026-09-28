/**
 * 심의필 번호 정규화 — `ad_reviews.review_no`·`SITE_REVIEW.no`의 단일 형식 규칙. (§6.9)
 *
 * 저장값은 **번호만**(`2026-09-7095`)이다. 렌더러가 "프라임에셋 심의필 제…호"를 붙인다.
 * 전체 문구가 저장되면 「제프라임에셋 심의필 제…호호」로 이중 렌더된다(실측 사고: 2026-07 1건,
 * 2026-09 4건 — 6710·6802·6803·7095).
 *
 * 입력(어드민 API)과 표시(renderMandatoryNotice) 양쪽이 이 함수 하나를 쓴다.
 */

/** YYYY-MM-NNNN. 월별 일련번호가 9,000번대까지 실측돼 5자리도 허용한다. */
export const REVIEW_NO_RE = /^\d{4}-(0[1-9]|1[0-2])-\d{4,5}$/;

/**
 * 붙여넣은 값에서 번호만 뽑는다. 형식이 맞지 않으면 null.
 * 벗기는 것: 공백 전체 · 앞의 「…심의필」 · 「제」 · 뒤의 「호」 · 뒤따르는 「(기간)」.
 */
export function normalizeReviewNo(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.replace(/\s+/g, "");
  s = s.replace(/\(.*\)$/, ""); // 뒤따르는 유효기간 괄호
  const at = s.lastIndexOf("심의필");
  if (at >= 0) s = s.slice(at + "심의필".length); // 「프라임에셋 심의필」 등 접두
  s = s.replace(/^제/, "").replace(/호$/, "");
  return REVIEW_NO_RE.test(s) ? s : null;
}

/** 입력 거절 사유(사람이 읽는 문장). */
export const REVIEW_NO_FORMAT_ERROR =
  "심의필 번호는 번호만 입력합니다(예: 2026-09-7095). 「프라임에셋 심의필 제…호」는 화면이 자동으로 붙입니다.";
