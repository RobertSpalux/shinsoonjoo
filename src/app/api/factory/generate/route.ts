import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase-admin";
import { factorySystemPrompt, FACTORY_OUTPUT_SCHEMA } from "@/lib/factory-prompt";

export const maxDuration = 300; // Fluid Compute: 멀티 원고 생성은 수 분 소요 가능

const MODEL = process.env.FACTORY_CLAUDE_MODEL ?? "claude-sonnet-5";

/**
 * 카드 검증 가드 — 생성 변동성 방어 (실측: stat 4장 중복 + cta 누락 샘플 관측).
 * 위반 목록을 반환. 비어 있으면 통과.
 */
function validateCarousel(cards: unknown): string[] {
  const issues: string[] = [];
  if (!Array.isArray(cards) || cards.length === 0) return ["carousel_json 없음/비어 있음"];

  type Card = { type?: string; overline?: string; headline?: string; body?: string };
  const list = cards as Card[];

  if (list[0]?.type !== "hook") issues.push(`1번 카드가 hook 아님(${list[0]?.type ?? "없음"})`);
  if (list[list.length - 1]?.type !== "cta")
    issues.push(`마지막 카드가 cta 아님(${list[list.length - 1]?.type ?? "없음"})`);
  if (list.length < 5 || list.length > 9) issues.push(`카드 수 ${list.length}장(5~9 범위 밖)`);

  const typeCounts = new Map<string, number>();
  for (const c of list) {
    const t = c.type ?? "unknown";
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  for (const [t, n] of typeCounts) {
    if (n >= 3) issues.push(`${t} 타입 ${n}장 반복(물타기 의심)`);
  }

  list.forEach((c, i) => {
    for (const field of ["overline", "headline", "body"] as const) {
      if (!String(c[field] ?? "").trim()) issues.push(`${i + 1}번(${c.type}) ${field} 비어 있음`);
    }
  });
  return issues;
}

/**
 * 원고 검증 가드 — 커밋 M0. 실측: 프롬프트의 글자수 지시(2,000~3,200자)가 안 먹혀
 * 1,749자/1,302자 미달 생성물 관측 → 글자수가 아니라 구조(H2 개수)로 강제하고 여기서 검증.
 */
function validateMainMarkdown(md: unknown): string[] {
  const issues: string[] = [];
  const text = typeof md === "string" ? md : "";
  if (!text.trim()) return ["main_website_markdown 없음/비어 있음"];
  const h2Count = (text.match(/^##\s/gm) ?? []).length;
  if (h2Count < 4) issues.push(`H2 소제목 ${h2Count}개(최소 4개)`);
  if (text.length < 1900) issues.push(`본문 ${text.length}자(1,900자 미만)`);
  return issues;
}

/** 검증 최종 실패 시 텔레그램 플래그 (best-effort — env 없으면 조용히 스킵) */
async function notifyValidationWarning(title: string, kind: string, issues: string[]) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `⚠️ ${kind} 검증 실패(재시도 후에도) — 저장은 됨, /admin에서 확인 필요\n${title}\n· ${issues.join("\n· ")}`.slice(0, 4000),
    }),
  }).catch(() => undefined);
}

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

  // 발행 통제: 생성 = 초안(auto_publish 기본 false). 발행은 /admin에서 사람이 1클릭.
  const { title, category, source_url, source_name, content, auto_publish = false } = body;
  if (!content?.trim()) {
    return NextResponse.json({ error: "content(원천 자료)가 필요합니다." }, { status: 400 });
  }

  const anthropic = new Anthropic(); // ANTHROPIC_API_KEY

  const userContent = [
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
    .join("\n");

  // 1회 생성 — 카드 검증 가드의 재생성에서도 동일하게 호출
  const generateOnce = async (): Promise<
    | { error: { status: number; message: string } }
    | { article: Record<string, unknown>; usage: { input_tokens: number; output_tokens: number } }
  > => {
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
      messages: [{ role: "user", content: userContent }],
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      return { error: { status: 422, message: "생성이 거부되었습니다." } };
    }
    if (message.stop_reason === "max_tokens") {
      return { error: { status: 422, message: "출력이 잘렸습니다. 원천 자료를 줄여주세요." } };
    }
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { error: { status: 502, message: "빈 응답" } };
    }
    return {
      article: JSON.parse(textBlock.text),
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
      },
    };
  };

  try {
    const first = await generateOnce();
    if ("error" in first) {
      return NextResponse.json({ error: first.error.message }, { status: first.error.status });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let article: any = first.article;
    const usage = { ...first.usage };

    // 검증 가드 — 카드(커밋 G) + 본진 원고(커밋 M0). 어느 쪽이든 실패 시 1회만 재생성
    // (가드별 재생성이면 최대 3회 호출이 되므로 합산 1회). 그래도 실패하면 그대로 저장하되 ⚠️ 플래그.
    let carouselIssues = validateCarousel(article.carousel_json);
    let markdownIssues = validateMainMarkdown(article.main_website_markdown);
    if (carouselIssues.length + markdownIssues.length > 0) {
      console.warn(
        `생성물 검증 실패 — 1회 재생성: ${[...carouselIssues, ...markdownIssues].join(" / ")}`
      );
      try {
        const retry = await generateOnce();
        if (!("error" in retry)) {
          usage.input_tokens += retry.usage.input_tokens;
          usage.output_tokens += retry.usage.output_tokens;
          const retryArticle = retry.article as {
            carousel_json?: unknown;
            main_website_markdown?: unknown;
          };
          const retryCarousel = validateCarousel(retryArticle.carousel_json);
          const retryMarkdown = validateMainMarkdown(retryArticle.main_website_markdown);
          // 위반 합계가 더 적은 쪽 채택 (재시도 통과 시 0건 → 경고 해제)
          if (retryCarousel.length + retryMarkdown.length < carouselIssues.length + markdownIssues.length) {
            article = retry.article;
            carouselIssues = retryCarousel;
            markdownIssues = retryMarkdown;
          }
        }
      } catch (retryErr) {
        console.warn("재생성 호출 실패 — 원본 유지:", retryErr);
      }
      if (carouselIssues.length > 0) {
        console.warn(`carousel 검증 최종 실패 — 그대로 저장: ${carouselIssues.join(" / ")}`);
        await notifyValidationWarning(String(article.title ?? "(제목 없음)"), "카드", carouselIssues);
      }
      if (markdownIssues.length > 0) {
        console.warn(`본진 원고 검증 최종 실패 — 그대로 저장: ${markdownIssues.join(" / ")}`);
        await notifyValidationWarning(String(article.title ?? "(제목 없음)"), "본진 원고", markdownIssues);
      }
    }

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
        // 초안이어도 published_at은 생성 시각으로 기록(정렬용). 노출 게이트는 is_main_published를
        // 함께 보므로 초안(false)은 웹에 뜨지 않음. 발행 시 admin이 published_at을 재기록.
        published_at: new Date().toISOString(),
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
      // 재시도 후에도 남은 검증 위반 — 파이프라인이 텔레그램 요약에 플래그로 실음
      carousel_warning: carouselIssues.length > 0 ? carouselIssues.join(" / ") : undefined,
      markdown_warning: markdownIssues.length > 0 ? markdownIssues.join(" / ") : undefined,
      usage, // 재생성 포함 합산
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
