import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  factorySystemPrompt,
  evergreenSystemPrompt,
  scanBannedTopics,
  FACTORY_OUTPUT_SCHEMA,
  EVERGREEN_OUTPUT_SCHEMA,
  type EvergreenSeed,
} from "@/lib/factory-prompt";

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
 * 임계값은 모드별(뉴스 4개/1,900자, 상록수 5개/2,300자 — 커밋 M2).
 */
function validateMainMarkdown(md: unknown, minH2 = 4, minChars = 1900): string[] {
  const issues: string[] = [];
  const text = typeof md === "string" ? md : "";
  if (!text.trim()) return ["main_website_markdown 없음/비어 있음"];
  const h2Count = (text.match(/^##\s/gm) ?? []).length;
  if (h2Count < minH2) issues.push(`H2 소제목 ${h2Count}개(최소 ${minH2}개)`);
  if (text.length < minChars) issues.push(`본문 ${text.length}자(${minChars}자 미만)`);
  return issues;
}

/**
 * 하드 룰 needs_human_review 트리거 — 커밋 M2 (상록수 전용).
 * 틀리면 치명적인 사실 유형(세율·법령·금액·의료 수치)이 본문에 섞이면 사람 검수를 강제한다.
 * ⚠️ 자동 웹검증은 하지 않는다 — 검증기 오류가 오정보에 근거를 붙이는 게 더 위험.
 * 생성=자동 / 검수=사람 1회 원칙.
 */
const HUMAN_REVIEW_TRIGGERS: [pattern: RegExp, label: string][] = [
  [/\d+(\.\d+)?\s*%/, "세율·퍼센트"],
  // "법" 단독 매치는 방법·기법 등 일반어 오탐이 커서 대표적 비법령 접미어만 룩비하인드로 제외
  [/(?<![방기문화요수어편해])법|시행령|제\d+조/, "법령·조문"],
  [/\d+\s*(만원|억|천만원)/, "금액 한도"],
  [/기수|병기|\d\s*(㎎|mg|cc)/, "의료 수치"],
];

function scanHumanReviewTriggers(text: string): string[] {
  return HUMAN_REVIEW_TRIGGERS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

/**
 * 고위험 주제 게이트 — 틀리면 소비자 피해·법적 리스크로 직결되는 주제군.
 * 컷이 아니라 needs_human_review 강제 + 검증 항목 자동 주입(좋은 소재이므로 죽이지 않는다).
 * 뉴스·상록수 공통 — 뉴스는 종전에 일화 날조 외 사실검증 플래그가 없어 분쟁·판례·세법·의료
 * 기사가 무플래그로 초안 적재됐다(실측: 연금 조기수령/분쟁사례 초안).
 * 감지면은 제목·본문·출처명 — 출처명(예: '분쟁조정위원회')만으로도 주제 성격이 드러난다.
 */
const HIGH_RISK_TOPICS: { tokens: string[]; check: string }[] = [
  {
    tokens: ["분쟁조정", "분쟁", "민원사례"],
    check: "분쟁조정·민원 사례의 결과와 쟁점을 원문과 대조했는가 (결론을 일반화하지 않았는가)",
  },
  {
    tokens: ["판례", "소송", "손해배상", "배상책임"],
    check: "판례·소송의 심급과 확정 여부를 원문과 대조했는가 (하급심을 확정 판결로 쓰지 않았는가)",
  },
  {
    tokens: ["세액공제", "세율", "과세", "비과세", "상속", "증여"],
    check: "세율·공제한도·과세요건이 현행 기준인가 (개정 시행일 반영 확인)",
  },
  {
    tokens: ["진단기준", "급여기준", "산정특례", "후유장해"],
    check: "진단기준·급여기준·지급기준을 약관/고시 원문과 대조했는가",
  },
];

type HighRiskHit = { tokens: string[]; check: string };

/** 제목·본문·출처명에서 고위험 토큰 감지 → 감지된 토큰과 검증 항목 반환 */
function scanHighRiskTopics(text: string): HighRiskHit[] {
  return HIGH_RISK_TOPICS.map(({ tokens, check }) => ({
    tokens: tokens.filter((t) => text.includes(t)),
    check,
  })).filter((hit) => hit.tokens.length > 0);
}

/**
 * 일화 날조 하드 게이트(일화뱅크) — '특정 시점 + 특정 고객' 결합 서사 감지.
 * CLAUDE.md 일화 날조 금지: "어제 만난 50대 고객님이…" 류는 지어낸 단건 서사 의심.
 * "상담하다 보면 ~하시는 분이 많습니다" 반복 패턴 화법은 시점 결합이 없어 통과한다.
 * 컷이 아니라 플래그 — 오탐 가능성이 있으므로 needs_human_review로 사람 판단에 넘긴다.
 * 뉴스·상록수 공통 게이트(규칙은 공통 원칙 — O8).
 */
const FABRICATED_ANECDOTE =
  /(어제|그저께|엊그제|오늘|지난\s*주|지난\s*달|이번\s*주)[^.\n]{0,20}(만난|만났던|찾아온|찾아오신|방문한|방문하신|상담한|상담했던|전화\s*주신)[^.\n]{0,12}(고객|분|님)/;

/** 허브 시드 전용 FAQ 하한 (커밋 M3-3) — min 0이면 검사하지 않음 */
function validateFaqCount(faq: unknown, min: number): string[] {
  if (!min) return [];
  const n = Array.isArray(faq) ? faq.length : 0;
  return n < min ? [`FAQ ${n}개(허브 최소 ${min}개)`] : [];
}

/** 금지 소재 하드 게이트 발동 알림 (커밋 O1 — best-effort) */
async function notifyBannedBlocked(title: string, terms: string[], sourceUrl?: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: [
        `⚠️ 금지 소재 감지: ${terms.join("·")} — 저장하지 않음, 소스 차단목록 등록됨`,
        title,
        sourceUrl ? `소스: ${sourceUrl}` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 4000),
    }),
  }).catch(() => undefined);
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

