import type { SupabaseClient } from "@supabase/supabase-js";
import {
  factorySystemPrompt,
  evergreenSystemPrompt,
  scanBannedTopics,
  stage1Schema,
  STAGE2_SCHEMA,
  type EvergreenSeed,
} from "./factory-prompt";
import { scanPlainStyle, formatStyleViolations, type StyleViolation } from "./style-gate";
import { scanEvidence, summarizeEvidence } from "./evidence-gate";
import { defaultDb, type JobOutcome } from "./ai-job-kin";

/**
 * OSMU 콘텐츠 팩토리 — 생성 본체. API2 2026-10-15.
 * 종전 /api/factory/generate 가 서버에서 하던 일 그대로(검증·게이트·적재)이되,
 * 생성기만 바깥에서 받는다 — 로컬 러너(scripts/ai_job_worker.mts)가 `claude -p`(구독)로 넘긴다.
 * route 는 입력 검사(parseFactoryRequest)와 큐 적재만 한다.
 *
 * 원천 뉴스 1건 → 4개 채널 원고 + FAQ 를 2단계(본진 → 채널 파생) JSON 출력으로 생성 → premium_articles 초안 적재.
 */

export type FactoryRequest = {
  title?: string;
  category?: string;
  source_url?: string;
  source_name?: string;
  content: string;
  /** 검수 대조용 원문 전문(무절단) — 미지정 시 content로 폴백 */
  source_fulltext?: string;
  /** 커밋 M2 — 미지정 = 'news' = 현행 그대로 */
  mode: "news" | "evergreen";
  seed?: EvergreenSeed;
};

export type StageUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};
export type StageResult =
  | { error: { status: number; message: string } }
  | { data: Record<string, unknown>; usage?: StageUsage };

/** 단계 1회 생성 — system·user·출력 스키마를 받아 JSON 객체 하나를 돌려준다 */
export type StageGenerator = (req: {
  label: string;
  system: string;
  schema: unknown;
  user: string;
}) => Promise<StageResult>;

/** route 입력 검사 + 상록수 시드 정규화(종전 route 그대로). 통과하면 큐에 넣을 요청 */
export function parseFactoryRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
): { request: FactoryRequest } | { status: number; error: string } {
  const { title, category, source_url, source_name, content, source_fulltext, mode = "news", seed } = body ?? {};
  if (mode !== "news" && mode !== "evergreen") {
    return { status: 400, error: "mode는 'news' | 'evergreen'만 허용됩니다." };
  }
  if (typeof content !== "string" || !content.trim()) {
    return { status: 400, error: "content(원천 자료)가 필요합니다." };
  }
  let evergreenSeed: EvergreenSeed | undefined;
  if (mode === "evergreen") {
    if (!seed?.key?.trim() || !seed?.title?.trim()) {
      return { status: 400, error: "evergreen 모드에는 seed.key와 seed.title이 필요합니다." };
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
  }
  return {
    request: {
      title,
      category,
      source_url,
      source_name,
      content,
      source_fulltext,
      mode,
      ...(evergreenSeed ? { seed: evergreenSeed } : {}),
    },
  };
}

/** 상록수 seed_key 중복(unique index) — 토큰 쓰기 전에 걸러낸다. 중복이면 409 문구 */
export async function seedDuplicateError(db: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await db.from("premium_articles").select("id, slug").eq("seed_key", key).maybeSingle();
  return data ? `이미 생성된 시드입니다(seed_key=${key}, slug=${data.slug})` : null;
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

/** 텔레그램 알림 (best-effort — env 없으면 조용히 스킵) */
async function telegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
  }).catch(() => undefined);
}

/** 금지 소재 하드 게이트 발동 알림 (커밋 O1) */
async function notifyBannedBlocked(title: string, terms: string[], sourceUrl?: string) {
  await telegram(
    [`⚠️ 금지 소재 감지: ${terms.join("·")} — 저장하지 않음, 소스 차단목록 등록됨`, title, sourceUrl ? `소스: ${sourceUrl}` : ""]
      .filter(Boolean)
      .join("\n")
  );
}

