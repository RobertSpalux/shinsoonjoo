import type { SupabaseClient } from "@supabase/supabase-js";
import { kinAnswerSystemPrompt } from "./factory-prompt";

/** 기본 DB = service_role 클라이언트. 주입받으면(시험) 불러오지 않는다 */
export async function defaultDb(): Promise<SupabaseClient> {
  return (await import("./supabase-admin")).createAdminClient();
}

/**
 * 지식iN 답변 초안(어드민 「초안 생성」) — 생성 본체. API2 2026-10-15.
 * 종전 /api/admin/kin 이 서버에서 하던 일 그대로이되, 생성기만 바깥에서 받는다(로컬 `claude -p`).
 * ⚠️ 네이버 게시는 하지 않는다 — 100% 사람이 수동(어뷰징 제재 방지). kin_answers 에 '초안'으로만.
 */
export type TextGenerator = (prompt: string) => Promise<{ text?: string; error?: string }>;
export type JobOutcome = { status: number; body: Record<string, unknown> };

export type KinJobPayload = {
  question_url: string;
  question_title: string;
  question_body: string;
  linked_article_id?: string;
  linked_article_url?: string;
};

/** route 입력 검사 — 통과하면 정리된 payload, 아니면 오류 문구 */
export function parseKinPayload(body: Partial<Record<keyof KinJobPayload, unknown>>):
  | { payload: KinJobPayload }
  | { error: string } {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const question_url = s(body.question_url);
  const question_title = s(body.question_title);
  const question_body = s(body.question_body);
  if (!question_url || !question_title || !question_body) {
    return { error: "질문 URL·제목·본문이 모두 필요합니다." };
  }
  return {
    payload: {
      question_url,
      question_title,
      question_body,
      ...(s(body.linked_article_id) ? { linked_article_id: s(body.linked_article_id) } : {}),
      ...(s(body.linked_article_url) ? { linked_article_url: s(body.linked_article_url) } : {}),
    },
  };
}

/** 종전 system + user 를 한 덩어리 프롬프트로(내용은 그대로) */
export function buildKinJobPrompt(
  p: KinJobPayload,
  linked: { title: string; naverUrl: string } | undefined,
  linkedContext: string
): string {
  return [
    kinAnswerSystemPrompt(linked),
    "",
    "──────────",
    "아래 지식iN 질문에 대한 답변 초안을 작성하라.",
    "",
    `질문 제목: ${p.question_title}`,
    "질문 본문:",
    p.question_body.slice(0, 4000),
    linkedContext,
    "",
    "파일을 읽거나 쓰지 말고 도구도 쓰지 마라. 답변 본문만 출력한다(머리말·설명·코드펜스 없이).",
  ].join("\n");
}

export async function runKinDraft(
  p: KinJobPayload,
  generate: TextGenerator,
  injected?: SupabaseClient
): Promise<JobOutcome> {
  const db = injected ?? (await defaultDb());
  // 연결 글 — 링크는 관리자가 URL을 함께 입력한 경우에만 답변에 들어간다
  let linked: { title: string; naverUrl: string } | undefined;
  let linkedContext = "";
  if (p.linked_article_id) {
    const { data: article } = await db
      .from("premium_articles")
      .select("title, naver_title, summary, key_points")
      .eq("id", p.linked_article_id)
      .maybeSingle();
    if (!article) {
      return { status: 400, body: { error: "연결 글을 찾을 수 없습니다." } };
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
    if (p.linked_article_url) {
      linked = { title, naverUrl: p.linked_article_url };
    }
  }

  const r = await generate(buildKinJobPrompt(p, linked, linkedContext));
  const draft = (r.text ?? "").trim();
  if (!draft) {
    return { status: 502, body: { error: r.error ? `AI 생성 실패 — ${r.error}` : "빈 응답" } };
  }

  const { data: inserted, error: dbError } = await db
    .from("kin_answers")
    .insert({
      question_url: p.question_url,
      question_title: p.question_title,
      question_body: p.question_body,
      answer_draft: draft,
      linked_article_id: p.linked_article_id ?? null,
    })
    .select("id, question_url, question_title, question_body, answer_draft, linked_article_id, status, created_at, posted_at")
    .single();
  if (dbError) {
    console.error("kin_answers insert error:", dbError);
    return { status: 500, body: { error: "DB 저장 실패" } };
  }
  return { status: 200, body: { success: true, answer: inserted } };
}
