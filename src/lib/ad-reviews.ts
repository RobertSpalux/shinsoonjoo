import { createAdminClient } from "./supabase-admin";
import type { ReviewInfo } from "./brand";

/**
 * 채널의 승인·유효 심의필 1건 → ReviewInfo(날짜 YYYY.MM.DD). 없으면 null. (§6.3)
 *
 * ⚠️ 서버 전용. ad_reviews는 RLS로 anon 읽기가 막혀 있어 service-role로 조회한다.
 * 조건: status='approved' AND review_no IS NOT NULL AND review_to >= 오늘. 최신 review_to 1건.
 * (has_valid_review와 같은 판정 — 게이트가 허용하는 것과 화면 표기를 일치시킨다.)
 */
export async function getApprovedReview(
  articleId: string,
  channel: string = "main"
): Promise<ReviewInfo | null> {
  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (current_date 대응)

  const { data, error } = await supabase
    .from("ad_reviews")
    .select("review_authority, review_no, review_from, review_to")
    .eq("article_id", articleId)
    .eq("channel", channel)
    .eq("status", "approved")
    .not("review_no", "is", null)
    .gte("review_to", today)
    .order("review_to", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data || !data.review_no) return null;
  return {
    authority: data.review_authority ?? "프라임에셋",
    no: data.review_no,
    from: (data.review_from ?? "").replaceAll("-", "."),
    to: (data.review_to ?? "").replaceAll("-", "."),
  };
}
