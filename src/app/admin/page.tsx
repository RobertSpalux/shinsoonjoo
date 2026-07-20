import type { Metadata } from "next";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { checkBannedTerms, type CheckResult, type ComplianceAck } from "@/lib/compliance/banned-terms";
import AdminLogin from "@/components/admin/AdminLogin";
import AdminDashboard from "@/components/admin/AdminDashboard";

export const metadata: Metadata = {
  title: "관리자",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdminAuthed())) {
    return <AdminLogin />;
  }

  const supabase = createAdminClient();
  const [leads, consultations, articles, kinAnswers, adReviews, expiring] = await Promise.all([
    supabase
      .from("lead_consultings")
      .select("id, name, phone, quiz_responses, quiz_score, lead_source, status, memo, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("consultations")
      .select("id, name, phone, category, message, status, memo, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("premium_articles")
      .select(
        "id, title, naver_title, blogspot_title, slug, category, summary, tags, raw_source_url, raw_source_name, raw_source_fulltext, key_points, remodeling_bridge, main_website_markdown, is_main_published, is_naver_published, is_blogspot_published, is_instagram_published, is_threads_published, naver_blog_content, blogspot_content, instagram_caption, carousel_json, threads_json, faq_json, image_paths, naver_image_paths, view_count, published_at, created_at, content_type, seed_key, verify_claims, compliance_acks, needs_human_review"
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("kin_answers")
      .select(
        "id, question_url, question_title, question_body, answer_draft, linked_article_id, status, created_at, posted_at"
      )
      .order("created_at", { ascending: false })
      .limit(100),
    // 광고심의(§6.9) — 채널별 심의 상태. 최신순으로 받아 (article,channel)당 첫 행을 활성으로 본다.
    supabase
      .from("ad_reviews")
      .select(
        "id, article_id, channel, review_type, posting_title, ad_form, status, review_authority, review_no, review_from, review_to, posted_url, url_registered_at, submitted_at, reviewed_at, rejected_reason, notes"
      )
      .order("created_at", { ascending: false })
      .limit(500),
    // 만료 임박 대시보드 — 유효기간 60일 이내 승인 심의필(뷰가 days_left 계산).
    supabase
      .from("ad_reviews_expiring")
      .select("id, article_id, title, slug, channel, review_no, review_from, review_to, days_left, posted_url, url_registered_at"),
  ]);

  // 심의 프리뷰 토큰 — 서버에서만 읽어 인증된 관리자에게만 전달(NEXT_PUBLIC_ 아님, 번들 미노출).
  const previewToken = process.env.PREVIEW_SECRET ?? "";

  // §6.10 금지 표현 검사 — 서버에서 기사별 판정(심의 신청 전 게이트의 단일 기준).
  const articleRows = articles.data ?? [];
  const compliance: Record<string, CheckResult> = {};
  for (const a of articleRows) {
    const row = a as { id: string; compliance_acks?: ComplianceAck[] };
    compliance[row.id] = checkBannedTerms(a, row.compliance_acks ?? []);
  }

  return (
    <AdminDashboard
      leads={leads.data ?? []}
      consultations={consultations.data ?? []}
      articles={articleRows}
      kinAnswers={kinAnswers.data ?? []}
      adReviews={adReviews.data ?? []}
      expiring={expiring.data ?? []}
      previewToken={previewToken}
      compliance={compliance}
    />
  );
}
