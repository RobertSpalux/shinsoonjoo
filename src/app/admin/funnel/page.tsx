import type { Metadata } from "next";
import Link from "next/link";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { isFunnelNotifyLive, isFunnelPublic } from "@/lib/funnel/lead";
import FunnelLeadsTable, { type FunnelLeadRow } from "@/components/admin/FunnelLeadsTable";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "퍼널 리드", robots: { index: false, follow: false } };

export default async function AdminFunnelPage() {
  if (!(await isAdminAuthed())) {
    return (
      <main className="mx-auto max-w-xl px-5 pt-32 text-sm text-[var(--color-text-body)]">
        관리자 로그인이 필요합니다. <Link href="/admin" className="underline">/admin</Link>
      </main>
    );
  }

  let rows: FunnelLeadRow[] = [];
  let loadError = "";
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("funnel_leads")
      .select(
        "id, created_at, name, phone, age_band, interests, message, utm_source, utm_campaign, status, status_changed_at, memo, lost_reason, is_qualified, purge_after"
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) loadError = error.message;
    rows = (data ?? []) as FunnelLeadRow[];
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="mx-auto max-w-6xl px-5 pb-24 pt-24">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold text-[var(--color-forest)]">보험 리모델링 진단 — 리드</h1>
        <p className="text-xs text-[var(--color-text-muted)]">
          랜딩 {isFunnelPublic() ? "공개" : "비공개(관리자 미리보기)"} · 알림 {isFunnelNotifyLive() ? "실발송" : "드라이런"} ·{" "}
          <Link href="/remodeling-check" className="underline">랜딩 보기</Link>
        </p>
      </div>
      {loadError ? (
        <p className="text-sm text-red-700">불러오기 실패: {loadError} (sql/007_funnel_leads.sql 적용 여부 확인)</p>
      ) : (
        <FunnelLeadsTable initialRows={rows} />
      )}
    </main>
  );
}
