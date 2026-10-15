import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { parseKinPayload } from "@/lib/ai-job-kin";
import { enqueueAiJob } from "@/lib/ai-jobs";

/**
 * 지식iN 답변 초안 생성 — 커밋 P2. 반자동 어시스트 전용.
 * ⚠️ 네이버 게시는 이 라우트가 하지 않는다 — 100% 사람이 수동(어뷰징 제재 방지).
 *
 * API2(2026-10-15): 이 서버는 생성하지 않는다(유료 API 정지 — 구독 `claude -p`는 로컬 PC 에서만 돈다).
 * 입력을 검사해 ai_jobs 에 queued 로 넣고 job id 를 돌려준다. 로컬 러너(scripts/ai_job_runner.py)가
 * 생성(src/lib/ai-job-kin.ts)해 kin_answers 에 '초안'으로 저장하고, 화면은 /api/admin/ai-jobs/<id> 를 폴링한다.
 * 상태 변경(게시완료/채택됨/폐기)·posted_at 기록은 /api/admin/update 경유.
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 JSON 요청" }, { status: 400 });
  }

  const parsed = parseKinPayload(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // 연결 글이 없으면 바로 알린다(러너까지 기다리게 하지 않는다)
  if (parsed.payload.linked_article_id) {
    const { data: article } = await createAdminClient()
      .from("premium_articles")
      .select("id")
      .eq("id", parsed.payload.linked_article_id)
      .maybeSingle();
    if (!article) {
      return NextResponse.json({ error: "연결 글을 찾을 수 없습니다." }, { status: 400 });
    }
  }

  const jobId = await enqueueAiJob("kin_draft", parsed.payload);
  if (!jobId) {
    return NextResponse.json({ error: "대기열 저장 실패" }, { status: 500 });
  }
  return NextResponse.json({ success: true, queued: true, job_id: jobId }, { status: 202 });
}
