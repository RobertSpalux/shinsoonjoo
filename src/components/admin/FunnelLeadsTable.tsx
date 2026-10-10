"use client";

import { Fragment, useState } from "react";
import { LEAD_STATUSES, maskName, maskPhone, type LeadStatus } from "@/lib/funnel/lead";

export interface FunnelLeadRow {
  id: string;
  created_at: string;
  name: string;
  phone: string;
  age_band: string;
  interests: string[];
  message: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  status: LeadStatus;
  status_changed_at: string;
  memo: string | null;
  lost_reason: string | null;
  is_qualified: boolean;
  purge_after: string;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

function phoneLabel(d: string) {
  return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** 목록은 이름·번호를 가린다. 「보기」로 펼친 행만 원문 표시(어깨너머·화면공유 노출 최소화). */
export default function FunnelLeadsTable({ initialRows }: { initialRows: FunnelLeadRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function save(id: string, fields: Partial<Pick<FunnelLeadRow, "status" | "memo" | "lost_reason">>) {
    const prev = rows;
    // 서버와 같은 규칙: 상담·계약 도달 = 유효 상담
    const qualified = fields.status === "상담" || fields.status === "계약";
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...fields, is_qualified: r.is_qualified || qualified } : r)));
    const res = await fetch("/api/admin/funnel/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...fields }),
    }).catch(() => null);
    if (!res?.ok) {
      setRows(prev);
      setErr("저장 실패 — 다시 시도해 주세요.");
    } else setErr("");
  }

  const counts = LEAD_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length] as const);

  return (
    <div>
      <p className="mb-4 text-xs text-[var(--color-text-muted)] tabular-nums">
        {counts.map(([s, n]) => `${s} ${n}`).join(" · ")} · 유효 상담 {rows.filter((r) => r.is_qualified).length}
      </p>
      {err && <p className="mb-3 text-sm text-red-700">{err}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">아직 신청이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-[var(--color-line)] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-text-muted)]">
                <th className="px-3 py-2 font-medium">접수</th>
                <th className="px-3 py-2 font-medium">이름</th>
                <th className="px-3 py-2 font-medium">연락처</th>
                <th className="px-3 py-2 font-medium">연령대·관심</th>
                <th className="px-3 py-2 font-medium">유입</th>
                <th className="px-3 py-2 font-medium">상태</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const shown = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className="border-b border-[var(--color-line)] align-top">
                      <td className="px-3 py-2 tabular-nums">{fmt(r.created_at)}</td>
                      <td className="px-3 py-2">{shown ? r.name : maskName(r.name)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {shown ? <a href={`tel:${r.phone}`} className="underline">{phoneLabel(r.phone)}</a> : maskPhone(r.phone)}
                      </td>
                      <td className="px-3 py-2">
                        {r.age_band} · {r.interests.join(", ")}
                      </td>
                      <td className="px-3 py-2 text-xs">{[r.utm_source, r.utm_campaign].filter(Boolean).join(" / ") || "직접"}</td>
                      <td className="px-3 py-2">
                        <select
                          aria-label="상태"
                          value={r.status}
                          onChange={(e) => save(r.id, { status: e.target.value as LeadStatus })}
                          className="rounded-sm border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
                        >
                          {LEAD_STATUSES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setOpen(shown ? null : r.id)} className="text-xs underline">
                          {shown ? "닫기" : "보기"}
                        </button>
                      </td>
                    </tr>
                    {shown && (
                      <tr className="border-b border-[var(--color-line)] bg-[var(--color-ink-soft)]">
                        <td colSpan={7} className="space-y-2 px-3 py-3 text-xs">
                          {r.message && <p className="whitespace-pre-line">남긴 말씀: {r.message}</p>}
                          <label className="block">
                            메모
                            <textarea
                              defaultValue={r.memo ?? ""}
                              onBlur={(e) => e.target.value !== (r.memo ?? "") && save(r.id, { memo: e.target.value })}
                              rows={2}
                              className="mt-1 w-full rounded-sm border border-[var(--color-line)] bg-white p-2"
                            />
                          </label>
                          {r.status === "불발" && (
                            <label className="block">
                              불발 사유
                              <input
                                defaultValue={r.lost_reason ?? ""}
                                onBlur={(e) => e.target.value !== (r.lost_reason ?? "") && save(r.id, { lost_reason: e.target.value })}
                                className="mt-1 w-full rounded-sm border border-[var(--color-line)] bg-white p-2"
                              />
                            </label>
                          )}
                          <p className="text-[var(--color-text-muted)]">파기 예정 {fmt(r.purge_after)}</p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
