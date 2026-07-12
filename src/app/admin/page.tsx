import type { Metadata } from "next";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";
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
  const [leads, consultations, articles] = await Promise.all([
    supabase
      .from("lead_consultings")
      .select("id, name, phone, quiz_responses, quiz_score, lead_source, status, memo, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("consultations")
      .select("id, name, phone, category, message, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("premium_articles")
      .select(
        "id, title, slug, category, summary, key_points, remodeling_bridge, main_website_markdown, is_main_published, is_naver_published, is_blogspot_published, is_instagram_published, naver_blog_content, blogspot_content, instagram_caption, carousel_json, image_paths, view_count, published_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <AdminDashboard
      leads={leads.data ?? []}
      consultations={consultations.data ?? []}
      articles={articles.data ?? []}
    />
  );
}
