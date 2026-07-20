"use client";

import { useState } from "react";
import type { CheckResult, Finding } from "@/lib/compliance/banned-terms";

/**
 * 컴플라이언스 검사 모달 (§6.10) — 필드별 적발 구간 하이라이트 + 대체 표현 제안.
 * A(적색)=차단, B(황색)=문맥 의존 → 항목마다 [확인함] 체크(compliance_acks에 기록).
 */

const FIELD_LABEL: Record<string, string> = {
  title: "제목(본진)",
  naver_title: "제목(네이버)",
  blogspot_title: "제목(블로그스팟)",
  summary: "요약",
  instagram_caption: "인스타 캡션",
  main_website_markdown: "본진 본문",
  naver_blog_content: "네이버 본문",
  blogspot_content: "블로그스팟 본문",
  key_points: "핵심 3줄",
  faq_json: "FAQ",
  threads_json: "스레드",
};

function Highlight({ f }: { f: Finding }) {
  const ctx = f.context ?? f.term;
  const o = f.contextOffset ?? 0;
  const before = ctx.slice(0, o);
  const match = ctx.slice(o, o + f.length);
  const after = ctx.slice(o + f.length);
  return (
    <span className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-700">
      {before}
      <mark className={f.grade === "A" ? "bg-red-200 text-red-900" : "bg-amber-200 text-amber-900"}>{match}</mark>
      {after}
    </span>
  );
}

export default function ComplianceModal({
  article,
  result,
  onClose,
  onResult,
  onToast,
}: {
  article: { id: string; title: string };
  result: CheckResult;
  onClose: () => void;
  onResult: (r: CheckResult) => void;
  onToast: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const findings = result.findings;
  const aCount = findings.filter((f) => f.grade === "A").length;
  const bUnacked = findings.filter((f) => f.grade === "B" && !f.acked).length;

  // 필드 순서 유지하며 그룹화.
  const fields = [...new Set(findings.map((f) => f.field))];

  const toggleAck = async (f: Finding, checked: boolean) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/compliance-ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId: article.id, field: f.field, term: f.term, offset: f.offset, checked }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.result) onResult(json.result as CheckResult);
      else onToast(json.error ?? "확인 저장 실패");
    } catch {
      onToast("네트워크 오류");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-6 py-4">
          <div>
            <p className="text-[11px] font-semibold text-slate-400">컴플라이언스 검사 · §6.10</p>
            <h2 className="mt-0.5 font-bold text-slate-900">{article.title}</h2>
            <p className="mt-1 text-xs">
              <span className={`font-bold ${aCount ? "text-red-700" : "text-slate-400"}`}>🔴 차단 {aCount}</span>
              <span className="mx-2 text-slate-300">·</span>
              <span className={`font-bold ${bUnacked ? "text-amber-700" : "text-slate-400"}`}>🟡 확인 {bUnacked}</span>
              {result.level === "clean" && <span className="ml-2 font-bold text-emerald-700">✅ 통과</span>}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full border border-[var(--color-line)] px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
            닫기
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4">
          {findings.length === 0 && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-sm font-semibold text-emerald-700">
              ✅ 적발 없음 — 심의 신청 가능
            </p>
          )}
          {fields.map((field) => (
            <div key={field} className="mb-5">
              <p className="mb-2 text-[11px] font-bold tracking-wide text-slate-400">
                {FIELD_LABEL[field] ?? field}
              </p>
              <div className="space-y-2">
                {findings
                  .filter((f) => f.field === field)
                  .map((f, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border px-3 py-2 ${
                        f.grade === "A" ? "border-red-200 bg-red-50/60" : "border-amber-200 bg-amber-50/60"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${f.grade === "A" ? "bg-red-600 text-white" : "bg-amber-500 text-white"}`}>
                          {f.grade === "A" ? "차단" : "확인"} · {f.term}
                        </span>
                        {f.grade === "B" && (
                          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={!!f.acked}
                              onChange={(e) => toggleAck(f, e.target.checked)}
                              className="h-4 w-4 accent-[var(--color-forest)]"
                            />
                            확인함
                          </label>
                        )}
                      </div>
                      <div className="mt-1.5 rounded bg-white/70 px-2 py-1">
                        <Highlight f={f} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        <b className="text-slate-600">{f.reason}</b> — {f.guidance}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[var(--color-line)] bg-slate-50 px-6 py-3 text-[11px] text-slate-500">
          🔴 차단(A)은 원고를 고쳐야 사라집니다. 🟡 확인(B)은 문맥을 확인하고 체크하면 통과 처리됩니다.
          모두 정리돼야 [심의용 복사]·[웹 심의용 미리보기]가 활성화됩니다.
        </div>
      </div>
    </div>
  );
}
