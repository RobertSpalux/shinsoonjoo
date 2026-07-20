import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";

/** 관리자 전용 상태 변경 — 허용된 테이블·컬럼만 수정 가능 */
const ALLOWED: Record<string, string[]> = {
  lead_consultings: ["status", "memo"],
  consultations: ["status", "memo"],
  premium_articles: [
    "is_main_published",
    "published_at", // 예약발행: 관리자가 고른 미래 시각
    "is_naver_published",
    "is_blogspot_published",
    "is_instagram_published",
    "needs_human_review", // 상록수 발행 게이트(M4-1): 발행 = 사람 검수 완료의 기록
  ],
  // 지식iN 어시스트(커밋 P2) — 상태 전환 + 게시 시각. 게시 자체는 100% 수동.
  kin_answers: ["status", "posted_at", "answer_draft"],
};

export async function POST(request: Request) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { table, id, fields } = await request.json().catch(() => ({}));
  const allowedCols = ALLOWED[table];
  if (!allowedCols || !id || !fields || typeof fields !== "object") {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (allowedCols.includes(k)) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "수정 가능한 필드가 없습니다." }, { status: 400 });
  }

  // 발행을 켤 때 published_at이 지정되지 않았으면 지금 시각으로 기록.
  // (예약발행이면 관리자가 보낸 미래 published_at을 그대로 유지 → 그 시각까지 노출 게이트가 숨김)
  if (table === "premium_articles" && patch.is_main_published === true && !patch.published_at) {
    patch.published_at = new Date().toISOString();
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from(table).update(patch).eq("id", id);
  if (error) {
    console.error("admin update error:", error);
    // 발행 게이트 트리거(enforce_publish_gate) 예외를 사용자 문구로 변환.
    // raw 메시지("[금소법] … CLAUDE.md §6.9")를 그대로 노출하지 않는다. (§6 컴플라이언스)
    const gateHit = error.code === "23514" || /\[금소법\]/.test(error.message ?? "");
    if (gateHit) {
      return NextResponse.json(
        { error: "유효한 광고심의필이 없어 발행할 수 없습니다" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "수정 실패" }, { status: 500 });
  }

  // 발행 상태 변경은 정적 캐시에 즉시 반영 — 발행 후 상세 404(빌드 시점 초안이라 미생성)·
  // 초안 회수 후 잔존 노출 방지. 실패해도 저장은 성공이므로 응답은 성공 유지.
  if (table === "premium_articles" && ("is_main_published" in patch || "published_at" in patch)) {
    try {
      const { data: row } = await supabase
        .from("premium_articles")
        .select("slug")
        .eq("id", id)
        .maybeSingle();
      revalidatePath("/");
      revalidatePath("/news");
      revalidatePath("/sitemap.xml");
      if (row?.slug) revalidatePath(`/news/${row.slug}`);
    } catch (e) {
      console.warn("revalidate 실패(저장은 완료):", e);
    }
  }

  return NextResponse.json({ success: true });
}
