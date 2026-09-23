import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { checkArticleById } from "@/lib/compliance/server";
import { toNaverText, toBlogspotHtml } from "@/lib/osmu-format";
import { naverComposeHash } from "@/lib/naver-compose-hash";
import type { ReviewInfo } from "@/lib/brand";

/**
 * 채널 원고 조립(서버) — **네이버·블로그스팟 복사의 유일한 경로**.
 *
 * ⚠️ 클라이언트 버튼만 막으면 우회되므로, 서버에서 §6.10 게이트를 다시 건다.
 *    level !== 'clean' 이면 409로 거절(원고를 내주지 않는다).
 *
 * [2026-09-22] 게시용(mode='publish')도 여기로 옮겼다.
 *   종전에는 게시용만 클라이언트에서 toNaverText 를 직접 불렀다. 그 경로로는
 *   **조립을 거쳤는지 아무도 알 수 없다** — 버튼을 고쳐도 다음 사람이 다시 raw 원고를
 *   복사하면 개인의견 귀속 문구와 필수안내사항이 빠진다(초안2 실제 사고).
 *   이제 조립이 한 곳이므로, 조립할 때마다 **재료 해시와 시각을 남겨** preflight 가
 *   "지금 원고가 마지막 조립 때와 같은가"를 정확히 대조한다.
 */

/** 승인돼 있고 오늘 유효한 심의필만 게시용 조립에 쓴다. */
function validReview(
  rows: Array<Record<string, unknown>>,
  channel: string
): ReviewInfo | null {
  const today = new Date().toISOString().slice(0, 10);
  const r = rows.find(
    (x) =>
      x.channel === channel &&
      x.status === "approved" &&
      typeof x.review_no === "string" &&
      x.review_no &&
      (!x.review_to || String(x.review_to) >= today) &&
      (!x.review_from || String(x.review_from) <= today)
  );
  if (!r) return null;
  return {
    authority: (r.review_authority as string) ?? "프라임에셋",
    no: (r.review_no as string) ?? "",
    from: String(r.review_from ?? "").replaceAll("-", "."),
    to: String(r.review_to ?? "").replaceAll("-", "."),
  };
}

export async function POST(request: Request) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { articleId, channel, mode } = body as {
    articleId?: string;
    channel?: string;
    mode?: "submission" | "publish";
  };
  if (!articleId || (channel !== "naver" && channel !== "blogspot")) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const composeMode: "submission" | "publish" = mode === "publish" ? "publish" : "submission";

  // 서버 컴플라이언스 게이트.
  const result = await checkArticleById(articleId);
  if (!result || result.level !== "clean") {
    const n = result?.findings.filter((f) => f.grade === "A" || !f.acked).length ?? 0;
    return NextResponse.json(
      { error: `컴플라이언스 검사 미통과 — ${n}건 확인 필요`, level: result?.level ?? "block" },
      { status: 409 }
    );
  }

  const supabase = createAdminClient();
  const { data: a } = await supabase
    .from("premium_articles")
    .select(
      "id, title, naver_title, blogspot_title, slug, tags, naver_blog_content, blogspot_content"
    )
    .eq("id", articleId)
    .maybeSingle();
  if (!a) return NextResponse.json({ error: "기사를 찾을 수 없습니다" }, { status: 404 });

  // 심의필은 따로 읽는다 — select 안에 관계를 끼우면 타입 추론이 무너진다.
  const { data: reviewRows } = await supabase
    .from("ad_reviews")
    .select("channel, status, review_no, review_authority, review_from, review_to")
    .eq("article_id", articleId);
  const reviews = (reviewRows ?? []) as unknown as Array<Record<string, unknown>>;
  const review = composeMode === "publish" ? validReview(reviews, channel) : null;

  // 게시용인데 승인 심의필이 없으면 내주지 않는다 — 필수안내사항이 빠진 채 게시된다.
  if (composeMode === "publish" && !review) {
    return NextResponse.json(
      { error: "승인된 심의필이 없습니다 — 게시용 원고를 내줄 수 없습니다" },
      { status: 409 }
    );
  }

  if (channel === "blogspot") {
    if (!a.blogspot_content) {
      return NextResponse.json({ error: "블로그스팟 원고 없음" }, { status: 400 });
    }
    const html = toBlogspotHtml(a.blogspot_content, a.slug, a.tags, {
      articleTitle: a.title,
      review,
      mode: composeMode,
    });
    return NextResponse.json({
      success: true,
      title: a.blogspot_title ?? a.title,
      text: html,
    });
  }

  if (!a.naver_blog_content) {
    return NextResponse.json({ error: "네이버 원고 없음" }, { status: 400 });
  }
  // 제목은 본문과 **따로** 돌려준다 — 네이버는 제목 칸과 본문 칸이 다르다.
  const text = toNaverText(a.naver_blog_content, {
    articleTitle: a.title,
    slug: a.slug,
    tags: a.tags,
    review,
    mode: composeMode,
  });

  // 조립 기록 — preflight 「네이버 osmu」 완전 대조의 근거.
  //   기록에 실패해도 원고는 내준다(복사가 본업이다). 대신 응답으로 알려 사람이 안다.
  const hash = naverComposeHash({
    naver_blog_content: a.naver_blog_content,
    title: a.title,
    naver_title: a.naver_title,
    slug: a.slug,
    tags: a.tags,
  });
  const { error: markErr } = await supabase
    .from("premium_articles")
    .update({ naver_composed_at: new Date().toISOString(), naver_composed_hash: hash })
    .eq("id", articleId);

  return NextResponse.json({
    success: true,
    title: a.naver_title ?? a.title,
    text,
    composedHash: hash,
    markWarning: markErr ? "조립 기록 실패 — preflight 대조가 옛 값을 본다" : undefined,
  });
}
