"use client";

import { useState } from "react";

/**
 * 광고심의(ad_reviews) UI — 채널(광고물) 단위 심의 라이프사이클. (CLAUDE.md §6.9)
 * 발행 게이트는 has_valid_review와 동일 규칙을 클라이언트에서 재현해 버튼을 미리 막는다.
 * 서버 트리거(enforce_publish_gate)는 최후 방어선.
 */

export interface AdReview {
  id: string;
  article_id: string;
  channel: string;
  review_type: string;
  posting_title: string | null;
  ad_form: string | null;
  status: string;
  review_authority: string | null;
  review_no: string | null;
  review_from: string | null;
  review_to: string | null;
  posted_url: string | null;
  url_registered_at: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  rejected_reason: string | null;
  notes: string | null;
}

export interface ExpiringReview {
  id: string;
  article_id: string;
  title: string;
  slug: string;
  channel: string;
  review_no: string | null;
  review_from: string | null;
  review_to: string | null;
  days_left: number;
  posted_url: string | null;
  url_registered_at: string | null;
}

export type ReviewState = "none" | "submitted" | "approved" | "rejected" | "expired";

/** 채널 정의 — 광고형태·심의유형 자동 매핑 + 발행 플래그(스레드는 발행 컬럼 없음). */
export const CHANNELS = [
  { key: "main", label: "홈페이지(본진)", adForm: "홈페이지", reviewType: "general", publishFlag: "is_main_published" },
  { key: "naver", label: "네이버", adForm: "바이럴(블로그 등)", reviewType: "general", publishFlag: "is_naver_published" },
  { key: "blogspot", label: "블로그스팟", adForm: "바이럴(블로그 등)", reviewType: "general", publishFlag: "is_blogspot_published" },
  { key: "instagram", label: "인스타(영상제외)", adForm: "인스타(영상제외)", reviewType: "general", publishFlag: "is_instagram_published" },
  { key: "threads", label: "스레드", adForm: "스레드", reviewType: "threads", publishFlag: null },
] as const;

export type ChannelDef = (typeof CHANNELS)[number];

/** 로컬 오늘 날짜 YYYY-MM-DD */
export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

/** has_valid_review(article,channel)의 클라이언트 재현 — 발행 가능 여부의 단일 기준. */
export function reviewValid(r: AdReview | undefined, today: string): boolean {
  return (
    !!r &&
    r.status === "approved" &&
    !!r.review_no &&
    !!r.review_from &&
    !!r.review_to &&
    r.review_from <= today &&
    today <= r.review_to
  );
}

export function reviewState(r: AdReview | undefined, today: string): ReviewState {
  if (!r) return "none";
  if (r.status === "rejected") return "rejected";
  if (r.status === "approved") return reviewValid(r, today) ? "approved" : "expired";
  if (r.status === "expired") return "expired";
  if (r.status === "submitted" || r.status === "under_review") return "submitted";
  return "none";
}

