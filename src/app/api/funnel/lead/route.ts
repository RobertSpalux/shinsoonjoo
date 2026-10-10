import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { BRAND } from "@/lib/brand";
import { buildLeadAlert, isFunnelPublic, validateLead } from "@/lib/funnel/lead";
import { notifyFunnelLead } from "@/lib/funnel/notify";

/**
 * 「보험 리모델링 진단」 신청 접수 (퍼널 v1).
 * 공개 스위치 OFF 동안은 관리자 쿠키가 있을 때만 받는다(내부 시험용).
 * funnel_leads 는 RLS 정책이 없어 service_role(서버)로만 쓴다 — 브라우저 anon 키로는 읽기·쓰기 불가.
 */
export async function POST(request: Request) {
  if (!isFunnelPublic() && !(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const v = validateLead(body);
  if (!v.ok) {
    // 허니팟은 성공처럼 응답해 봇이 재시도하지 않게 한다(저장·알림 없음)
    if (v.spam) return NextResponse.json({ success: true });
    return NextResponse.json({ error: v.error }, { status: 400 });
  }
  const lead = v.lead;

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
  }

  // 같은 번호 24시간 내 재신청은 새 행을 만들지 않는다(중복 알림·중복 집계 방지)
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: dup } = await supabase
    .from("funnel_leads")
    .select("id")
    .eq("phone", lead.phone)
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();
  if (dup) return NextResponse.json({ success: true });

  const { data: row, error } = await supabase
    .from("funnel_leads")
    .insert({ ...lead, privacy_collect_agreed: true })
    .select("id")
    .single();
  if (error || !row) {
    console.error("funnel_leads insert error:", error);
    return NextResponse.json({ error: "신청 저장에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }

  await supabase.from("funnel_lead_events").insert({
    lead_id: row.id,
    from_status: null,
    to_status: "신청",
    utm_source: lead.utm_source,
    utm_campaign: lead.utm_campaign,
  });

  await notifyFunnelLead(buildLeadAlert(lead, row.id, BRAND.siteUrl));

  return NextResponse.json({ success: true });
}
