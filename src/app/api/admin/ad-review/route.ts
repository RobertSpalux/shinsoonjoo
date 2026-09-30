import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { normalizeReviewNo, REVIEW_NO_FORMAT_ERROR } from "@/lib/review-no";
import { resolveAdReviewTarget } from "@/lib/ad-review-target";

/**
 * 광고심의(ad_reviews) 관리 — 채널(광고물) 단위 상태 전환. (CLAUDE.md §6.9)
 * 발행 자체는 /api/admin/update가 담당하고, 여기서는 심의 라이프사이클만 다룬다.
 * 본진·네이버 등은 (article_id, channel)당 활성 행 1개(DB 고유 인덱스 ad_reviews_active_uniq)라
 * 최신 행을 upsert한다. 스레드는 한 글에 원글이 여러 개라 인덱스에서 빠져 있고, 행 id(reviewId)로만
 * 갱신한다 — 최신 행을 고르면 다른 원글의 승인 행을 덮어쓴다(resolveAdReviewTarget).
 */

const CHANNELS = ["main", "naver", "blogspot", "instagram", "threads"];
const AD_FORMS = ["홈페이지", "바이럴(블로그 등)", "인스타(영상제외)", "스레드"];
const REVIEW_TYPES = ["general", "jisikin", "cafe", "threads"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Action = "submit" | "approve" | "reject" | "register-url" | "record-posted-url";

export async function POST(request: Request) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { action, articleId, channel, reviewId } = body as {
    action?: Action;
    articleId?: string;
    channel?: string;
    reviewId?: string;
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
    // 번호만 저장한다 — 「프라임에셋 심의필 제…호」는 렌더러가 붙인다(이중 표기 방지).
    const no = normalizeReviewNo(reviewNo);
    if (!no) {
      return NextResponse.json(
        { error: `${REVIEW_NO_FORMAT_ERROR} (입력값: ${reviewNo})` },
        { status: 400 }
      );
    }
    patch = {
      status: "approved",
      reviewed_at: now,
      review_no: no,
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
  } else if (action === "record-posted-url") {
    // 게시 URL만 기록한다(scripts/publish_approved.py). url_registered_at 은 비워 둔다 —
    // robert-os 감시기가 「approved + posted_url 있음 + url_registered_at 없음」을 보고 PAMS 게시위치(＋)를
    // 등록한 뒤 채운다. register-url 처럼 여기서 채우면 감시기가 이미 등록된 줄 알고 건너뛴다.
    const { postedUrl } = body as Record<string, string>;
    if (!postedUrl || !/^https:\/\/\S+$/.test(postedUrl)) {
      return NextResponse.json({ error: "게시 URL(https)을 입력하세요" }, { status: 400 });
    }
    patch = { posted_url: postedUrl };
  } else {
    return NextResponse.json({ error: "알 수 없는 action" }, { status: 400 });
  }

  const target = resolveAdReviewTarget(channel, action, reviewId);
  if (target.mode === "error") {
    return NextResponse.json({ error: target.error }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 갱신할 행 — id 지정이면 그 행, 아니면 (article_id, channel) 최신 행. 없으면 insert.
  let existingId: string | null = null;
  if (target.mode === "byId") {
    existingId = target.id;
  } else if (target.mode === "latest") {
    const { data: existing } = await supabase
      .from("ad_reviews")
      .select("id")
      .eq("article_id", articleId)
      .eq("channel", channel)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    existingId = existing?.id ?? null;
  }

  let row;
  if (existingId) {
    // 글·채널까지 맞아야 갱신한다 — 다른 글의 행 id 로 덮어쓰지 않게.
    const { data, error } = await supabase
      .from("ad_reviews")
      .update(patch)
      .eq("id", existingId)
      .eq("article_id", articleId)
      .eq("channel", channel)
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
