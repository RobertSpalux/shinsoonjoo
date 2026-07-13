"use client";

import { useMemo, useState } from "react";

/**
 * 지식iN 답변 어시스트 탭 — 커밋 P2 (반자동).
 * 고의도 질문에 사람이 직접 답변을 게시하되, 초안 생성·이력 관리만 어시스트한다.
 * ⚠️ 네이버 게시는 100% 수동(어뷰징 제재 방지) — 이 탭에는 게시 버튼이 없고 복사 버튼만 있다.
 */

export interface KinAnswer {
  id: string;
  question_url: string;
  question_title: string;
  question_body: string;
  answer_draft: string;
  linked_article_id: string | null;
  status: string;
  created_at: string;
  posted_at: string | null;
}

export interface KinArticleOption {
  id: string;
  title: string;
  naver_title: string | null;
}

const KIN_STATUSES = ["초안", "게시완료", "채택됨", "폐기"] as const;

const STATUS_BADGE: Record<string, string> = {
  초안: "border-amber-300 bg-amber-50 text-amber-700",
  게시완료: "border-sky-300 bg-sky-50 text-sky-700",
  채택됨: "border-emerald-300 bg-emerald-50 text-emerald-700",
  폐기: "border-slate-200 bg-slate-50 text-slate-400",
};

