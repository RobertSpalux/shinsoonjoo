import { createAdminClient } from "./supabase-admin";

/**
 * AI 생성 작업 큐(sql/008_ai_jobs.sql) — API2 2026-10-15.
 * Vercel 서버는 생성하지 않는다(유료 API 정지·구독은 로컬 PC 에서만 돈다).
 * route 는 행을 넣고 id 를 돌려주며, 생성은 로컬 러너(scripts/ai_job_runner.py)가 한다.
 */
export const AI_JOB_KINDS = ["kin_draft", "factory_generate"] as const;
export type AiJobKind = (typeof AI_JOB_KINDS)[number];
export type AiJobStatus = "queued" | "running" | "done" | "error";

export type AiJobView = {
  id: string;
  kind: AiJobKind;
  status: AiJobStatus;
  /** 종전 route 응답 본문 그대로 */
  result: Record<string, unknown> | null;
  /** 종전 HTTP 상태 */
  result_status: number | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

/** 화면이 「PC 꺼짐 — 대기열에 남음」을 띄우는 기준(queued 로 남아 있는 시간) */
export const RUNNER_OFFLINE_MS = 60_000;

export async function enqueueAiJob(kind: AiJobKind, payload: Record<string, unknown>) {
  const { data, error } = await createAdminClient()
    .from("ai_jobs")
    .insert({ kind, payload })
    .select("id")
    .single();
  if (error || !data) {
    console.error("ai_jobs insert error:", error);
    return null;
  }
  return data.id as string;
}

export async function getAiJob(id: string, kind?: AiJobKind): Promise<AiJobView | null> {
  let q = createAdminClient()
    .from("ai_jobs")
    .select("id, kind, status, result, result_status, error, created_at, started_at, finished_at")
    .eq("id", id);
  if (kind) q = q.eq("kind", kind);
  const { data } = await q.maybeSingle();
  return (data as AiJobView | null) ?? null;
}
