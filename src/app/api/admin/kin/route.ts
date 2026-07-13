import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { kinAnswerSystemPrompt } from "@/lib/factory-prompt";

export const maxDuration = 120;

const MODEL = process.env.FACTORY_CLAUDE_MODEL ?? "claude-sonnet-5";

/**
 * 지식iN 답변 초안 생성 — 커밋 P2. 반자동 어시스트 전용.
 * ⚠️ 네이버 게시는 이 라우트가 하지 않는다 — 100% 사람이 수동(어뷰징 제재 방지).
 * 초안을 생성해 kin_answers에 '초안' 상태로 저장하고 행을 돌려준다.
 * 상태 변경(게시완료/채택됨/폐기)·posted_at 기록은 /api/admin/update 경유.
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    question_url?: string;
    question_title?: string;
    question_body?: string;
    linked_article_id?: string;
    /** 네이버 블로그 게시글 URL — DB에 없으므로 관리자가 직접 입력(선택) */
    linked_article_url?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 JSON 요청" }, { status: 400 });
  }

  const { question_url, question_title, question_body, linked_article_id, linked_article_url } = body;
  if (!question_url?.trim() || !question_title?.trim() || !question_body?.trim()) {
    return NextResponse.json({ error: "질문 URL·제목·본문이 모두 필요합니다." }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 연결 글 — 링크는 관리자가 URL을 함께 입력한 경우에만 답변에 들어간다
  let linked: { title: string; naverUrl: string } | undefined;
  let linkedContext = "";
  if (linked_article_id) {
    const { data: article } = await supabase
      .from("premium_articles")
      .select("title, naver_title, summary, key_points")
      .eq("id", linked_article_id)
      .maybeSingle();
    if (!article) {
      return NextResponse.json({ error: "연결 글을 찾을 수 없습니다." }, { status: 400 });
    }
    const title = article.naver_title ?? article.title;
    linkedContext = [
      "",
      "--- 연결 글(네이버 블로그 게시분) — 답변 방향 참고용 ---",
      `제목: ${title}`,
      article.summary ? `요약: ${article.summary}` : "",
      Array.isArray(article.key_points) && article.key_points.length
        ? `핵심: ${article.key_points.join(" / ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (linked_article_url?.trim()) {
      linked = { title, naverUrl: linked_article_url.trim() };
    }
  }

  try {
    const anthropic = new Anthropic(); // ANTHROPIC_API_KEY
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: kinAnswerSystemPrompt(linked),
      messages: [
        {
          role: "user",
          content: [
            "아래 지식iN 질문에 대한 답변 초안을 작성하라.",
            "",
            `질문 제목: ${question_title.trim()}`,
            "질문 본문:",
            question_body.trim().slice(0, 4000),
            linkedContext,
          ].join("\n"),
        },
      ],
    });

    if (message.stop_reason === "refusal") {
      return NextResponse.json({ error: "생성이 거부되었습니다." }, { status: 422 });
    }
    const textBlock = message.content.find((b) => b.type === "text");
    const draft = textBlock?.type === "text" ? textBlock.text.trim() : "";
    if (!draft) {
      return NextResponse.json({ error: "빈 응답" }, { status: 502 });
    }

    const { data: inserted, error: dbError } = await supabase
      .from("kin_answers")
      .insert({
        question_url: question_url.trim(),
        question_title: question_title.trim(),
        question_body: question_body.trim(),
        answer_draft: draft,
        linked_article_id: linked_article_id ?? null,
      })
      .select("id, question_url, question_title, question_body, answer_draft, linked_article_id, status, created_at, posted_at")
      .single();

    if (dbError) {
      console.error("kin_answers insert error:", dbError);
      return NextResponse.json({ error: "DB 저장 실패" }, { status: 500 });
    }
    return NextResponse.json({ success: true, answer: inserted });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "API 사용량 초과 — 잠시 후 재시도" }, { status: 429 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Claude API error:", err.status, err.message);
      return NextResponse.json({ error: "AI 생성 실패" }, { status: 502 });
    }
    console.error("kin draft error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