function fmtDate(s: string) {
  return new Date(s).toLocaleString("ko-KR", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

async function updateKinRow(id: string, fields: Record<string, unknown>) {
  const res = await fetch("/api/admin/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table: "kin_answers", id, fields }),
  });
  return res.ok;
}

export default function KinTab({
  answers,
  setAnswers,
  articleOptions,
  onCopy,
  onToast,
  selectCls,
  chipBtn,
}: {
  answers: KinAnswer[];
  setAnswers: React.Dispatch<React.SetStateAction<KinAnswer[]>>;
  /** 네이버 게시분 기사만 — 연결 글 드롭다운용 */
  articleOptions: KinArticleOption[];
  onCopy: (text: string, label: string) => void;
  onToast: (msg: string) => void;
  selectCls: string;
  chipBtn: (active: boolean) => string;
}) {
  // 입력 폼
  const [qUrl, setQUrl] = useState("");
  const [qTitle, setQTitle] = useState("");
  const [qBody, setQBody] = useState("");
  const [articleId, setArticleId] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState("전체");

  const filtered = useMemo(
    () => answers.filter((a) => filter === "전체" || a.status === filter),
    [answers, filter]
  );

  const generate = async () => {
    if (!qUrl.trim() || !qTitle.trim() || !qBody.trim()) {
      onToast("질문 URL·제목·본문을 모두 입력하세요");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/kin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_url: qUrl.trim(),
          question_title: qTitle.trim(),
          question_body: qBody.trim(),
          linked_article_id: articleId || undefined,
          linked_article_url: articleUrl.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(json.error ?? "초안 생성 실패");
        return;
      }
      setAnswers((prev) => [json.answer as KinAnswer, ...prev]);
      setQUrl(""); setQTitle(""); setQBody(""); setArticleId(""); setArticleUrl("");
      onToast("초안 생성 완료 — 검수 후 직접 게시하세요");
    } catch {
      onToast("초안 생성 실패 — 네트워크 확인");
    } finally {
      setGenerating(false);
    }
  };

  const changeStatus = (a: KinAnswer, status: string) => {
    // 게시완료로 넘길 때 게시 시각 기록 (되돌리면 유지 — 이력 보존)
    const fields: Record<string, unknown> =
      status === "게시완료" && !a.posted_at
        ? { status, posted_at: new Date().toISOString() }
        : { status };
    setAnswers((prev) => prev.map((x) => (x.id === a.id ? { ...x, ...fields } : x)));
    updateKinRow(a.id, fields);
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-[var(--color-gold)]";

  return (
    <>
      {/* 초안 생성 폼 */}
      <div className="mb-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">새 답변 초안</h2>
          <span className="text-[11px] text-slate-400">
            게시는 지식iN에서 직접 — 자동 게시 없음
          </span>
        </div>
        <p className="mb-4 text-[11px] leading-relaxed text-slate-500">
          고의도 질문(보험 정리·점검·해지 고민 등)의 URL과 내용을 붙여넣으면 답변 초안을 만듭니다.
          초안은 반드시 검수·수정 후 본인 계정으로 게시하세요.
        </p>
        <div className="grid gap-2">
          <input
            type="url"
            value={qUrl}
            onChange={(e) => setQUrl(e.target.value)}
            placeholder="질문 URL (https://kin.naver.com/...)"
            className={inputCls}
          />
          <input
            type="text"
            value={qTitle}
            onChange={(e) => setQTitle(e.target.value)}
            placeholder="질문 제목 붙여넣기"
            className={inputCls}
          />
          <textarea
            value={qBody}
            onChange={(e) => setQBody(e.target.value)}
            placeholder="질문 본문 붙여넣기"
            rows={4}
            className={inputCls}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={articleId} onChange={(e) => setArticleId(e.target.value)} className={selectCls}>
              <option value="">연결 글 없음 (링크 없이 답변만)</option>
              {articleOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.naver_title ?? a.title}
                </option>
              ))}
            </select>
            <input
              type="url"
              value={articleUrl}
              onChange={(e) => setArticleUrl(e.target.value)}
              placeholder="네이버 블로그 게시글 URL (링크를 넣을 때만)"
              disabled={!articleId}
              className={`${inputCls} disabled:opacity-40`}
            />
          </div>
          {articleId && !articleUrl.trim() && (
            <p className="text-[11px] text-amber-600">
              연결 글은 답변 방향 참고로만 쓰입니다 — 답변에 링크를 넣으려면 네이버 게시글 URL을 입력하세요.
            </p>
          )}
          <button
            onClick={generate}
            disabled={generating}
            className="mt-1 w-fit rounded-full border border-[var(--color-forest)] bg-[var(--color-forest)] px-5 py-2 text-xs font-bold text-white transition-all hover:bg-[var(--color-forest-soft)] disabled:opacity-50"
          >
            {generating ? "초안 생성 중..." : "초안 생성"}
          </button>
        </div>
      </div>

      {/* 이력 목록 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {["전체", ...KIN_STATUSES].map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={chipBtn(filter === s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] px-6 py-14 text-center text-sm text-slate-500">
            {filter === "전체" ? "아직 답변 이력이 없습니다." : "조건에 맞는 답변이 없습니다."}
          </div>
        )}
        {filtered.map((a) => (
          <div key={a.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={a.question_url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold text-slate-900 hover:text-[var(--color-gold-light)]"
                  >
                    {a.question_title}
                  </a>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[a.status] ?? STATUS_BADGE["초안"]}`}>
                    {a.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  초안 {fmtDate(a.created_at)}
                  {a.posted_at ? ` · 게시 ${fmtDate(a.posted_at)}` : ""}
                  {` · ${a.answer_draft.length.toLocaleString()}자`}
                </p>
              </div>
              <select className={selectCls} value={a.status} onChange={(e) => changeStatus(a, e.target.value)}>
                {(KIN_STATUSES.includes(a.status as (typeof KIN_STATUSES)[number])
                  ? KIN_STATUSES
                  : [a.status, ...KIN_STATUSES]
                ).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <p className="mt-3 whitespace-pre-wrap rounded-lg border border-[var(--color-line)] bg-white/60 px-4 py-3 text-[13px] leading-relaxed text-slate-800">
              {a.answer_draft}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => onCopy(a.answer_draft, "답변 초안")}
                className="rounded-full border border-[var(--color-forest)] px-4 py-2 text-xs font-bold text-[var(--color-forest)] transition-all hover:bg-[var(--color-forest)] hover:text-white"
              >
                답변 복사
              </button>
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer select-none hover:text-slate-700">질문 본문 보기</summary>
                <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
                  {a.question_body}
                </p>
              </details>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