/** 팜스 게시명 규칙 — 특수문자(' " ? & — –) 제거. (§6.9 신청 폼) */
export function sanitizePostingTitle(t: string): string {
  return t
    .replace(/["'?&—–]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 유효기간 종료일 = 시작일 + 1년 − 1일 (심의일로부터 1년). UTC로 계산해 TZ 드리프트 방지. */
export function plusOneYearMinusDay(from: string): string {
  const [y, m, d] = from.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(Date.UTC(y + 1, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function stateBadgeCls(state: ReviewState): string {
  switch (state) {
    case "approved":
      return "border-emerald-300 bg-emerald-50 text-emerald-700";
    case "submitted":
      return "border-amber-300 bg-amber-50 text-amber-700";
    case "rejected":
    case "expired":
      return "border-red-300 bg-red-50 text-red-700";
    default:
      return "border-[var(--color-line)] bg-slate-100 text-slate-500";
  }
}

function stateBadgeText(state: ReviewState, r: AdReview | undefined): string {
  switch (state) {
    case "approved":
      return `심의필 ${r?.review_no} · ~${r?.review_to}`;
    case "submitted":
      return "심사중";
    case "rejected":
      return "반려 — 사유 보기";
    case "expired":
      return "유효기간 만료";
    default:
      return "심의 미신청";
  }
}

const PAMS_STEPS = [
  "원고 작성 (금지 표현·증빙 §6.10)",
  "비공개 게시 (네이버/블로그스팟 초안 · 웹 is_main_published=false)",
  "전체 캡처 → 페이지가 나뉜 하나의 PDF (비공개 상태가 보이게)",
  "증빙자료 PDF 추가 (파일명 = 출처명)",
  "zip 1개로 압축",
  "팜스 신청 → [저장]은 임시저장, [제출] 필수",
  "영업일 1~2일 대기",
  "심의필 번호·유효기간 수령 → 필수안내사항 삽입",
  "공개 전환",
  "팜스에 실제 게시 URL 등록 (누락 시 이후 심의 제한)",
];

/* ── 만료 관리 대시보드 (/admin 최상단) ── */
export function ExpiringDashboard({ rows }: { rows: ExpiringReview[] }) {
  if (!rows.length) return null;
  const tone = (d: number) =>
    d <= 0
      ? "border-red-300 bg-red-50 text-red-700"
      : d <= 30
        ? "border-orange-300 bg-orange-50 text-orange-700"
        : "border-amber-300 bg-amber-50 text-amber-700";
  const labelOf = (ch: string) => CHANNELS.find((c) => c.key === ch)?.label ?? ch;

  return (
    <section className="mb-6 rounded-xl border border-red-200 bg-red-50/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold text-red-800">⏳ 심의필 만료 임박 {rows.length}건</h2>
        <span className="text-[11px] text-slate-500">바이럴(블로그 등)은 만료 + 90일까지 연장심의 가능</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.id}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs ${tone(r.days_left)}`}
          >
            <span className="font-bold tabular-nums">
              {r.days_left <= 0 ? `만료 ${-r.days_left}일 경과` : `D-${r.days_left}`}
            </span>
            <a href={`/news/${r.slug}`} target="_blank" className="font-semibold underline underline-offset-2">
              {r.title}
            </a>
            <span className="rounded-full border border-current/30 px-2 py-0.5">{labelOf(r.channel)}</span>
            <span className="tabular-nums">
              심의필 {r.review_no} · ~{r.review_to}
            </span>
            {!r.url_registered_at && <span className="font-semibold">· ⚠️ 게시위치 미등록</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── 아티클별 심의 관리 패널 (5채널 행) ── */
type ArticleLike = {
  id: string;
  title: string;
  is_main_published: boolean;
  is_naver_published: boolean;
  is_blogspot_published: boolean;
  is_instagram_published: boolean;
};

type ModalState =
  | { kind: "submit" | "approve" | "reject" | "url"; channel: ChannelDef }
  | null;

async function callAdReview(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string; review?: AdReview }> {
  try {
    const res = await fetch("/api/admin/ad-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, error: json.error, review: json.review };
  } catch {
    return { ok: false, error: "네트워크 오류" };
  }
}

export function AdReviewPanel({
  article,
  reviews,
  today,
  onSaved,
  onToast,
  onCopy,
}: {
  article: ArticleLike;
  reviews: Record<string, AdReview | undefined>;
  today: string;
  onSaved: (review: AdReview) => void;
  onToast: (msg: string) => void;
  onCopy: (text: string, label: string) => void;
}) {
  const [modal, setModal] = useState<ModalState>(null);
  const [showReason, setShowReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 신청 준비 폼
  const [postingTitle, setPostingTitle] = useState("");
  const [notes, setNotes] = useState("");
  // 심의필 입력 폼
  const [reviewNo, setReviewNo] = useState("");
  const [reviewFrom, setReviewFrom] = useState("");
  const [reviewTo, setReviewTo] = useState("");
  // 반려 폼
  const [rejectReason, setRejectReason] = useState("");
  // URL 등록 폼
  const [postedUrl, setPostedUrl] = useState("");

  const isPublished = (ch: ChannelDef): boolean =>
    ch.publishFlag ? Boolean((article as Record<string, unknown>)[ch.publishFlag]) : false;

  const openSubmit = (ch: ChannelDef) => {
    const existing = reviews[ch.key];
    setPostingTitle(existing?.posting_title || sanitizePostingTitle(article.title));
    setNotes(existing?.notes ?? "");
    setModal({ kind: "submit", channel: ch });
  };
  const openApprove = (ch: ChannelDef) => {
    const existing = reviews[ch.key];
    setReviewNo(existing?.review_no ?? "");
    setReviewFrom(existing?.review_from ?? "");
    setReviewTo(existing?.review_to ?? "");
    setModal({ kind: "approve", channel: ch });
  };
  const openReject = (ch: ChannelDef) => {
    setRejectReason(reviews[ch.key]?.rejected_reason ?? "");
    setModal({ kind: "reject", channel: ch });
  };
  const openUrl = (ch: ChannelDef) => {
    setPostedUrl(reviews[ch.key]?.posted_url ?? "");
    setModal({ kind: "url", channel: ch });
  };

  const closeModal = () => setModal(null);

  const save = async (payload: Record<string, unknown>, successMsg: string) => {
    setBusy(true);
    const { ok, error, review } = await callAdReview(payload);
    setBusy(false);
    if (ok && review) {
      onSaved(review);
      onToast(successMsg);
      closeModal();
    } else {
      onToast(error ?? "저장 실패");
    }
  };

  return (
    <details className="mt-4 rounded-lg border border-[var(--color-line)] bg-white/60">
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-2 px-4 py-2.5 text-[11px] font-bold tracking-wide text-slate-500">
        광고심의 (금소법 §22)
        <span className="flex flex-wrap gap-1">
          {CHANNELS.map((ch) => {
            const st = reviewState(reviews[ch.key], today);
            return (
              <span
                key={ch.key}
                title={`${ch.label}: ${stateBadgeText(st, reviews[ch.key])}`}
                className={`inline-block h-2 w-2 rounded-full ${
                  st === "approved"
                    ? "bg-emerald-500"
                    : st === "submitted"
                      ? "bg-amber-400"
                      : st === "rejected" || st === "expired"
                        ? "bg-red-500"
                        : "bg-slate-300"
                }`}
              />
            );
          })}
        </span>
      </summary>

      <div className="space-y-2 px-4 pb-4">
        {CHANNELS.map((ch) => {
          const r = reviews[ch.key];
          const st = reviewState(r, today);
          const needsUrl = st === "approved" && isPublished(ch) && !r?.url_registered_at;
          return (
            <div key={ch.key} className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-2 first:border-t-0 first:pt-0">
              <span className="w-28 shrink-0 text-xs font-semibold text-slate-700">{ch.label}</span>
              {st === "rejected" ? (
                <button
                  onClick={() => setShowReason(showReason === ch.key ? null : ch.key)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${stateBadgeCls(st)}`}
                >
                  {stateBadgeText(st, r)}
                </button>
              ) : (
                <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${stateBadgeCls(st)}`}>
                  {stateBadgeText(st, r)}
                </span>
              )}

              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {(st === "none" || st === "rejected" || st === "expired") && (
                  <button onClick={() => openSubmit(ch)} className={miniBtn}>
                    {st === "expired" ? "재신청" : "신청 준비"}
                  </button>
                )}
                {st === "submitted" && (
                  <>
                    <button onClick={() => openApprove(ch)} className={`${miniBtn} border-emerald-500 text-emerald-700`}>
                      심의필 입력
                    </button>
                    <button onClick={() => openReject(ch)} className={`${miniBtn} border-red-300 text-red-600`}>
                      반려
                    </button>
                  </>
                )}
                {st === "approved" && (
                  <button onClick={() => openApprove(ch)} className={miniBtn}>
                    심의필 수정
                  </button>
                )}
                {needsUrl && (
                  <button onClick={() => openUrl(ch)} className={`${miniBtn} border-orange-400 text-orange-700`}>
                    게시위치 등록
                  </button>
                )}
              </div>

              {showReason === ch.key && r?.rejected_reason && (
                <p className="w-full rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                  반려 사유: {r.rejected_reason}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* 모달 */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeModal}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-3">
              <h3 className="text-sm font-bold text-slate-900">
                {modal.channel.label} ·{" "}
                {modal.kind === "submit"
                  ? "광고심의 신청 준비"
                  : modal.kind === "approve"
                    ? "심의필 입력"
                    : modal.kind === "reject"
                      ? "반려 처리"
                      : "게시위치(URL) 등록"}
              </h3>
              <button onClick={closeModal} className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
                닫기
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              {modal.kind === "submit" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-[11px] font-bold text-slate-500">게시명 (팜스 붙여넣기용)</label>
                    <div className="mt-1 flex gap-2">
                      <input
                        value={postingTitle}
                        onChange={(e) => setPostingTitle(e.target.value)}
                        className="flex-1 rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm text-slate-900 outline-none focus:border-[var(--color-gold)]"
                      />
                      <button onClick={() => onCopy(postingTitle, "게시명")} className={miniBtn}>
                        복사
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">특수문자(&apos; &quot; ? &amp; — –) 자동 제거됨. 수정 가능.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-bold text-slate-400">광고형태 (자동)</p>
                      <p className="mt-0.5 font-semibold text-slate-800">{modal.channel.adForm}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-bold text-slate-400">심의유형 (자동)</p>
                      <p className="mt-0.5 font-semibold text-slate-800">{modal.channel.reviewType}</p>
                    </div>
                  </div>
                  <details className="rounded-lg border border-[var(--color-line)] bg-slate-50/70">
                    <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold text-slate-500">
                      팜스 신청 체크리스트 (§6.9 10단계)
                    </summary>
                    <ol className="list-decimal space-y-1 px-6 pb-3 text-xs text-slate-600">
                      {PAMS_STEPS.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                  </details>
                  <div>
                    <label className="text-[11px] font-bold text-slate-500">메모 (선택)</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm text-slate-800 outline-none focus:border-[var(--color-gold)]"
                    />
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      save(
                        {
                          action: "submit",
                          articleId: article.id,
                          channel: modal.channel.key,
                          postingTitle: sanitizePostingTitle(postingTitle),
                          adForm: modal.channel.adForm,
                          reviewType: modal.channel.reviewType,
                          notes,
                        },
                        "심의 신청(심사중)으로 기록"
                      )
                    }
                    className={primaryBtn}
                  >
                    제출 기록 (심사중)
                  </button>
                </div>
              )}

              {modal.kind === "approve" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-[11px] font-bold text-slate-500">심의필 번호</label>
                    <input
                      value={reviewNo}
                      onChange={(e) => setReviewNo(e.target.value)}
                      placeholder="예: 2026-0001"
                      className="mt-1 w-full rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm text-slate-900 outline-none focus:border-[var(--color-gold)]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-bold text-slate-500">심의일 (시작)</label>
                      <input
                        type="date"
                        value={reviewFrom}
                        onChange={(e) => {
                          setReviewFrom(e.target.value);
                          if (e.target.value) setReviewTo(plusOneYearMinusDay(e.target.value));
                        }}
                        className="mt-1 w-full rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm text-slate-900 outline-none focus:border-[var(--color-gold)]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-500">만료일 (자동 = +1년 −1일)</label>
                      <input
                        type="date"
                        value={reviewTo}
                        onChange={(e) => setReviewTo(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm text-slate-900 outline-none focus:border-[var(--color-gold)]"
                      />
                    </div>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      save(
                        {
                          action: "approve",
                          articleId: article.id,
                          channel: modal.channel.key,
                          reviewNo: reviewNo.trim(),
                          reviewFrom,
                          reviewTo,
                        },
                        "심의필 등록(승인) 완료"
                      )
                    }
                    className={primaryBtn}
                  >
                    승인 저장
                  </button>
                </div>
              )}

              {modal.kind === "reject" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-[11px] font-bold text-slate-500">반려 사유</label>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={4}
                      className="mt-1 w-full rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm text-slate-800 outline-none focus:border-[var(--color-gold)]"
                    />
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      save(
                        {
                          action: "reject",
                          articleId: article.id,
                          channel: modal.channel.key,
                          rejectedReason: rejectReason,
                        },
                        "반려 처리 완료"
                      )
                    }
                    className={`${primaryBtn} bg-red-600 hover:bg-red-700`}
                  >
                    반려 저장
                  </button>
                </div>
              )}

              {modal.kind === "url" && (
                <div className="space-y-4">
                  <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-800">
                    심의 완료 후 실제 게시 URL을 팜스에 등록해야 합니다. 미등록 시 신규·연장 심의가 제한됩니다. (2025-11-13 의무화)
                  </p>
                  <div>
                    <label className="text-[11px] font-bold text-slate-500">게시 URL</label>
                    <input
                      value={postedUrl}
                      onChange={(e) => setPostedUrl(e.target.value)}
                      placeholder="https://..."
                      className="mt-1 w-full rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm text-slate-900 outline-none focus:border-[var(--color-gold)]"
                    />
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      save(
                        {
                          action: "register-url",
                          articleId: article.id,
                          channel: modal.channel.key,
                          postedUrl: postedUrl.trim(),
                        },
                        "게시위치 등록 완료"
                      )
                    }
                    className={primaryBtn}
                  >
                    등록 완료
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </details>
  );
}

/* ── 게시위치(URL) 등록 리마인더 — 아티클 상단 배너 (§6.9 10단계, 2025-11-13 의무화) ── */
export function UrlReminderBanner({
  article,
  reviews,
  today,
  onSaved,
  onToast,
}: {
  article: ArticleLike;
  reviews: Record<string, AdReview | undefined>;
  today: string;
  onSaved: (review: AdReview) => void;
  onToast: (msg: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  const pending = CHANNELS.filter((ch) => {
    if (!ch.publishFlag) return false;
    const published = Boolean((article as Record<string, unknown>)[ch.publishFlag]);
    const r = reviews[ch.key];
    return published && reviewValid(r, today) && !r?.url_registered_at;
  });
  if (!pending.length) return null;

  const register = async (channel: string) => {
    const url = (drafts[channel] ?? "").trim();
    if (!url) {
      onToast("게시 URL을 입력하세요");
      return;
    }
    setBusy(channel);
    const { ok, error, review } = await callAdReview({
      action: "register-url",
      articleId: article.id,
      channel,
      postedUrl: url,
    });
    setBusy("");
    if (ok && review) {
      onSaved(review);
      onToast("게시위치 등록 완료");
    } else {
      onToast(error ?? "등록 실패");
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-orange-300 bg-orange-50 px-4 py-3">
      <p className="text-xs font-bold text-orange-800">
        ⚠️ 팜스에 게시위치(URL) 등록이 필요합니다. 미등록 시 신규·연장 심의가 제한됩니다.
      </p>
      <div className="mt-2 space-y-2">
        {pending.map((ch) => (
          <div key={ch.key} className="flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0 text-[11px] font-semibold text-orange-700">{ch.label}</span>
            <input
              value={drafts[ch.key] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [ch.key]: e.target.value }))}
              placeholder="https://... (실제 게시 URL)"
              className="min-w-0 flex-1 rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-orange-400"
            />
            <button
              disabled={busy === ch.key}
              onClick={() => register(ch.key)}
              className="shrink-0 rounded-full border border-orange-500 bg-orange-500 px-3 py-1.5 text-[11px] font-bold text-white transition-all hover:bg-orange-600 disabled:opacity-40"
            >
              등록 완료
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const miniBtn =
  "rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-all hover:border-[var(--color-gold-dim)] disabled:opacity-40";
const primaryBtn =
  "w-full rounded-lg bg-[var(--color-forest)] px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-[var(--color-forest-soft)] disabled:opacity-40";
