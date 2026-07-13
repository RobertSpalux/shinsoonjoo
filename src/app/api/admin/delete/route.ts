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

  const { table, id, blockSource } = await request.json().catch(() => ({}));
  if (!ALLOWED_TABLES.includes(table as AllowedTable) || !id) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const supabase = createAdminClient();

  let slug: string | null = null;
  let rawSourceUrl: string | null = null;
  if (table === "premium_articles") {
    const { data: row } = await supabase
      .from("premium_articles")
      .select("slug, raw_source_url")
      .eq("id", id)
      .maybeSingle();
    slug = row?.slug ?? null;
    rawSourceUrl = row?.raw_source_url ?? null;
  }

  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) {
    console.error("admin delete error:", error);
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }

  // 소스 차단 (커밋 O1) — raw_source_url 대조 dedup은 행 삭제 시 같은 소스로 재생성되는
  // 버그가 있어, 삭제와 함께 blocked_sources에 등록해 영구 차단한다.
  if (table === "premium_articles" && blockSource === true && rawSourceUrl) {
    const { error: blockErr } = await supabase
      .from("blocked_sources")
      .upsert({ url: rawSourceUrl, reason: "수동차단" }, { onConflict: "url" });
    if (blockErr) console.error("blocked_sources 등록 실패(삭제는 완료):", blockErr);
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
