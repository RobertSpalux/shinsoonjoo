/**
 * 어드민 ad-review 라우트가 어느 행을 갱신할지 정한다.
 *
 * - 본진·네이버·블로그스팟·인스타: (article_id, channel) 당 활성 행 1개(DB 고유 인덱스
 *   ad_reviews_active_uniq). 최신 행을 갱신하고, 없으면 새로 만든다.
 * - 스레드: 한 글에서 원글이 여러 개 나오므로 인덱스에서 빠져 있다(sql/004).
 *   「최신 행」을 갱신하면 다른 원글의 승인 행을 덮어쓴다 — 그래서 행 id 로만 갱신한다.
 *   접수(submit)는 id 가 없으면 새 행이다.
 */
export type AdReviewTarget =
  | { mode: "byId"; id: string }
  | { mode: "latest" }
  | { mode: "insert" }
  | { mode: "error"; error: string };

export function resolveAdReviewTarget(channel: string, action: string, reviewId?: string | null): AdReviewTarget {
  if (reviewId) return { mode: "byId", id: reviewId };
  if (channel !== "threads") return { mode: "latest" };
  if (action === "submit") return { mode: "insert" };
  return { mode: "error", error: "스레드는 행 id(reviewId)를 지정해야 합니다 — 한 글에 원글이 여러 개입니다" };
}
