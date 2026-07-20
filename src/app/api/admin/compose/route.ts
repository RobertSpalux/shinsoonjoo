import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { checkArticleById } from "@/lib/compliance/server";
import { toNaverText, toBlogspotHtml } from "@/lib/osmu-format";

/**
 * 심의용 원고 조립(서버) — [심의용 복사]가 호출한다.
 * ⚠️ 클라이언트 버튼만 막으면 우회되므로, 서버에서 §6.10 게이트를 다시 건다.
 *    level !== 'clean'이면 409로 거절(원고를 내주지 않는다).
 * 조립은 항상 mode='submission'(심의필 줄 공란). 게시용(publish)은 승인 후 별도 경로.
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { articleId, channel } = body as { articleId?: string; channel?: string };
  if (!articleId || (channel !== "naver" && channel !== "blogspot")) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

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
    .select("title, naver_title, slug, tags, naver_blog_content, blogspot_content")
    .eq("id", articleId)
    .maybeSingle();
  if (!a) return NextResponse.json({ error: "기사를 찾을 수 없습니다" }, { status: 404 });

  let text: string;
  if (channel === "naver") {
    if (!a.naver_blog_content) return NextResponse.json({ error: "네이버 원고 없음" }, { status: 400 });
    text = `${a.naver_title ?? a.title}\n\n${toNaverText(a.naver_blog_content, {
      articleTitle: a.title,
      slug: a.slug,
      tags: a.tags,
      review: null,
      mode: "submission",
    })}`;
  } else {
    if (!a.blogspot_content) return NextResponse.json({ error: "블로그스팟 원고 없음" }, { status: 400 });
    text = toBlogspotHtml(a.blogspot_content, a.slug, a.tags, { review: null, mode: "submission" });
  }

  return NextResponse.json({ success: true, text });
}
