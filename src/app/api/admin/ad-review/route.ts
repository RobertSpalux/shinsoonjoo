import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * 광고심의(ad_reviews) 관리 — 채널(광고물) 단위 상태 전환. (CLAUDE.md §6.9)
 * 발행 자체는 /api/admin/update가 담당하고, 여기서는 심의 라이프사이클만 다룬다.
 * (article_id, channel)당 활성 행 1개를 가정하고 최신 행을 upsert한다(고유제약 없음).
 */

const CHANNELS = ["main", "naver", "blogspot", "instagram", "threads"];
const AD_FORMS = ["홈페이지", "바이럴(블로그 등)", "인스타(영상제외)", "스레드"];
const REVIEW_TYPES = ["general", "jisikin", "cafe", "threads"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Action = "submit" | "approve" | "reject" | "register-url";

export async function POST(request: Request) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { action, articleId, channel } = body as {
    action?: Action;
    articleId?: string;
    channel?: string;
  };

  if (!articleId || !channel || !CHANNELS.includes(channel)) {
    return NextResponse.json({ error: "잘못된 요청(채널)" }, { status: 400 });
  }

  // 액션별 patch 구성 — 허용 필드만.
  const now = new Date().toISOString();
  let patch: Record<string, unknown>;

  if (action === "submit") {
    const { postingTitle, adForm, reviewType, notes } = body as Record<string, string>;
    if (adForm && !AD_FORMS.includes(adForm)) {
      return NextResponse.json({ error: "잘못된 광고형태" }, { status: 400 });
    }
    if (reviewType && !REVIEW_TYPES.includes(reviewType)) {
      return NextResponse.json({ error: "잘못된 심의유형" }, { status: 400 });
    }
    patch = {
      status: "submitted",
      submitted_at: now,
      posting_title: postingTitle ?? null,
      ad_form: adForm ?? null,
      review_type: reviewType || "general",
      notes: notes ?? null,
      // 재신청(반려 후) 시 이전 반려 사유를 지운다.
      rejected_reason: null,
    };
  } else if (action === "approve") {
    const { reviewNo, reviewFrom, reviewTo, reviewAuthority } = body as Record<string, string>;
    if (!reviewNo || !reviewFrom || !reviewTo) {
      return NextResponse.json({ error: "심의필번호·유효기간을 입력하세요" }, { status: 400 });
    }
    if (!DATE_RE.test(reviewFrom) || !DATE_RE.test(reviewTo)) {
      return NextResponse.json({ error: "날짜 형식 오류(YYYY-MM-DD)" }, { status: 400 });
    }
    patch = {
      status: "approved",
      reviewed_at: now,
      review_no: reviewNo,
      review_from: reviewFrom,
      review_to: reviewTo,
      review_authority: reviewAuthority || "프라임에셋",
    };
  } else if (action === "reject") {
    const { rejectedReason } = body as Record<string, string>;
    patch = {
      status: "rejected",
      reviewed_at: now,
      rejected_reason: rejectedReason ?? null,
    };
  } else if (action === "register-url") {
    const { postedUrl } = body as Record<string, string>;
    if (!postedUrl) {
      return NextResponse.json({ error: "게시 URL을 입력하세요" }, { status: 400 });
    }
    patch = { posted_url: postedUrl, url_registered_at: now };
  } else {
    return NextResponse.json({ error: "알 수 없는 action" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // (article_id, channel) 최신 행 조회 → 있으면 update, 없으면 insert.
  const { data: existing } = await supabase
    .from("ad_reviews")
    .select("id")
    .eq("article_id", articleId)
    .eq("channel", channel)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let row;
  if (existing?.id) {
    const { data, error } = await supabase
      .from("ad_reviews")
      .update(patch)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) {
      console.error("ad-review update error:", error);
      return NextResponse.json({ error: "저장 실패" }, { status: 500 });
    }
    row = data;
  } else {
    const { data, error } = await supabase
      .from("ad_reviews")
      .insert({ article_id: articleId, channel, ...patch })
      .select()
      .single();
    if (error) {
      console.error("ad-review insert error:", error);
      return NextResponse.json({ error: "저장 실패" }, { status: 500 });
    }
    row = data;
  }

  return NextResponse.json({ success: true, review: row });
}
