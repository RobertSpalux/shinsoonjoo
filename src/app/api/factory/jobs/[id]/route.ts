import { NextResponse } from "next/server";
import { getAiJob } from "@/lib/ai-jobs";

/**
 * 팩토리 작업 상태(크론 스크립트 폴링용) — API2. 인증: x-factory-secret.
 * done 이면 result = 종전 /api/factory/generate 응답 본문, result_status = 종전 HTTP 상태.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const secret = request.headers.get("x-factory-secret");
  if (!process.env.FACTORY_SECRET || secret !== process.env.FACTORY_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const job = await getAiJob(id, "factory_generate");
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
}
