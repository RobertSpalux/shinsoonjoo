import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  factorySystemPrompt,
  evergreenSystemPrompt,
  scanBannedTopics,
  stage1Schema,
  STAGE2_SCHEMA,
  type EvergreenSeed,
} from "@/lib/factory-prompt";
import { scanPlainStyle, formatStyleViolations, type StyleViolation } from "@/lib/style-gate";
import { scanEvidence, summarizeEvidence } from "@/lib/evidence-gate";

/**
 * ⚠️ 300이 이 프로젝트의 상한이다 — 올리지 말 것(2026-07-14 실측).
 * Vercel 함수 한도: Hobby=300초(고정) / Pro·Enterprise=800초.
 * 프리뷰 배포로 검증함 — maxDuration=800은 배포 실패, 300은 성공 → 현재 Hobby 플랜.
 * 상록수 생성이 300초를 넘겨 죽는 문제는 이 값이 아니라 생성 시간 자체로 풀어야 한다
 * (아래 ⏱️ 계측이 1회차/재생성 소요를 실측해 파이프라인 요약에 싣는다).
 */
export const maxDuration = 300;

const MODEL = process.env.FACTORY_CLAUDE_MODEL ?? "claude-sonnet-5";

/**
 * 단계별 출력 상한 — 단일 호출 32,000이 폭주해 311초·잘림을 냈다(2026-07-14 실측).
 * 스키마로 필드를 쪼갠 위에 상한도 단계 크기에 맞춰 내린다: 한 단계가 천장을 쳐도
 * 함수 한도(300초) 안에서 끝나고, 그 사실이 422로 드러난다(무음 실패 금지).
 */
