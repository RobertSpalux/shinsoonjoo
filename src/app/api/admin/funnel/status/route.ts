import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { isLeadStatus } from "@/lib/funnel/lead";

/**
 * 퍼널 리드 상태·메모 변경 (관리자 전용).
 * 상태가 바뀌면 funnel_lead_events 에 단계 기록을 남긴다 — 리드 파기 후에도 퍼널 통계가 남는다.
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, status, memo, lost_reason, is_qualified } = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (status !== undefined) {
    if (!isLeadStatus(status)) return NextResponse.json({ error: "알 수 없는 상태" }, { status: 400 });
    patch.status = status;
    patch.status_changed_at = new Date().toISOString();
    // 상담 단계 이상에 도달하면 유효 상담으로 본다(되돌려도 기록은 유지 — 수동 해제는 is_qualified=false)
    if (status === "상담" || status === "계약") patch.is_qualified = true;
  }
  if (typeof memo === "string") patch.memo = memo.slice(0, 1000);
  if (typeof lost_reason === "string") patch.lost_reason = lost_reason.slice(0, 200);
  if (typeof is_qualified === "boolean") patch.is_qualified = is_qualified;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "수정 가능한 필드가 없습니다." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: before } = await supabase
    .from("funnel_leads")
    .select("status, utm_source, utm_campaign")
    .eq("id", id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: "없는 리드" }, { status: 404 });

  const { error } = await supabase.from("funnel_leads").update(patch).eq("id", id);
  if (error) {
    console.error("funnel status update error:", error);
    return NextResponse.json({ error: "수정 실패" }, { status: 500 });
  }

  if (patch.status && patch.status !== before.status) {
    await supabase.from("funnel_lead_events").insert({
      lead_id: id,
      from_status: before.status,
      to_status: patch.status,
      utm_source: before.utm_source,
      utm_campaign: before.utm_campaign,
    });
  }

  return NextResponse.json({ success: true });
}