/** 일화 날조 의심 플래그 알림 (일화뱅크 — best-effort, 뉴스 모드 전용) */
async function notifyAnecdoteFlag(title: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `⚠️ 일화 날조 의심('특정 시점+특정 고객' 서사 감지) — needs_human_review 플래그, /admin에서 확인\n${title}`.slice(0, 4000),
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
    /** 커밋 M2 — 미지정 = 'news' = 현행 그대로 */
    mode?: "news" | "evergreen";
    seed?: Partial<EvergreenSeed>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 JSON 요청" }, { status: 400 });
  }

  // 발행 통제: 생성 = 초안(auto_publish 기본 false). 발행은 /admin에서 사람이 1클릭.
  const { title, category, source_url, source_name, content, auto_publish = false, mode = "news", seed } = body;
  if (mode !== "news" && mode !== "evergreen") {
    return NextResponse.json({ error: "mode는 'news' | 'evergreen'만 허용됩니다." }, { status: 400 });
  }
  if (!content?.trim()) {
    return NextResponse.json({ error: "content(원천 자료)가 필요합니다." }, { status: 400 });
  }

  // 상록수: 시드 정규화 + seed_key 중복 선차단 (unique index — 토큰 쓰기 전에 걸러낸다)
  let evergreenSeed: EvergreenSeed | null = null;
  if (mode === "evergreen") {
    if (!seed?.key?.trim() || !seed?.title?.trim()) {
      return NextResponse.json(
        { error: "evergreen 모드에는 seed.key와 seed.title이 필요합니다." },
        { status: 400 }
      );
    }
    evergreenSeed = {
      key: seed.key.trim(),
      title: seed.title.trim(),
      category: seed.category ?? category ?? "",
      intent: seed.intent === "전환" ? "전환" : "유입",
      keywords: seed.keywords ?? [],
      sources: seed.sources ?? [],
      description: seed.description,
      isHub: seed.isHub === true,
    };
    const { data: seedExisting } = await createAdminClient()
      .from("premium_articles")
      .select("id, slug")
      .eq("seed_key", evergreenSeed.key)
      .maybeSingle();
    if (seedExisting) {
      return NextResponse.json(
        { error: `이미 생성된 시드입니다(seed_key=${evergreenSeed.key}, slug=${seedExisting.slug})` },
        { status: 409 }
      );
    }
  }

  const anthropic = new Anthropic(); // ANTHROPIC_API_KEY

  const userContent =
    mode === "evergreen"
      ? [
          "아래 근거 자료만을 사실 근거로 삼아, 시스템 프롬프트의 시드 기획에 따라 상록수 원고를 생성하라.",
          "",
          "--- 근거 자료 (groundingText — 구체적 사실은 이 안에 있는 것만) ---",
          content.trim().slice(0, 30000),
        ].join("\n")
      : [
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

  // 모드별 프롬프트·스키마 — 뉴스는 현행 그대로
  const systemPrompt = evergreenSeed ? evergreenSystemPrompt(evergreenSeed) : factorySystemPrompt();
  const outputSchema = evergreenSeed ? EVERGREEN_OUTPUT_SCHEMA : FACTORY_OUTPUT_SCHEMA;

  // 1회 생성 — 카드 검증 가드의 재생성에서도 동일하게 호출
  const generateOnce = async (): Promise<
    | { error: { status: number; message: string } }
    | { article: Record<string, unknown>; usage: { input_tokens: number; output_tokens: number } }
  > => {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: systemPrompt,
      output_config: {
        format: {
          type: "json_schema",
          schema: outputSchema as unknown as Record<string, unknown>,
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
    // 하한: 뉴스 H2 4/1,900자 · 상록수 5/2,300자 · 허브(M3-3) 7/3,200자 + FAQ 8
    const isHub = evergreenSeed?.isHub === true;
    const mdMinH2 = mode === "evergreen" ? (isHub ? 7 : 5) : 4;
    const mdMinChars = mode === "evergreen" ? (isHub ? 3200 : 2300) : 1900;
    const minFaq = isHub ? 8 : 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validateArticleBody = (a: any) => [
      ...validateMainMarkdown(a.main_website_markdown, mdMinH2, mdMinChars),
      ...validateFaqCount(a.faq_json, minFaq),
    ];
    let carouselIssues = validateCarousel(article.carousel_json);
    let markdownIssues = validateArticleBody(article);
    let bannedTerms = scanBannedTopics(article); // 금지 소재 하드 게이트 (커밋 O1)
    if (carouselIssues.length + markdownIssues.length + bannedTerms.length > 0) {
      console.warn(
        `생성물 검증 실패 — 1회 재생성: ${[...carouselIssues, ...markdownIssues, ...bannedTerms.map((t) => `금지어:${t}`)].join(" / ")}`
      );
      try {
        const retry = await generateOnce();
        if (!("error" in retry)) {
          usage.input_tokens += retry.usage.input_tokens;
          usage.output_tokens += retry.usage.output_tokens;
          const retryCarousel = validateCarousel(
            (retry.article as { carousel_json?: unknown }).carousel_json
          );
          const retryMarkdown = validateArticleBody(retry.article);
          const retryBanned = scanBannedTopics(retry.article);
          // 채택 규칙: 금지어가 최우선 — 금지어를 없앤 재시도는 무조건 채택,
          // 금지어를 새로 만든 재시도는 절대 채택하지 않는다. 그 외엔 위반 합계가 적은 쪽.
          const preferRetry =
            bannedTerms.length > 0 && retryBanned.length === 0
              ? true
              : bannedTerms.length === 0 && retryBanned.length > 0
                ? false
                : retryCarousel.length + retryMarkdown.length + retryBanned.length <
                  carouselIssues.length + markdownIssues.length + bannedTerms.length;
          if (preferRetry) {
            article = retry.article;
            carouselIssues = retryCarousel;
            markdownIssues = retryMarkdown;
            bannedTerms = retryBanned;
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

    // 금지 소재 하드 게이트 (커밋 O1) — 재생성 후에도 감지되면 저장하지 않고 스킵.
    // 해당 소스는 차단목록에 자동 등록 → 다음 수집부터 게이트 이전에 제외된다.
    if (bannedTerms.length > 0) {
      console.warn(`금지 소재 최종 감지(${bannedTerms.join("·")}) — 저장하지 않음`);
      const gateSupabase = createAdminClient();
      if (source_url) {
        const { error: blockErr } = await gateSupabase
          .from("blocked_sources")
          .upsert({ url: source_url, reason: "금지소재" }, { onConflict: "url" });
        if (blockErr) console.error("blocked_sources 등록 실패:", blockErr);
      }
      await notifyBannedBlocked(
        String(article.title ?? title ?? "(제목 없음)"),
        bannedTerms,
        source_url ?? undefined
      );
      return NextResponse.json(
        { error: `금지 소재 감지(${bannedTerms.join("·")}) — 저장하지 않음`, blocked: true },
        { status: 422 }
      );
    }

    // 사람 검수 게이트 — 감지 시 needs_human_review=true (컷이 아니라 플래그).
    let needsHumanReview = false;
    const reviewReasons: string[] = [];

    // 일화 날조 의심(일화뱅크) — 뉴스·상록수 공통
    if (FABRICATED_ANECDOTE.test(String(article.main_website_markdown ?? ""))) {
      needsHumanReview = true;
      reviewReasons.push("특정 시점+특정 고객 일화 의심(날조 금지 게이트)");
      // 상록수는 파이프라인 요약의 🔴 라인이 사유를 실어 나르므로 뉴스만 별도 알림
      if (mode === "news") {
        await notifyAnecdoteFlag(String(article.title ?? title ?? "(제목 없음)"));
      }
    }

    // 고위험 주제 게이트 — 뉴스·상록수 공통. 감지 시 사람 검수 강제 + 검증 항목 자동 주입.
    const riskHits = scanHighRiskTopics(
      [article.title ?? title ?? "", article.main_website_markdown ?? "", source_name ?? ""].join("\n")
    );
    const riskTokens = riskHits.flatMap((h) => h.tokens);
    if (riskHits.length > 0) {
      needsHumanReview = true;
      reviewReasons.push(`고위험 주제(${riskTokens.join("·")})`);
    }

    // 상록수 사실검증 게이트(커밋 M2) — 원고 검증 최종 실패 또는 민감 사실 포함이면 사람 검수 강제.
    if (mode === "evergreen") {
      if (markdownIssues.length > 0) {
        needsHumanReview = true;
        reviewReasons.push("원고 검증 최종 실패");
      }
      const triggers = scanHumanReviewTriggers(String(article.main_website_markdown ?? ""));
      if (triggers.length > 0) {
        needsHumanReview = true;
        reviewReasons.push(`민감 사실 포함(${triggers.join("·")})`);
      }
    }
    if (needsHumanReview) {
      console.warn(`needs_human_review=true — ${reviewReasons.join(" / ")}`);
    }

    // 검증 항목 = 모델 자가 신고(상록수) + 고위험 주제 자동 항목(공통).
    // 자동 항목은 confidence=low — 어드민 체크리스트에서 사람이 원문과 대조하기 전엔 미검증이다.
    // 뉴스는 모델이 verify_claims를 내지 않으므로(스키마 미포함) 자동 항목만 실린다.
    const modelClaims = Array.isArray(article.verify_claims) ? article.verify_claims : [];
    const autoClaims = riskHits.map((hit) => ({
      claim: hit.check,
      basis: `고위험 주제 자동 감지: ${hit.tokens.join("·")}`,
      confidence: "low",
    }));
    const verifyClaims = [...modelClaims, ...autoClaims];

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
        naver_title: article.naver_title ?? null,
        blogspot_title: article.blogspot_title ?? null,
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
        // 상록수 전용 컬럼 — 뉴스 insert는 기존과 동일(DB 디폴트 content_type='news')
        ...(evergreenSeed
          ? {
              content_type: "evergreen",
              seed_key: evergreenSeed.key,
            }
          : {}),
        // 검증 항목 — 뉴스도 고위험 주제 자동 항목이 실린다(없으면 null = 종전과 동일)
        verify_claims: verifyClaims.length > 0 ? verifyClaims : null,
        // 사람 검수 플래그 — 뉴스·상록수 공통(일화 날조·고위험 주제 게이트는 두 모드 모두 적용)
        needs_human_review: needsHumanReview,
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
      // 사람 검수 필요 플래그·사유 — 뉴스·상록수 공통(파이프라인이 텔레그램 요약에 실음)
      needs_human_review: needsHumanReview,
      review_reasons: reviewReasons.length > 0 ? reviewReasons.join(" / ") : undefined,
      // 고위험 주제 감지 토큰 — 텔레그램 ⚖️ 라인 관측용
      high_risk_topics: riskTokens.length > 0 ? riskTokens : undefined,
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
