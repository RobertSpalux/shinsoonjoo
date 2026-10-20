"use client";

import { useMemo } from "react";
import { convTotal, pivot, rankArrow, type IndexRow } from "@/lib/content-index";

/**
 * 「유입 지수」 탭(IX1) — 글 × 주차. 측정은 로컬 크론(scripts/content_index_weekly.py, 월 08:00)이 하고 여기선 읽기만.
 * 셀 = 네이버 블로그탭 순위(전주 대비 화살표) + 본진 GSC 노출·클릭. 판정은 최신 주 기준.
 */

const VERDICT_BADGE: Record<string, string> = {
  "갱신 대상": "border-red-300 bg-red-50 text-red-700",
  "보강 대상": "border-amber-300 bg-amber-50 text-amber-700",
  "제목·설명 개선 대상": "border-sky-300 bg-sky-50 text-sky-700",
};

const measured = (r: IndexRow | null) => r != null && r.naver_blog_n != null;

function RankCell({ cur, prev }: { cur: IndexRow | null; prev: IndexRow | null }) {
  if (!cur) return <span className="text-slate-300">·</span>;
  const a = measured(cur) && measured(prev) ? rankArrow(cur.naver_blog_rank, prev!.naver_blog_rank) : "";
  return (
    <div className="leading-tight">
      {measured(cur) ? (
        <span className={`font-bold tabular-nums ${cur.naver_blog_rank == null ? "text-red-600" : "text-slate-800"}`}>
          {cur.naver_blog_rank == null ? "밖" : `${cur.naver_blog_rank}위`}
          {a && <span className={`ml-1 text-[10px] ${a.startsWith("▲") ? "text-emerald-600" : a.startsWith("▼") ? "text-red-600" : "text-slate-400"}`}>{a}</span>}
        </span>
      ) : (
        <span className="text-slate-300">—</span>
      )}
      {cur.gsc_impressions != null && (
        <div className="text-[10px] tabular-nums text-slate-500">
          노출 {cur.gsc_impressions} · 클릭 {cur.gsc_clicks ?? 0}
        </div>
      )}
    </div>
  );
}

export default function ContentIndexTab({
  rows,
  error,
  labels,
}: {
  rows: IndexRow[];
  error: string | null;
  labels: Record<string, string>;
}) {
  const { weeks, lines } = useMemo(() => pivot(rows), [rows]);

  if (error) {
    return (
      <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        유입 지수 표를 읽지 못했습니다 — {error}. sql/009_content_index.sql 적용 전이면 정상입니다.
      </p>
    );
  }
  if (lines.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--color-line)] bg-white px-4 py-3 text-sm text-slate-500">
        아직 측정 기록이 없습니다. 매주 월 08:00 로컬 크론(scripts/content_index_weekly.py --save --send)이 지난주를 잽니다.
      </p>
    );
  }

  const latest = weeks[0];
  const counts = (v: string) => lines.filter((l) => l.cells[0]?.verdicts?.includes(v)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="font-semibold">최신 {latest} 주</span>
        {Object.keys(VERDICT_BADGE).map((v) => (
          <span key={v} className={`rounded border px-2 py-0.5 ${VERDICT_BADGE[v]}`}>
            {v} {counts(v)}
          </span>
        ))}
        <span className="text-slate-400">판정: 블로그탭 30위 밖 = 갱신 · 4~15위 = 보강 · 본진 노출 있는데 클릭 0 = 제목·설명</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--color-line)] bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left text-[11px] text-slate-500">
              <th className="px-3 py-2 font-medium">글 · 핵심 검색어</th>
              {weeks.map((w) => (
                <th key={w} className="px-3 py-2 font-medium tabular-nums">{w.slice(5)}</th>
              ))}
              <th className="px-3 py-2 font-medium">통합검색</th>
              <th className="px-3 py-2 font-medium">세션 · 전환</th>
              <th className="px-3 py-2 font-medium">판정</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const c0 = l.cells[0];
              const q = c0?.gsc_top_queries?.[0];
              return (
                <tr key={l.slug} className="border-b border-[var(--color-line)] align-top last:border-0">
                  <td className="max-w-[18rem] px-3 py-2">
                    <p className="font-medium text-slate-800">{labels[l.slug] ?? l.slug}</p>
                    <p className="text-[10px] text-slate-500">
                      「{l.latest.keyword ?? "-"}」{l.latest.keyword_source === "auto" && <span className="ml-1 text-amber-600">auto</span>}
                      {q && <span className="ml-2">GSC 1위 검색어 「{q.query}」 {q.impressions}</span>}
                    </p>
                  </td>
                  {l.cells.map((c, i) => (
                    <td key={weeks[i]} className="px-3 py-2">
                      <RankCell cur={c} prev={l.cells[i + 1] ?? null} />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-[11px] text-slate-600">
                    {c0 && measured(c0) ? `블로그 ${c0.naver_integ_blog ? "O" : "X"} · 본진 ${c0.naver_integ_main ? "O" : "X"}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-[11px] tabular-nums text-slate-600">
                    {c0?.ga_sessions != null ? `${c0.ga_sessions} · ${convTotal(c0)}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      {(c0?.verdicts ?? []).map((v) => (
                        <span key={v} className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] ${VERDICT_BADGE[v] ?? ""}`}>{v}</span>
                      ))}
                      {c0?.errors && Object.keys(c0.errors).length > 0 && (
                        <span className="text-[10px] text-slate-400">조회 실패: {Object.keys(c0.errors).join(", ")}</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
