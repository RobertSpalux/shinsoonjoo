import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { parseFactoryRequest, seedDuplicateError } from "@/lib/factory-pipeline";
import { enqueueAiJob } from "@/lib/ai-jobs";

/**
 * OSMU 콘텐츠 팩토리 — 큐 적재 입구.
 * 인풋: { title?, category?, source_url, source_name, content, source_fulltext?, mode?, seed? }
 * 인증: x-factory-secret 헤더 (GitHub Actions 크론 전용).
 *
 * API2(2026-10-15): 이 서버는 생성하지 않는다(유료 API 정지 — 구독 `claude -p`는 로컬 PC 에서만 돈다).
 * 입력 검사·상록수 seed_key 중복 선차단(종전 그대로)만 하고 ai_jobs 에 queued 로 넣어 job id 를 돌려준다(202).
 * 생성·검증·게이트·premium_articles 초안 적재는 로컬 러너(scripts/ai_job_runner.py → src/lib/factory-pipeline.ts)가 하고,
 * 호출자는 /api/factory/jobs/<id> 를 폴링해 종전과 같은 응답 본문(result)·상태(result_status)를 받는다.
 * 발행 통제: 생성은 항상 초안이다. 발행은 심의 등록 후 /admin에서만 한다.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-factory-secret");
  if (!process.env.FACTORY_SECRET || secret !== process.env.FACTORY_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 JSON 요청" }, { status: 400 });
  }

  const parsed = parseFactoryRequest(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  // 상록수: seed_key 중복 선차단 (unique index — 대기열에 넣기 전에 걸러낸다)
  if (parsed.request.seed) {
    const dup = await seedDuplicateError(createAdminClient(), parsed.request.seed.key);
    if (dup) return NextResponse.json({ error: dup }, { status: 409 });
  }

  const jobId = await enqueueAiJob("factory_generate", parsed.request);
  if (!jobId) {
    return NextResponse.json({ error: "대기열 저장 실패" }, { status: 500 });
  }
  return NextResponse.json({ success: true, queued: true, job_id: jobId }, { status: 202 });
}
