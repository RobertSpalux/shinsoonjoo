import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * 관리자 전용 삭제 — 허용 테이블만.
 * premium_articles는 Storage의 카드 이미지(card-news/{slug}/*)도 함께 정리하고
 * 정적 캐시를 재검증한다(발행돼 있던 글의 잔존 노출 방지).
 */
const ALLOWED_TABLES = ["premium_articles", "lead_consultings"] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

export async function POST(request: Request) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { table, id } = await request.json().catch(() => ({}));
  if (!ALLOWED_TABLES.includes(table as AllowedTable) || !id) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const supabase = createAdminClient();

  let slug: string | null = null;
  if (table === "premium_articles") {
    const { data: row } = await supabase
      .from("premium_articles")
      .select("slug")
      .eq("id", id)
      .maybeSingle();
    slug = row?.slug ?? null;
  }

  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) {
    console.error("admin delete error:", error);
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }

  if (table === "premium_articles" && slug) {
    // Storage 카드 이미지 정리 (실패해도 행 삭제는 완료 — 로그만)
    try {
      const { data: files } = await supabase.storage.from("card-news").list(slug);
      if (files?.length) {
        await supabase.storage.from("card-news").remove(files.map((f) => `${slug}/${f.name}`));
      }
    } catch (e) {
      console.warn("card-news storage 정리 실패:", e);
    }
    try {
      revalidatePath("/");
      revalidatePath("/news");
      revalidatePath("/sitemap.xml");
      revalidatePath(`/news/${slug}`);
    } catch (e) {
      console.warn("revalidate 실패(삭제는 완료):", e);
    }
  }

  return NextResponse.json({ success: true });
}
