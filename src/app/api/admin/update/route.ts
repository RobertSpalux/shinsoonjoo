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

/**
 * 발행 플래그 → ad_reviews 채널키. DB 함수 has_valid_review와 동일한 채널 매핑.
 * (앱단 심의 가드용 — DB 트리거 trg_publish_gate와 이중 방어. §6.9)
 */
const PUBLISH_FLAG_CHANNELS: Record<string, string> = {
  is_main_published: "main",
  is_naver_published: "naver",
  is_blogspot_published: "blogspot",
  is_instagram_published: "instagram",
  is_threads_published: "threads",
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

  // 앱단 심의 가드 (§6.9) — 발행 플래그를 false→true로 켜는 요청은 채널별 유효 심의필을 먼저 확인한다.
  // DB 트리거 trg_publish_gate(BEFORE INSERT OR UPDATE)와 이중 방어 — 트리거가 드롭·비활성돼도 앱이 막는다.
  // 검증 조건은 DB 함수 has_valid_review와 동일: approved + review_no 비어있지 않음 + 오늘 ∈ [from, to].
  if (table === "premium_articles") {
    const turningOn = Object.keys(patch).filter(
      (k) => k in PUBLISH_FLAG_CHANNELS && patch[k] === true
    );
    if (turningOn.length > 0) {
      // 트리거와 동일하게 false→true 전환만 검사한다(이미 켜진 채널 재저장은 트리거도 검사 안 함).
      const { data: current } = await supabase
        .from("premium_articles")
        .select(
          "is_main_published, is_naver_published, is_blogspot_published, is_instagram_published, is_threads_published"
        )
        .eq("id", id)
        .maybeSingle();
      const flags = (current ?? {}) as Record<string, unknown>;
      const today = new Date().toISOString().slice(0, 10); // UTC = Postgres current_date
      for (const flag of turningOn) {
        const wasOn = flags[flag] === true;
        if (wasOn) continue; // 이미 켜져 있던 채널(true→true)은 트리거도 검사하지 않음
        const channel = PUBLISH_FLAG_CHANNELS[flag];
        const { data: review } = await supabase
          .from("ad_reviews")
          .select("id")
          .eq("article_id", id)
          .eq("channel", channel)
          .eq("status", "approved")
          .not("review_no", "is", null)
          .neq("review_no", "")
          .not("review_from", "is", null)
          .not("review_to", "is", null)
          .lte("review_from", today)
          .gte("review_to", today)
          .limit(1)
          .maybeSingle();
        if (!review) {
          // DB 에러 변환(23514)과 동일 문구·상태로 통일 — 사용자가 트리거/앱 차단을 구분할 필요 없게.
          return NextResponse.json(
            { error: "유효한 광고심의필이 없어 발행할 수 없습니다" },
            { status: 409 }
          );
        }
      }
    }
  }

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
