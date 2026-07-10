import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";

/** 관리자 전용 상태 변경 — 허용된 테이블·컬럼만 수정 가능 */
const ALLOWED: Record<string, string[]> = {
  lead_consultings: ["status", "memo"],
  consultations: ["status"],
  premium_articles: [
    "is_main_published",
    "published_at", // 예약발행: 관리자가 고른 미래 시각
    "is_naver_published",
    "is_blogspot_published",
    "is_instagram_published",
  ],
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
    return NextResponse.json({ error: "수정 실패" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