const STAGE1_MAX_TOKENS = 16000; // 본문+FAQ+검증목록+메타 (실측 typical ~8k)
const STAGE2_MAX_TOKENS = 14000; // 네이버+블로그스팟+인스타+카드 (실측 typical ~10k)

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
    /** 검수 대조용 원문 전문(무절단) — 미지정 시 content로 폴백 */
    source_fulltext?: string;
    /** 커밋 M2 — 미지정 = 'news' = 현행 그대로 */
    mode?: "news" | "evergreen";
    seed?: Partial<EvergreenSeed>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 JSON 요청" }, { status: 400 });
  }

  // 발행 통제: 생성은 항상 초안이다. 발행은 심의 등록 후 /admin에서만 한다.
  const {
    title,
    category,
    source_url,
    source_name,
    content,
    source_fulltext,
    mode = "news",
    seed,
  } = body;
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

  // system 프롬프트는 1·2차가 동일한 문자열을 재사용한다 → 2차에서 캐시 읽기로 붙는다.
  // (프롬프트 텍스트는 바꾸지 않는다. 출력 필드 제한은 스키마로만 건다 — 글자수 지시는 모델이 무시함)
  const systemPrompt = evergreenSeed ? evergreenSystemPrompt(evergreenSeed) : factorySystemPrompt();

  type StageUsage = {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  type StageResult =
    | { error: { status: number; message: string } }
    | { data: Record<string, unknown>; usage: StageUsage };

  /**
   * 단계 1회 생성. 스키마가 그 호출이 뽑을 수 있는 필드를 물리적으로 제한하므로
   * 한 호출이 32k까지 폭주하지 않는다(단일 호출 실측: 311초 + max_tokens 잘림).
   */
  const generateStage = async (
    label: string,
    schema: unknown,
    userMessage: string,
    maxTokens: number
  ): Promise<StageResult> => {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      /**
       * ⚠️ 폭주의 진짜 원인 — Claude Sonnet 5는 thinking을 생략하면 adaptive thinking이 기본 ON이고,
       * 추론 토큰이 max_tokens를 함께 먹는다. 실측(2026-07-14): 16,000 출력 토큰 중 텍스트는 1,473자뿐
       * (나머지 ~14.5k가 thinking) → 본문이 중간에 잘리고 311초 소요.
       * 이 파이프라인은 17,000자 시스템 프롬프트가 규칙을 전부 명시하는 구조화 출력 작업이라
       * 추론 여지가 크지 않다 → 명시적으로 끈다. 프롬프트·모델·스키마는 그대로 둔다.
       */
      thinking: { type: "disabled" },
      // 프롬프트 캐싱 — 블록 배열 + 브레이크포인트 1개(기본 TTL 5분). 1·2차가 같은 system이라
      // 2차는 캐시 읽기로 붙는다(💾 라인으로 관측).
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      output_config: {
        format: { type: "json_schema", schema: schema as Record<string, unknown> },
      },
      messages: [{ role: "user", content: userMessage }],
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      return { error: { status: 422, message: `${label}: 생성이 거부되었습니다.` } };
    }
    if (message.stop_reason === "max_tokens") {
      // 단계 분리 후에도 천장을 치면 그 단계의 스키마가 아직 큰 것 — 숨기지 않고 드러낸다.
      // 어느 필드를 쓰다 잘렸는지 남긴다(무음 실패 금지 — 추측으로 스키마를 손대지 않기 위해).
      const partial = message.content.find((b) => b.type === "text");
      const text = partial?.type === "text" ? partial.text : "";
      const keys = [...text.matchAll(/"([a-z_]+)"\s*:/g)].map((m) => m[1]);
      const blocks = message.content
        .map((b) => `${b.type}:${b.type === "text" ? b.text.length : "?"}자`)
        .join(", ");
      console.error(
        `[max_tokens 잘림] ${label} · output ${message.usage.output_tokens} 토큰 · 텍스트 ${text.length}자\n` +
          `  블록: [${blocks}] (총 ${message.content.length}개)\n` +
          `  usage: ${JSON.stringify(message.usage)}\n` +
          `  작성된 필드 순서: ${[...new Set(keys)].join(" → ")}\n` +
          `  잘린 지점(끝 200자): ${text.slice(-200)}`
      );
      return {
        error: { status: 422, message: `${label}: 출력이 max_tokens(${maxTokens})에서 잘렸습니다.` },
      };
    }
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { error: { status: 502, message: `${label}: 빈 응답` } };
    }
    return {
      data: JSON.parse(textBlock.text),
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
      },
    };
  };

  /** 2차 user 메시지 — 1차에서 확정된 본진 원고를 기준으로 채널 파생만 만든다 */
  const stage2Message = (s1: Record<string, unknown>) =>
    [
      "아래는 1차 생성에서 확정된 본진 원고다. 이 원고를 기준으로 채널 파생 원고(네이버·블로그스팟·인스타 캡션)만 생성하라.",
      "사실·수치는 본진 원고와 근거 자료 안에 있는 것만 사용한다(새로운 사실을 만들지 않는다).",
      "",
      "--- 확정된 본진 원고 ---",
      `제목: ${String(s1.title ?? "")}`,
      `요약: ${String(s1.summary ?? "")}`,
      `핵심: ${(Array.isArray(s1.key_points) ? s1.key_points : []).join(" / ")}`,
      "",
      String(s1.main_website_markdown ?? ""),
      "",
      "--- 근거 자료(원천) ---",
      content.trim().slice(0, 30000),
    ].join("\n");

  // ⏱️ 소요시간 계측 — 300초 벽(Hobby 상한)에 얼마나 여유가 있는지 숫자로 본다.
  const timing = {
    stage1_ms: 0,
    stage1_retry_ms: 0,
    stage2_ms: 0,
    stage2_retry_ms: 0,
    retried_stages: [] as string[],
    total_ms: 0,
  };
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  const addUsage = (u: StageUsage) => {
    usage.input_tokens += u.input_tokens;
    usage.output_tokens += u.output_tokens;
    usage.cache_creation_input_tokens += u.cache_creation_input_tokens;
    usage.cache_read_input_tokens += u.cache_read_input_tokens;
  };
  const startedAt = Date.now();

  // 검증 하한 — 종전 그대로. 뉴스 H2 4/1,900자 · 상록수 5/2,300자 · 허브 7/3,200자 + FAQ 8
  const isHub = evergreenSeed?.isHub === true;
  const mdMinH2 = mode === "evergreen" ? (isHub ? 7 : 5) : 4;
  const mdMinChars = mode === "evergreen" ? (isHub ? 3200 : 2300) : 1900;
  const minFaq = isHub ? 8 : 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const validateStage1 = (a: any) => [
    ...validateMainMarkdown(a.main_website_markdown, mdMinH2, mdMinChars),
    ...validateFaqCount(a.faq_json, minFaq),
  ];
  // carousel_json 제거(2026-07-15) — 카드 자동생성 중단. 2차 파생(네이버·블로그스팟·인스타
  // 캡션)에는 별도 구조 검증이 없어 무검증 통과. 금지어 스캔(scanBannedTopics)은 runStage 안에서
  // 여전히 돌아 위반 시 2차 재생성을 트리거한다 — 그 가드는 유지.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  const validateStage2 = (_a: any): string[] => [];

  /**
   * 단계 실행 + 검증 가드. 실패 시 그 단계만 1회 재생성한다(가드는 끄지 않는다 — 단계별로 유지).
   * 채택 규칙은 종전과 동일: 금지어를 없앤 재시도는 무조건 채택 / 새로 만든 재시도는 절대 미채택,
   * 그 외에는 위반 합계가 적은 쪽.
   */
  const runStage = async (
    label: string,
    schema: unknown,
    userMessage: string,
    maxTokens: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validate: (a: any) => string[],
    onTiming: (firstMs: number, retryMs: number, retried: boolean) => void
  ): Promise<
    | { error: { status: number; message: string } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | { data: any; issues: string[]; banned: string[]; style: StyleViolation[] }
  > => {
    const t0 = Date.now();
    const first = await runStageOnce();
    const firstMs = Date.now() - t0;
    console.log(`[⏱️ ${label}] ${(firstMs / 1000).toFixed(1)}초`);
    if ("error" in first) {
      onTiming(firstMs, 0, false);
      return first;
    }
    addUsage(first.usage);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = first.data;
    let issues = validate(data);
    let banned = scanBannedTopics(data); // 단계별 부분 결과에 대해서도 그대로 동작(누락 필드는 빈 문자열)
    let style = scanPlainStyle(data); // 문체(평서체) 검사 — 이 단계 본문 필드만 판정(누락 필드는 스킵)
    console.log(
      `[⏱️ ${label} 검증] ${
        issues.length + banned.length + style.length === 0
          ? "통과 — 재생성 없음"
          : `실패 → 재생성: ${[
              ...issues,
              ...banned.map((t) => `금지어:${t}`),
              ...style.map((v) => `문체:${v.field}`),
            ].join(" / ")}`
      }`
    );

    let retryMs = 0;
    let retried = false;
    if (issues.length + banned.length + style.length > 0) {
      retried = true;
      const t1 = Date.now();
      try {
        const retry = await runStageOnce();
        retryMs = Date.now() - t1;
        console.log(`[⏱️ ${label} 재생성] ${(retryMs / 1000).toFixed(1)}초`);
        if (!("error" in retry)) {
          addUsage(retry.usage);
          const retryIssues = validate(retry.data);
          const retryBanned = scanBannedTopics(retry.data);
          const retryStyle = scanPlainStyle(retry.data);
          // 금지어는 최우선(있음→없음이면 무조건 채택). 그 외엔 issues+banned+style 총합이 적은 쪽.
          const preferRetry =
            banned.length > 0 && retryBanned.length === 0
              ? true
              : banned.length === 0 && retryBanned.length > 0
                ? false
                : retryIssues.length + retryBanned.length + retryStyle.length <
                  issues.length + banned.length + style.length;
          if (preferRetry) {
            data = retry.data;
            issues = retryIssues;
            banned = retryBanned;
            style = retryStyle;
          }
        }
      } catch (retryErr) {
        retryMs = Date.now() - t1;
        console.warn(`${label} 재생성 호출 실패 — 원본 유지:`, retryErr);
      }
    }
    onTiming(firstMs, retryMs, retried);
    return { data, issues, banned, style };

    async function runStageOnce() {
      return generateStage(label, schema, userMessage, maxTokens);
    }
  };

  try {
    // ── 1차: 본진 원고 축(본문·FAQ·검증목록·메타) — 2차의 입력이 된다
    const s1 = await runStage(
      "1차(본진)",
      stage1Schema(mode),
      userContent,
      STAGE1_MAX_TOKENS,
      validateStage1,
      (f, r, retried) => {
        timing.stage1_ms = f;
        timing.stage1_retry_ms = r;
        if (retried) timing.retried_stages.push("1차");
      }
    );
    if ("error" in s1) {
      return NextResponse.json({ error: s1.error.message }, { status: s1.error.status });
    }

    // ── 2차: 채널 파생(네이버·블로그스팟·인스타·카드) — 1차 본문을 기준으로
    const s2 = await runStage(
      "2차(채널)",
      STAGE2_SCHEMA,
      stage2Message(s1.data),
      STAGE2_MAX_TOKENS,
      validateStage2,
      (f, r, retried) => {
        timing.stage2_ms = f;
        timing.stage2_retry_ms = r;
        if (retried) timing.retried_stages.push("2차");
      }
    );
    if ("error" in s2) {
      return NextResponse.json({ error: s2.error.message }, { status: s2.error.status });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const article: any = { ...s1.data, ...s2.data };
    const markdownIssues = s1.issues;
    const carouselIssues = s2.issues;
    // 금지 소재는 병합 결과로 최종 재확인(단계별 스캔 + 병합 스캔 — 둘 중 하나라도 걸리면 차단)
    const bannedTerms = [...new Set([...s1.banned, ...s2.banned, ...scanBannedTopics(article)])];

    if (carouselIssues.length > 0) {
      console.warn(`carousel 검증 최종 실패 — 그대로 저장: ${carouselIssues.join(" / ")}`);
      await notifyValidationWarning(String(article.title ?? "(제목 없음)"), "카드", carouselIssues);
    }
    if (markdownIssues.length > 0) {
      console.warn(`본진 원고 검증 최종 실패 — 그대로 저장: ${markdownIssues.join(" / ")}`);
      await notifyValidationWarning(String(article.title ?? "(제목 없음)"), "본진 원고", markdownIssues);
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

    // 문체 게이트(2026-07-23) — 뉴스·상록수 공통. 단계별 재생성(runStage) 후에도 병합 결과에
    // 평서체가 임계를 넘으면 저장하되 사람 검수 강제(컷 아님). 관측은 텔레그램 ✍️ 라인.
    const styleViolations = scanPlainStyle(article);
    if (styleViolations.length > 0) {
      needsHumanReview = true;
      reviewReasons.push(`문체(평서체) 잔존(${formatStyleViolations(styleViolations)})`);
    }

    // 근거 검증 게이트(2026-07-23) — 뉴스·상록수 공통. ⚠️ 재생성 트리거 아님(재생성해도 새 자료 안 나옴).
    // verify_claims의 basis에서 발표연도·증빙 가능성 검사 → violation 1건이라도면 사람 검수 강제. 관측은 텔레그램 📚 라인.
    const evidenceIssues = scanEvidence(article);
    const evidenceViolations = evidenceIssues.filter((e) => e.level === "violation");
    if (evidenceViolations.length > 0) {
      needsHumanReview = true;
      const s = evidenceViolations[0];
      reviewReasons.push(
        `근거 미비(${summarizeEvidence(evidenceViolations)}) — "${(s.claim || "").slice(0, 30)}"`
      );
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
        // excerpt = 목록 미리보기용(2,000자). 검수 대조는 아래 fulltext로 한다 — 잘린 원문으로는
        // 🔴 체크리스트의 "원문과 대조"가 성립하지 않는다.
        raw_source_excerpt: content.trim().slice(0, 2000),
        raw_source_fulltext: (source_fulltext?.trim() || content.trim()) || null,
        main_website_markdown: article.main_website_markdown,
        naver_blog_content: article.naver_blog_content,
        blogspot_content: article.blogspot_content,
        // 카드 자동생성 중단(2026-07-15) — 2차가 carousel_json을 더 내지 않으므로 undefined → null.
        // 컬럼은 nullable 유지. carousel_json is not null 조회 조건 때문에 render-cards가 신규 글을
        // 자연히 건너뛴다. 기존 발행글의 carousel_json은 이 insert가 건드리지 않는다(신규 행만).
        carousel_json: article.carousel_json ?? null,
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
        // 생성물은 항상 초안(false)으로 적재한다.
        // 심의필은 생성 시점에 존재할 수 없다(ad_reviews가 기사 FK를 요구하므로 기사가 먼저다).
        // 따라서 생성 시 발행 분기는 영원히 한쪽으로만 흐르는 죽은 코드이며, 파라미터를 두는 것
        // 자체가 사고 경로다. 발행은 심의 등록 후 /admin에서만 한다.
        // (백스톱: DB 트리거 trg_publish_gate가 BEFORE INSERT까지 커버해 true 삽입도 차단한다.)
        is_main_published: false,
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
      // 문체 위반 필드 — 텔레그램 ✍️ 라인 관측용(재생성 후에도 남은 평서체). 위반 0이면 undefined.
      style_violations: styleViolations.length > 0 ? styleViolations : undefined,
      // 근거 검증 이슈 — 텔레그램 📚 라인 관측용(위반 + durable 관측 모두). 이슈 0이면 undefined.
      evidence_issues: evidenceIssues.length > 0 ? evidenceIssues : undefined,
      usage, // 1·2차 + 재생성 전부 합산
      // ⏱️ 단계별 소요 — 300초 벽에 얼마나 근접했는지, 어느 단계가 재생성을 부르는지 관측용
      timing: { ...timing, total_ms: Date.now() - startedAt },
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