/** 검증 최종 실패 시 텔레그램 플래그 */
async function notifyValidationWarning(title: string, kind: string, issues: string[]) {
  await telegram(`⚠️ ${kind} 검증 실패(재시도 후에도) — 저장은 됨, /admin에서 확인 필요\n${title}\n· ${issues.join("\n· ")}`);
}

/** 일화 날조 의심 플래그 알림 (일화뱅크 — 뉴스 모드 전용) */
async function notifyAnecdoteFlag(title: string) {
  await telegram(`⚠️ 일화 날조 의심('특정 시점+특정 고객' 서사 감지) — needs_human_review 플래그, /admin에서 확인\n${title}`);
}

export async function runFactory(
  req: FactoryRequest,
  generate: StageGenerator,
  injected?: SupabaseClient
): Promise<JobOutcome> {
  const db = injected ?? (await defaultDb());
  const { title, category, source_url, source_name, content, source_fulltext, mode } = req;
  const evergreenSeed = mode === "evergreen" ? (req.seed ?? null) : null;

  // 큐에서 기다리는 사이 같은 시드가 생겼을 수 있다 — 생성 직전에 다시 본다
  if (evergreenSeed) {
    const dup = await seedDuplicateError(db, evergreenSeed.key);
    if (dup) return { status: 409, body: { error: dup } };
  }

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

  // system 프롬프트는 1·2차가 동일한 문자열을 재사용한다(프롬프트 텍스트는 바꾸지 않는다).
  const systemPrompt = evergreenSeed ? evergreenSystemPrompt(evergreenSeed) : factorySystemPrompt();

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

  // ⏱️ 소요시간 계측
  const timing = {
    stage1_ms: 0,
    stage1_retry_ms: 0,
    stage2_ms: 0,
    stage2_retry_ms: 0,
    retried_stages: [] as string[],
    total_ms: 0,
  };
  // 구독(`claude -p`)은 토큰 사용량을 돌려주지 않는다 — 생성기가 주면 합산, 아니면 0(응답 모양은 종전 그대로)
  const usage: StageUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  const addUsage = (u?: StageUsage) => {
    if (!u) return;
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
  // carousel_json 제거(2026-07-15) — 2차 파생에는 별도 구조 검증이 없다. 금지어 스캔은 runStage 안에서 돈다.
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validate: (a: any) => string[],
    onTiming: (firstMs: number, retryMs: number, retried: boolean) => void
  ): Promise<
    | { error: { status: number; message: string } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | { data: any; issues: string[]; banned: string[]; style: StyleViolation[] }
  > => {
    const once = () => generate({ label, system: systemPrompt, schema, user: userMessage });
    const t0 = Date.now();
    const first = await once();
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
    let banned = scanBannedTopics(data);
    let style = scanPlainStyle(data);
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
        const retry = await once();
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
  };

  try {
    // ── 1차: 본진 원고 축(본문·FAQ·검증목록·메타) — 2차의 입력이 된다
    const s1 = await runStage("1차(본진)", stage1Schema(mode), userContent, validateStage1, (f, r, retried) => {
      timing.stage1_ms = f;
      timing.stage1_retry_ms = r;
      if (retried) timing.retried_stages.push("1차");
    });
    if ("error" in s1) return { status: s1.error.status, body: { error: s1.error.message } };

    // ── 2차: 채널 파생(네이버·블로그스팟·인스타) — 1차 본문을 기준으로
    const s2 = await runStage("2차(채널)", STAGE2_SCHEMA, stage2Message(s1.data), validateStage2, (f, r, retried) => {
      timing.stage2_ms = f;
      timing.stage2_retry_ms = r;
      if (retried) timing.retried_stages.push("2차");
    });
    if ("error" in s2) return { status: s2.error.status, body: { error: s2.error.message } };

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
      if (source_url) {
        const { error: blockErr } = await db
          .from("blocked_sources")
          .upsert({ url: source_url, reason: "금지소재" }, { onConflict: "url" });
        if (blockErr) console.error("blocked_sources 등록 실패:", blockErr);
      }
      await notifyBannedBlocked(String(article.title ?? title ?? "(제목 없음)"), bannedTerms, source_url ?? undefined);
      return {
        status: 422,
        body: { error: `금지 소재 감지(${bannedTerms.join("·")}) — 저장하지 않음`, blocked: true },
      };
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

    // 문체 게이트(2026-07-23) — 병합 결과에 평서체가 임계를 넘으면 저장하되 사람 검수 강제(컷 아님).
    const styleViolations = scanPlainStyle(article);
    if (styleViolations.length > 0) {
      needsHumanReview = true;
      reviewReasons.push(`문체(평서체) 잔존(${formatStyleViolations(styleViolations)})`);
    }

    // 근거 검증 게이트(2026-07-23) — ⚠️ 재생성 트리거 아님(재생성해도 새 자료 안 나옴).
    const evidenceIssues = scanEvidence(article);
    const evidenceViolations = evidenceIssues.filter((e) => e.level === "violation");
    if (evidenceViolations.length > 0) {
      needsHumanReview = true;
      const s = evidenceViolations[0];
      reviewReasons.push(`근거 미비(${summarizeEvidence(evidenceViolations)}) — "${(s.claim || "").slice(0, 30)}"`);
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

    // 검증 항목 = 모델 자가 신고(상록수) + 고위험 주제 자동 항목(공통). 자동 항목은 confidence=low.
    const modelClaims = Array.isArray(article.verify_claims) ? article.verify_claims : [];
    const autoClaims = riskHits.map((hit) => ({
      claim: hit.check,
      basis: `고위험 주제 자동 감지: ${hit.tokens.join("·")}`,
      confidence: "low",
    }));
    const verifyClaims = [...modelClaims, ...autoClaims];

    // slug 중복 방지 — 이미 있으면 날짜 접미사
    const { data: existing } = await db.from("premium_articles").select("id").eq("slug", article.slug).maybeSingle();
    const slug = existing ? `${article.slug}-${new Date().toISOString().slice(0, 10)}` : article.slug;

    const { data: inserted, error: dbError } = await db
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
        // excerpt = 목록 미리보기용(2,000자). 검수 대조는 아래 fulltext로 한다.
        raw_source_excerpt: content.trim().slice(0, 2000),
        raw_source_fulltext: (source_fulltext?.trim() || content.trim()) || null,
        main_website_markdown: article.main_website_markdown,
        naver_blog_content: article.naver_blog_content,
        blogspot_content: article.blogspot_content,
        // 카드 자동생성 중단(2026-07-15) — undefined → null. render-cards가 신규 글을 자연히 건너뛴다.
        carousel_json: article.carousel_json ?? null,
        faq_json: article.faq_json,
        // 상록수 전용 컬럼 — 뉴스 insert는 기존과 동일(DB 디폴트 content_type='news')
        ...(evergreenSeed ? { content_type: "evergreen", seed_key: evergreenSeed.key } : {}),
        verify_claims: verifyClaims.length > 0 ? verifyClaims : null,
        needs_human_review: needsHumanReview,
        // 생성물은 항상 초안(false)으로 적재한다. 발행은 심의 등록 후 /admin에서만 한다.
        // (백스톱: DB 트리거 trg_publish_gate가 BEFORE INSERT까지 커버해 true 삽입도 차단한다.)
        is_main_published: false,
        // 초안이어도 published_at은 생성 시각으로 기록(정렬용). 노출 게이트는 is_main_published를 함께 본다.
        published_at: new Date().toISOString(),
      })
      .select("id, slug, title, category")
      .single();

    if (dbError) {
      console.error("premium_articles insert error:", dbError);
      return { status: 500, body: { error: "DB 적재 실패" } };
    }

    return {
      status: 200,
      body: {
        success: true,
        article: inserted,
        carousel_warning: carouselIssues.length > 0 ? carouselIssues.join(" / ") : undefined,
        markdown_warning: markdownIssues.length > 0 ? markdownIssues.join(" / ") : undefined,
        needs_human_review: needsHumanReview,
        review_reasons: reviewReasons.length > 0 ? reviewReasons.join(" / ") : undefined,
        high_risk_topics: riskTokens.length > 0 ? riskTokens : undefined,
        style_violations: styleViolations.length > 0 ? styleViolations : undefined,
        evidence_issues: evidenceIssues.length > 0 ? evidenceIssues : undefined,
        usage,
        timing: { ...timing, total_ms: Date.now() - startedAt },
      },
    };
  } catch (err) {
    console.error("Factory error:", err);
    return { status: 500, body: { error: "서버 오류" } };
  }
}
