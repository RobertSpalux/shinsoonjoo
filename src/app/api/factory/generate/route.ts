import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase-admin";
import { factorySystemPrompt, FACTORY_OUTPUT_SCHEMA } from "@/lib/factory-prompt";

export const maxDuration = 300; // Fluid Compute: 멀티 원고 생성은 수 분 소요 가능

const MODEL = process.env.FACTORY_CLAUDE_MODEL ?? "claude-sonnet-5";

/**
 * OSMU 콘텐츠 팩토리.
 * 인풋: { title?, category?, source_url, source_name, content }
 * 원천 뉴스 1건 → Claude가 4개 채널 원고 + FAQ + 카드뉴스 스크립트를
 * JSON Schema 강제 출력으로 동시 생성 → premium_articles 적재.
 * 인증: x-factory-secret 헤더 (GitHub Actions 크론 전용).
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-factory-secret");
  if (!process.env.FACTORY_SECRET || secret !== process.env.FACTORY_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    title?: string;
    category?: string;
    source_url?: string;
    source_name?: string;
    content?: string;
    auto_publish?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 JSON 요청" }, { status: 400 });
  }

  const { title, category, source_url, source_name, content, auto_publish = true } = body;
  if (!content?.trim()) {
    return NextResponse.json({ error: "content(원천 자료)가 필요합니다." }, { status: 400 });
  }

  const anthropic = new Anthropic(); // ANTHROPIC_API_KEY

  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: factorySystemPrompt(),
      output_config: {
        format: {
          type: "json_schema",
          schema: FACTORY_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [
        {
          role: "user",
          content: [
            "다음 원천 자료로 4개 채널 원고를 생성하라.",
            title ? `제안 제목: ${title}` : "",
            category ? `카테고리 힌트: ${category}` : "",
            source_name ? `출처: ${source_name}` : "",
            source_url ? `원문 URL: ${source_url}` : "",
            "",
            "--- 원천 자료 ---",
            content.trim().slice(0, 30000),
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      return NextResponse.json({ error: "생성이 거부되었습니다." }, { status: 422 });
    }
    if (message.stop_reason === "max_tokens") {
      return NextResponse.json({ error: "출력이 잘렸습니다. 원천 자료를 줄여주세요." }, { status: 422 });
    }

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "빈 응답" }, { status: 502 });
    }

    const article = JSON.parse(textBlock.text);

    // slug 중복 방지 — 이미 있으면 날짜 접미사
    const supabase = createAdminClient();
    const { data: existing } = await supabase
      .from("premium_articles")
      .select("id")
      .eq("slug", article.slug)
      .maybeSingle();

    const slug = existing
      ? `${article.slug}-${new Date().toISOString().slice(0, 10)}`
      : article.slug;

    const { data: inserted, error: dbError } = await supabase
      .from("premium_articles")
      .insert({
        title: article.title,
        slug,
        category: article.category,
        summary: article.summary,
        tags: article.tags,
        key_points: article.key_points ?? [],
        remodeling_bridge: article.remodeling_bridge ?? null,
        instagram_caption: article.instagram_caption ?? null,
        raw_source_url: source_url ?? null,
        raw_source_name: source_name ?? null,
        raw_source_excerpt: content.trim().slice(0, 2000),
        main_website_markdown: article.main_website_markdown,
        naver_blog_content: article.naver_blog_content,
        blogspot_content: article.blogspot_content,
        carousel_json: article.carousel_json,
        faq_json: article.faq_json,
        is_main_published: auto_publish,
        published_at: auto_publish ? new Date().toISOString() : null,
      })
      .select("id, slug, title, category")
      .single();

    if (dbError) {
      console.error("premium_articles insert error:", dbError);
      return NextResponse.json({ error: "DB 적재 실패" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      article: inserted,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
      },
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "API 사용량 초과 — 잠시 후 재시도" }, { status: 429 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Claude API error:", err.status, err.message);
      return NextResponse.json({ error: "AI 생성 실패" }, { status: 502 });
    }
    console.error("Factory error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
