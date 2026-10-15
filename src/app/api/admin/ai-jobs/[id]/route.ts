import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getAiJob } from "@/lib/ai-jobs";

/** AI 작업 상태(어드민 폴링용) — API2. 결과는 종전 route 응답 본문 그대로 result 에 담겨 있다. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const job = await getAiJob(id);
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
}
