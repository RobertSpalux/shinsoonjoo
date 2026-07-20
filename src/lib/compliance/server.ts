import { createAdminClient } from "@/lib/supabase-admin";
import { checkBannedTerms, type CheckableArticle, type CheckResult, type ComplianceAck } from "./banned-terms";

/**
 * 서버 전용 컴플라이언스 검사 — service-role로 전 필드를 읽어 §6.10 게이트를 판정한다.
 * /preview 라우트·compose API가 클라이언트 판정을 신뢰하지 않도록 서버에서 재검사한다.
 */

// 검사에 필요한 전 필드 + 확인 이력.
export const COMPLIANCE_COLUMNS =
  "id, title, naver_title, blogspot_title, summary, instagram_caption, main_website_markdown, naver_blog_content, blogspot_content, key_points, faq_json, threads_json, verify_claims, compliance_acks";

type Row = Record<string, unknown> & { compliance_acks?: ComplianceAck[] };

function check(row: Row | null): CheckResult | null {
  if (!row) return null;
  return checkBannedTerms(row as unknown as CheckableArticle, row.compliance_acks ?? []);
}

export async function checkArticleById(id: string): Promise<CheckResult | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("premium_articles")
    .select(COMPLIANCE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return check(data as Row | null);
}

export async function checkArticleBySlug(slug: string): Promise<CheckResult | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("premium_articles")
    .select(COMPLIANCE_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  return check(data as Row | null);
}
