"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toBlogspotHtml, toNaverText } from "@/lib/osmu-format";
import KinTab, { type KinAnswer } from "@/components/admin/KinTab";
import {
  AdReviewPanel,
  ExpiringDashboard,
  UrlReminderBanner,
  reviewValid,
  todayStr,
  type AdReview,
  type ExpiringReview,
} from "@/components/admin/AdReviewPanel";

/**
 * 관리자 운영 콘솔 — 매일 아침 5분 운영 도구 (검수 → 발행 → 4채널 배포 → 리드 관리).
 * 데이터는 서버(admin/page.tsx, service-role)에서 초안 포함 전체를 받는다(발행 게이트 예외).
 * 변경은 /api/admin/update(화이트리스트) · /api/admin/delete 경유.
 */

interface Lead {
  id: string;
  name: string;
  phone: string;
  quiz_responses: Record<string, unknown> | null;
  quiz_score: number | null;
  lead_source: string | null;
  status: string;
  memo: string | null;
  created_at: string;
}
interface Consultation {
  id: string;
  name: string;
  phone: string;
  category: string;
  message: string | null;
  status: string;
  memo: string | null;
  created_at: string;
}
interface CarouselCard {
  type?: string;
  overline?: string;
  headline?: string;
  body?: string;
  heading?: string; // 구형 호환
}
/** 상록수 사실검증 항목 — evergreen 파이프라인이 저장한 jsonb 형태 그대로 */
interface VerifyClaim {
  claim?: string;
  basis?: string;
  confidence?: string;
}
/** 스레드 문구 — 본글 + 이어달기 답글 (threads_json jsonb 그대로, 표시·복사 전용) */
interface ThreadsPost {
  day: number;
  type: "single" | "chain";
  label: string; // 예: "1일차 · 이어달기 (밤 9시)"
  body: string; // 본글
  replies: string[]; // 이어달기 답글 (없으면 빈 배열)
}
interface Article {
  id: string;
  title: string;
  naver_title: string | null;
  blogspot_title: string | null;
  slug: string;
  category: string;
  summary: string | null;
  tags: string[] | null;
  raw_source_url: string | null;
  raw_source_name: string | null;
  /** 수집 시점 원문 전문(무절단) — 검수 대조용. null이면 원문 미보존(대조 불가) */
  raw_source_fulltext: string | null;
  key_points: string[] | null;
  remodeling_bridge: string | null;
  main_website_markdown: string | null;
  is_main_published: boolean;
  is_naver_published: boolean;
  is_blogspot_published: boolean;
  is_instagram_published: boolean;
  is_threads_published: boolean;
  naver_blog_content: string | null;
  blogspot_content: string | null;
  instagram_caption: string | null;
  carousel_json: CarouselCard[] | null;
  threads_json?: ThreadsPost[] | null;
  image_paths: string[];
  naver_image_paths: string[] | null;
  view_count: number;
  published_at: string | null;
  created_at: string;
  content_type: string | null;
  seed_key: string | null;
  verify_claims: VerifyClaim[] | null;
  needs_human_review: boolean | null;
}

const LEAD_STATUSES = ["new", "연락함", "상담예정", "전환", "보류"];
// 상담 신청도 리드와 같은 상태 어휘를 쓴다(운영자가 두 목록을 오가며 혼선 없게).
// 기존 값('접수완료' 등)은 마이그레이션 없이 표시 호환(옵션 앞에 끼워 넣기)으로 유지.
const ARTICLE_FILTERS = ["전체", "초안", "발행됨", "예약"] as const;

function fmtDate(s: string) {
  return new Date(s).toLocaleString("ko-KR", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * 카드 검증 경고 — route.ts 검증 가드와 같은 규칙의 뷰 전용 사본
 * (경고는 DB에 저장되지 않으므로 표시 시점에 재계산. 구형 heading/body 카드는 검사 제외)
 */
function carouselWarnings(cards: CarouselCard[] | null): string[] {
  if (!Array.isArray(cards) || cards.length === 0 || !cards[0]?.type) return [];
  const issues: string[] = [];
  if (cards[0].type !== "hook") issues.push("1번이 hook 아님");
  if (cards[cards.length - 1]?.type !== "cta") issues.push("마지막이 cta 아님");
  if (cards.length < 5 || cards.length > 9) issues.push(`카드 ${cards.length}장(5~9 밖)`);
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.type ?? "?", (counts.get(c.type ?? "?") ?? 0) + 1);
  for (const [t, n] of counts) if (n >= 3) issues.push(`${t} ${n}장 반복`);
  cards.forEach((c, i) => {
    if (!String(c.headline ?? "").trim() || !String(c.body ?? "").trim())
      issues.push(`${i + 1}번 필드 비어 있음`);
  });
  return issues;
}

async function updateRow(
  table: string,
  id: string,
  fields: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/admin/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, id, fields }),
  });
  // 발행 게이트(409) 등 서버가 변환한 사용자 문구를 그대로 전달한다.
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, error: json.error };
}

async function deleteRow(table: string, id: string, blockSource = false) {
  const res = await fetch("/api/admin/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, id, blockSource }),
  });
  return res.ok;
}

export default function AdminDashboard({
  leads: initialLeads,
  consultations: initialConsults,
  articles: initialArticles,
  kinAnswers: initialKinAnswers,
  adReviews: initialAdReviews,
  expiring,
}: {
  leads: Lead[];
  consultations: Consultation[];
  articles: Article[];
  kinAnswers: KinAnswer[];
  adReviews: AdReview[];
  expiring: ExpiringReview[];
}) {
  const [tab, setTab] = useState<"leads" | "consults" | "articles" | "kin">("articles");
  const [leads, setLeads] = useState(initialLeads);
  const [consults, setConsults] = useState(initialConsults);
  const [articles, setArticles] = useState(initialArticles);
  const [kinAnswers, setKinAnswers] = useState(initialKinAnswers);
  const [adReviews, setAdReviews] = useState(initialAdReviews);

  // 발행 게이트 판정 기준일(마운트 시 1회 캡처) + (article,channel)당 최신 심의 행 맵.
  const [today] = useState(() => todayStr());
  const reviewsByArticle = useMemo(() => {
    const m = new Map<string, Record<string, AdReview>>();
    for (const r of adReviews) {
      const rec = m.get(r.article_id) ?? {};
      if (!rec[r.channel]) rec[r.channel] = r; // adReviews는 최신순 → 첫 행이 활성
      m.set(r.article_id, rec);
    }
    return m;
  }, [adReviews]);
  // 심의 저장 후 로컬 반영 — 같은 (article,channel) 이전 행을 치우고 새 행을 맨 앞에.
  const upsertReview = useCallback((review: AdReview) => {
    setAdReviews((prev) => [
      review,
      ...prev.filter((r) => !(r.article_id === review.article_id && r.channel === review.channel)),
    ]);
  }, []);

  // 토스트
  const [toast, setToast] = useState("");
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1800);
  }, []);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} 복사 완료`);
    } catch {
      showToast("복사 실패 — 브라우저 권한을 확인하세요");
    }
  };

  // 필터
  // 뉴스/상록수 분리(M4-1) — 기본은 뉴스(운영 빈도가 높음)
  const [contentTab, setContentTab] = useState<"news" | "evergreen">("news");
  const [articleFilter, setArticleFilter] = useState<(typeof ARTICLE_FILTERS)[number]>("전체");
  const [undistributedOnly, setUndistributedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [leadFilter, setLeadFilter] = useState("전체");

  // 모달
  const [previewArticle, setPreviewArticle] = useState<Article | null>(null);
  // 원문 대조 뷰 — 검수자가 체크리스트를 보면서 원문 전문을 나란히 읽을 수 있게 한다
  const [showSource, setShowSource] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: string[]; slug: string; index: number } | null>(null);
  // 스레드 문구 모달 — 표시·복사 전용 (발행 플래그·배포 체크박스는 건드리지 않는다)
  const [threadsArticle, setThreadsArticle] = useState<Article | null>(null);
  const [zipping, setZipping] = useState("");

  const now = useMemo(() => Date.now(), []);
  const statusOf = useCallback(
    (a: Article): "초안" | "발행됨" | "예약" => {
      if (!a.is_main_published) return "초안";
      if (a.published_at && new Date(a.published_at).getTime() > now) return "예약";
      return "발행됨";
    },
    [now]
  );
  const isUndistributed = (a: Article) =>
    !a.is_naver_published || !a.is_blogspot_published || !a.is_instagram_published;

  const isEvergreen = (a: Article) => a.content_type === "evergreen";
  const evergreenCount = articles.filter(isEvergreen).length;

  const filteredArticles = articles.filter((a) => {
    if (isEvergreen(a) !== (contentTab === "evergreen")) return false;
    if (articleFilter !== "전체" && statusOf(a) !== articleFilter) return false;
    if (undistributedOnly && !isUndistributed(a)) return false;
    if (search.trim() && !a.title.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });
  const filteredLeads = leads.filter((l) => leadFilter === "전체" || l.status === leadFilter);

  // 상단 요약: 오늘 할 일
  const draftCount = articles.filter((a) => !a.is_main_published).length;
  const undistributedCount = articles.filter(
    (a) => statusOf(a) === "발행됨" && isUndistributed(a)
  ).length;
  const newLeadCount = leads.filter((l) => l.status === "new").length;

  // 미리보기 모달 ESC 닫기 — 다른 기사를 열 때 원문 패널 상태가 새어나가지 않게 함께 닫는다
  const closePreview = () => {
    setPreviewArticle(null);
    setShowSource(false);
  };
  useEffect(() => {
    if (!previewArticle) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewArticle]);

  // 스레드 모달 ESC 닫기 (미리보기 모달과 동일 패턴)
  useEffect(() => {
    if (!threadsArticle) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setThreadsArticle(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threadsArticle]);

  // 라이트박스 키보드
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight")
        setLightbox((lb) =>
          lb ? { ...lb, index: Math.min(lb.index + 1, lb.images.length - 1) } : lb
        );
      if (e.key === "ArrowLeft")
        setLightbox((lb) => (lb ? { ...lb, index: Math.max(lb.index - 1, 0) } : lb));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = filename;
    el.click();
    URL.revokeObjectURL(url);
  };

  const downloadImage = async (url: string, filename: string) => {
    try {
      const blob = await (await fetch(url)).blob();
      downloadBlob(blob, filename);
    } catch {
      showToast("다운로드 실패");
    }
  };

  const downloadZip = async (zipKey: string, urls: string[], zipName: string, label: string) => {
    if (!urls.length) return;
    setZipping(zipKey);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const url of urls) {
        const blob = await (await fetch(url)).blob();
        zip.file(url.split("/").pop() ?? "image.png", blob);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, zipName);
      showToast(`${label} ${urls.length}장 ZIP 다운로드`);
    } catch {
      showToast("ZIP 생성 실패");
    } finally {
      setZipping("");
    }
  };

  /**
   * 상록수 발행 게이트(M4-1) — 검증 필요 기사는 사람 확인을 거쳐야 발행.
   * 발행 = 사람 검수 완료의 기록이므로 확인 후 needs_human_review를 함께 해제한다.
   * ([초안으로] 회수 시에는 되돌리지 않는다 — 이미 검수된 사실은 유지)
   */
  const passReviewGate = (a: Article): boolean =>
    a.needs_human_review !== true ||
    window.confirm(
      `검증 항목 ${a.verify_claims?.length ?? 0}건을 모두 확인했습니까? 발행 시 검증 필요 플래그가 해제됩니다.`
    );

  const removeArticle = async (a: Article) => {
    if (
      !window.confirm(
        `⚠️ 기사 삭제\n\n"${a.title}"\n\n기사 원고·카드 이미지(Storage)가 모두 삭제되며 되돌릴 수 없습니다. 삭제할까요?`
      )
    )
      return;
    // 소스 차단 (커밋 O1) — 삭제만 하면 같은 raw_source_url로 크론이 재생성한다(부당승환 사고).
    const blockSource =
      !!a.raw_source_url &&
      window.confirm(
        `이 소스를 차단할까요?\n\n${a.raw_source_url}\n\n차단하면 같은 원문으로 다시 생성되지 않습니다.\n(금지 소재·회수 기사면 차단을 권합니다)`
      );
    const ok = await deleteRow("premium_articles", a.id, blockSource);
    if (ok) {
      setArticles((prev) => prev.filter((x) => x.id !== a.id));
      showToast(blockSource ? "기사 삭제 + 소스 차단 완료" : "기사 삭제 완료");
    } else showToast("삭제 실패");
  };

  // 상담 신청 삭제 = 개인정보 파기 수단 (CLAUDE.md §6) — 리드 삭제와 같은 API 경로 재사용
  const removeConsult = async (c: Consultation) => {
    if (!window.confirm("상담 신청을 삭제합니다. 개인정보가 영구 파기됩니다.")) return;
    const ok = await deleteRow("consultations", c.id);
    if (ok) {
      setConsults((prev) => prev.filter((x) => x.id !== c.id));
      showToast("상담 신청 삭제 완료");
    } else showToast("삭제 실패");
  };

  const removeLead = async (l: Lead) => {
    if (
      !window.confirm(
        `⚠️ 리드 삭제\n\n${l.name} / ${l.phone}\n\n삭제하면 되돌릴 수 없습니다. 테스트·스팸 리드만 삭제하세요.`
      )
    )
      return;
    const ok = await deleteRow("lead_consultings", l.id);
    if (ok) {
      setLeads((prev) => prev.filter((x) => x.id !== l.id));
      showToast("리드 삭제 완료");
    } else showToast("삭제 실패");
  };

  const selectCls =
    "rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-[var(--color-gold)]";
  const chipBtn = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
      active
        ? "border-[var(--color-forest)] bg-[var(--color-forest)] text-white"
        : "border-[var(--color-line)] text-slate-600 hover:text-slate-900"
    }`;

  return (
    <main className="min-h-screen bg-[var(--color-ink)] pt-16">
      <div className="mx-auto max-w-7xl px-6 py-10 md:px-12">
        {/* 심의필 만료 임박 — 최상단 상시 노출 (§6.9) */}
        <ExpiringDashboard rows={expiring} />
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">운영 콘솔</h1>
            <p className="text-xs text-slate-500">신순주의 선한 금융 · 관리자 전용</p>
          </div>
          <div className="flex gap-2">
            {([
              ["articles", `콘텐츠 ${articles.length}`],
              ["leads", `진단 리드 ${leads.length}`],
              ["consults", `상담 신청 ${consults.length}`],
              ["kin", `지식iN ${kinAnswers.length}`],
            ] as const).map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} className={chipBtn(tab === key)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 오늘 할 일 요약 바 */}
        <div className="mb-8 grid grid-cols-3 gap-3">
          {([
            ["미검수 초안", draftCount, "articles", () => { setArticleFilter("초안"); setUndistributedOnly(false); }],
            ["미배포 발행글", undistributedCount, "articles", () => { setArticleFilter("발행됨"); setUndistributedOnly(true); }],
            ["새 리드", newLeadCount, "leads", () => setLeadFilter("new")],
          ] as const).map(([label, count, targetTab, apply]) => (
            <button
              key={label}
              onClick={() => { setTab(targetTab); apply(); }}
              className={`rounded-xl border p-4 text-left transition-all hover:border-[var(--color-gold-dim)] ${
                count > 0 ? "border-amber-300 bg-amber-50" : "border-[var(--color-line)] bg-[var(--color-ink-card)]"
              }`}
            >
              <p className="text-[11px] font-semibold text-slate-500">{label}</p>
              <p className={`mt-1 text-2xl font-bold tabular-nums ${count > 0 ? "text-amber-700" : "text-slate-400"}`}>
                {count}
                <span className="text-sm font-semibold">건</span>
              </p>
            </button>
          ))}
        </div>

        {/* ─── 콘텐츠 탭 ─── */}
        {tab === "articles" && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {([
                ["news", `뉴스 (${articles.length - evergreenCount})`],
                ["evergreen", `상록수 (${evergreenCount})`],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => setContentTab(key)} className={chipBtn(contentTab === key)}>
                  {label}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-[var(--color-line)]" aria-hidden />
              {ARTICLE_FILTERS.map((f) => (
                <button key={f} onClick={() => setArticleFilter(f)} className={chipBtn(articleFilter === f)}>
                  {f}
                </button>
              ))}
              <label className="ml-1 flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={undistributedOnly}
                  onChange={(e) => setUndistributedOnly(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-forest)]"
                />
                미배포만 보기
              </label>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="제목 검색"
                className="ml-auto w-48 rounded-lg border border-[var(--color-line)] bg-white px-3 py-1.5 text-xs outline-none focus:border-[var(--color-gold)]"
              />
            </div>

            <div className="space-y-3">
              {filteredArticles.length === 0 && <Empty text="조건에 맞는 콘텐츠가 없습니다." />}
              {filteredArticles.map((a) => {
                const warnings = carouselWarnings(a.carousel_json);
                return (
                  <div key={a.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={`/news/${a.slug}`}
                            target="_blank"
                            className="font-bold text-slate-900 hover:text-[var(--color-gold-light)]"
                          >
                            {a.title}
                          </a>
                          {warnings.length > 0 && (
                            <span
                              title={warnings.join(" / ")}
                              className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700"
                            >
                              ⚠️ 카드 검증 {warnings.length}건
                            </span>
                          )}
                          {isEvergreen(a) && a.seed_key && (
                            <span className="rounded border border-[var(--color-line)] bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                              {a.seed_key}
                            </span>
                          )}
                          {isEvergreen(a) && a.needs_human_review === true && (
                            <span className="rounded-full border border-red-500 bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                              🔴 검증 필요
                            </span>
                          )}
                          {(a.verify_claims?.length ?? 0) > 0 && (
                            <span className="text-[10px] font-semibold text-slate-500">
                              검증 항목 {a.verify_claims?.length}건
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {a.category} · 조회 {a.view_count} · {fmtDate(a.created_at)}
                        </p>
                      </div>
                      {/* 발행 컨트롤 — 무음 실패 금지: updateRow 실패(세션 만료 401 등)를 낙관적
                          UI가 가리면 '눌러도 안 되는' 것처럼 보인다 → 실패 시 롤백+토스트, 성공도 토스트 */}
                      <PublishControls
                        article={a}
                        // 발행 게이트(§6.9) — 본진 채널 유효 심의필 없으면 발행/예약 비활성
                        gateOk={reviewValid(reviewsByArticle.get(a.id)?.main, today)}
                        onPublish={async () => {
                          if (!passReviewGate(a)) return;
                          const clearReview = a.needs_human_review === true ? { needs_human_review: false } : {};
                          const published_at = new Date().toISOString();
                          const snapshot = articles;
                          setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_main_published: true, published_at, ...clearReview } : x)));
                          const { ok, error } = await updateRow("premium_articles", a.id, { is_main_published: true, ...clearReview });
                          if (!ok) setArticles(snapshot);
                          showToast(ok ? "발행 완료" : error ?? "발행 실패 — 새로고침(재로그인) 후 다시 시도하세요");
                        }}
                        onSchedule={async (iso) => {
                          if (!passReviewGate(a)) return;
                          const clearReview = a.needs_human_review === true ? { needs_human_review: false } : {};
                          const snapshot = articles;
                          setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_main_published: true, published_at: iso, ...clearReview } : x)));
                          const { ok, error } = await updateRow("premium_articles", a.id, { is_main_published: true, published_at: iso, ...clearReview });
                          if (!ok) setArticles(snapshot);
                          showToast(ok ? "예약 발행 확정" : error ?? "예약 실패 — 새로고침(재로그인) 후 다시 시도하세요");
                        }}
                        onDraft={async () => {
                          const snapshot = articles;
                          setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_main_published: false } : x)));
                          const { ok } = await updateRow("premium_articles", a.id, { is_main_published: false });
                          if (!ok) setArticles(snapshot);
                          showToast(ok ? "초안으로 회수 완료" : "회수 실패 — 새로고침(재로그인) 후 다시 시도하세요");
                        }}
                      />
                    </div>

                    {/* 게시위치(URL) 등록 리마인더 — 승인+게시됐는데 URL 미등록 채널이 있으면 노출 */}
                    <UrlReminderBanner
                      article={a}
                      reviews={reviewsByArticle.get(a.id) ?? {}}
                      today={today}
                      onSaved={upsertReview}
                      onToast={showToast}
                    />

                    {/* 액션 행: 검수·복사·삭제 */}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setPreviewArticle(a)}
                        className="rounded-full border border-[var(--color-forest)] px-4 py-2 text-xs font-bold text-[var(--color-forest)] transition-all hover:bg-[var(--color-forest)] hover:text-white"
                      >
                        본문 보기
                      </button>
                      {a.naver_blog_content && (
                        <button
                          onClick={() =>
                            copy(
                              `${a.naver_title ?? a.title}\n\n${toNaverText(a.naver_blog_content ?? "", {
                                articleTitle: a.title,
                                slug: a.slug,
                                tags: a.tags,
                              })}`,
                              "네이버 원고 (네이버 제목 + 본진 링크 + 태그 첨부)"
                            )
                          }
                          title="네이버 전용 제목 포함 · 마크다운 기호 제거 · [이미지] 마커 유지 · 본진 기사 링크 + 진단 링크 + 해시태그 자동 첨부"
                          className="rounded-full border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-slate-700 hover:border-[var(--color-gold-dim)]"
                        >
                          네이버 복사 <span className="text-slate-400">· 텍스트 변환</span>
                        </button>
                      )}
                      {a.blogspot_content && (
                        <button
                          onClick={() =>
                            copy(
                              toBlogspotHtml(a.blogspot_content ?? "", a.slug, a.tags),
                              "블로그스팟 HTML (Blogger 'HTML 보기'에 붙여넣기)"
                            )
                          }
                          title="마크다운→HTML 변환 · 이미지 마커 제거 · 본진 링크 + 해시태그 삽입. 제목은 Blogger 제목란에 별도 입력"
                          className="rounded-full border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-slate-700 hover:border-[var(--color-gold-dim)]"
                        >
                          블로그스팟 복사 <span className="text-slate-400">· HTML 변환</span>
                        </button>
                      )}
                      {a.blogspot_title && (
                        <button
                          onClick={() => copy(a.blogspot_title ?? "", "블로그스팟 제목 (Blogger 제목란에 붙여넣기)")}
                          title="구글 자기잠식 방지용 별도 제목 — Blogger 제목란 전용"
                          className="rounded-full border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-slate-700 hover:border-[var(--color-gold-dim)]"
                        >
                          블로그스팟 제목 복사
                        </button>
                      )}
                      {a.instagram_caption && (
                        <button
                          onClick={() => copy(a.instagram_caption ?? "", "인스타 캡션")}
                          className="rounded-full border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-slate-700 hover:border-[var(--color-gold-dim)]"
                        >
                          인스타 캡션 복사
                        </button>
                      )}
                      {(a.threads_json?.length ?? 0) > 0 && (
                        <button
                          onClick={() => setThreadsArticle(a)}
                          title="스레드 본글·이어달기 답글을 글별로 복사"
                          className="rounded-full border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-slate-700 hover:border-[var(--color-gold-dim)]"
                        >
                          스레드 보기 <span className="text-slate-400">· {a.threads_json?.length}글</span>
                        </button>
                      )}
                      {a.image_paths?.length > 0 && (
                        <button
                          onClick={() => downloadZip(`insta-${a.id}`, a.image_paths, `${a.slug}-cards.zip`, "인스타 카드")}
                          disabled={zipping === `insta-${a.id}`}
                          className="rounded-full border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-slate-700 hover:border-[var(--color-gold-dim)] disabled:opacity-40"
                        >
                          {zipping === `insta-${a.id}` ? "ZIP 생성 중..." : `인스타 카드 ZIP (${a.image_paths.length})`}
                        </button>
                      )}
                      <button
                        onClick={() => removeArticle(a)}
                        className="ml-auto rounded-full border border-red-200 px-4 py-2 text-xs font-semibold text-red-600 transition-all hover:border-red-400 hover:bg-red-50"
                      >
                        삭제
                      </button>
                    </div>

                    {/* 배포 체크리스트 */}
                    <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-[var(--color-line)] bg-white/60 px-4 py-2.5">
                      <span className="text-[11px] font-bold tracking-wide text-slate-400">배포</span>
                      {([
                        ["네이버", "is_naver_published", "naver", a.is_naver_published],
                        ["블로그스팟", "is_blogspot_published", "blogspot", a.is_blogspot_published],
                        ["인스타", "is_instagram_published", "instagram", a.is_instagram_published],
                        ["스레드", "is_threads_published", "threads", a.is_threads_published],
                      ] as const).map(([label, field, channel, checked]) => {
                        // 발행 게이트 — 유효 심의필 없으면 켜기 금지(끄기는 허용). 서버 트리거가 최후 방어선.
                        const canOn = reviewValid(reviewsByArticle.get(a.id)?.[channel], today);
                        const locked = !checked && !canOn;
                        return (
                          <label
                            key={field}
                            title={locked ? "게시 전 광고심의가 필요합니다 (금소법 제22조)" : undefined}
                            className={`flex items-center gap-1.5 text-xs ${locked ? "text-slate-400" : "text-slate-700"}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={locked}
                              className="h-4 w-4 accent-[var(--color-forest)] disabled:opacity-40"
                              onChange={async (e) => {
                                const v = e.target.checked;
                                const snapshot = articles;
                                setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, [field]: v } : x)));
                                const { ok, error } = await updateRow("premium_articles", a.id, { [field]: v });
                                if (!ok) {
                                  setArticles(snapshot);
                                  showToast(error ?? "배포 상태 변경 실패");
                                }
                              }}
                            />
                            {label}
                          </label>
                        );
                      })}
                    </div>

                    {/* 광고심의 관리 패널 — 5채널 상태·신청·심의필·반려 (§6.9) */}
                    <AdReviewPanel
                      article={a}
                      reviews={reviewsByArticle.get(a.id) ?? {}}
                      today={today}
                      onSaved={upsertReview}
                      onToast={showToast}
                      onCopy={copy}
                    />

                    {/* 인스타 세로 카드 썸네일 */}
                    {a.image_paths?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {a.image_paths.map((url, i) => (
                          <button
                            key={url}
                            onClick={() => setLightbox({ images: a.image_paths, slug: a.slug, index: i })}
                            title={`카드 ${i + 1} 확대`}
                            className="group relative block h-24 w-[76px] overflow-hidden rounded-lg border border-[var(--color-line)] hover:border-[var(--color-gold-dim)]"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt={`카드 ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
                            <span className="absolute bottom-0 right-0 bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* 네이버 가로 이미지 세트 (썸네일·도식·CTA — 본문 [이미지] 마커 위치에 순서대로) */}
                    {(a.naver_image_paths?.length ?? 0) > 0 && (
                      <div className="mt-3 rounded-lg border border-[var(--color-line)] bg-white/60 px-4 py-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[11px] font-bold tracking-wide text-slate-400">
                            네이버 이미지 (본문 [이미지] 마커 위치에 순서대로)
                          </span>
                          <button
                            onClick={() => downloadZip(`naver-${a.id}`, a.naver_image_paths ?? [], `${a.slug}-naver.zip`, "네이버 이미지")}
                            disabled={zipping === `naver-${a.id}`}
                            className="rounded-full border border-[var(--color-line)] px-3 py-1 text-[11px] font-semibold text-slate-700 hover:border-[var(--color-gold-dim)] disabled:opacity-40"
                          >
                            {zipping === `naver-${a.id}` ? "ZIP 생성 중..." : `네이버 ZIP (${a.naver_image_paths?.length})`}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(a.naver_image_paths ?? []).map((url, i) => (
                            <button
                              key={url}
                              onClick={() => setLightbox({ images: a.naver_image_paths ?? [], slug: a.slug, index: i })}
                              title={`네이버 이미지 ${i + 1} 확대`}
                              className="group relative block h-16 w-28 overflow-hidden rounded-lg border border-[var(--color-line)] hover:border-[var(--color-gold-dim)]"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={`네이버 이미지 ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
                              <span className="absolute bottom-0 right-0 bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ─── 진단 리드 탭 ─── */}
        {tab === "leads" && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {["전체", ...LEAD_STATUSES].map((s) => (
                <button key={s} onClick={() => setLeadFilter(s)} className={chipBtn(leadFilter === s)}>
                  {s}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              {filteredLeads.length === 0 && <Empty text="조건에 맞는 리드가 없습니다." />}
              {filteredLeads.map((l) => (
                <LeadCard
                  key={l.id}
                  lead={l}
                  onCopyPhone={() => copy(l.phone, "연락처")}
                  onStatus={(status) => {
                    setLeads((prev) => prev.map((x) => (x.id === l.id ? { ...x, status } : x)));
                    updateRow("lead_consultings", l.id, { status });
                  }}
                  onMemo={async (memo) => {
                    setLeads((prev) => prev.map((x) => (x.id === l.id ? { ...x, memo } : x)));
                    const { ok } = await updateRow("lead_consultings", l.id, { memo });
                    showToast(ok ? "메모 저장 완료" : "메모 저장 실패");
                  }}
                  onDelete={() => removeLead(l)}
                  selectCls={selectCls}
                />
              ))}
            </div>
          </>
        )}

        {/* ─── 지식iN 어시스트 탭 (커밋 P2 — 게시는 100% 수동) ─── */}
        {tab === "kin" && (
          <KinTab
            answers={kinAnswers}
            setAnswers={setKinAnswers}
            articleOptions={articles
              .filter((a) => a.is_naver_published)
              .map((a) => ({ id: a.id, title: a.title, naver_title: a.naver_title }))}
            onCopy={copy}
            onToast={showToast}
            selectCls={selectCls}
            chipBtn={chipBtn}
          />
        )}

        {/* ─── 상담 신청 탭 — 리드(커밋 I)와 동등한 관리: 상태·메모·삭제·연락처 복사 ─── */}
        {tab === "consults" && (
          <div className="space-y-3">
            {consults.length === 0 && <Empty text="아직 상담 신청이 없습니다." />}
            {consults.map((c) => (
              <ConsultCard
                key={c.id}
                consult={c}
                onCopyPhone={() => copy(c.phone, "연락처")}
                onStatus={async (status) => {
                  const snapshot = consults;
                  setConsults((prev) => prev.map((x) => (x.id === c.id ? { ...x, status } : x)));
                  const { ok } = await updateRow("consultations", c.id, { status });
                  if (!ok) setConsults(snapshot);
                  showToast(ok ? "상태 변경 완료" : "상태 변경 실패 — 새로고침 후 다시 시도하세요");
                }}
                onMemo={async (memo) => {
                  const snapshot = consults;
                  setConsults((prev) => prev.map((x) => (x.id === c.id ? { ...x, memo } : x)));
                  const { ok } = await updateRow("consultations", c.id, { memo });
                  if (!ok) setConsults(snapshot);
                  showToast(ok ? "메모 저장 완료" : "메모 저장 실패");
                }}
                onDelete={() => removeConsult(c)}
                selectCls={selectCls}
              />
            ))}
          </div>
        )}
      </div>

      {/* 본문 미리보기 모달 */}
      {previewArticle && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closePreview}
        >
          <div
            className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ${
              showSource ? "max-w-6xl" : "max-w-3xl"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-6 py-4">
              <div>
                <p className="text-[11px] font-semibold text-slate-400">{previewArticle.category} · 발행 전 검수</p>
                <h2 className="mt-0.5 font-bold text-slate-900">{previewArticle.title}</h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/* 원문 대조 — 원문이 보존된 기사에서만 활성. 잘린 원문으로는 대조가 성립하지 않는다 */}
                <button
                  onClick={() => setShowSource((v) => !v)}
                  disabled={!previewArticle.raw_source_fulltext}
                  title={previewArticle.raw_source_fulltext ? "원문 전문을 나란히 열어 대조합니다" : "원문 미보존 — 대조 불가"}
                  className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {showSource ? "원문 닫기" : "원문 보기"}
                </button>
                <button onClick={closePreview} className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
                  닫기 (ESC)
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1">
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* 사실검증 체크리스트(M4-1) — 체크는 확인용 로컬 상태이며 저장하지 않는다.
                  뉴스도 고위험 주제(분쟁·판례·세법·의료) 감지 시 항목이 실리므로 content_type을 가리지 않는다 */}
              {(previewArticle.verify_claims?.length ?? 0) > 0 && (
                <details
                  className="mb-4 rounded-lg border border-red-200 bg-red-50/70"
                  open={previewArticle.needs_human_review === true}
                >
                  <summary className="cursor-pointer select-none px-4 py-3 text-sm font-bold text-red-800">
                    발행 전 사실검증 체크리스트 ({previewArticle.verify_claims?.length}건)
                    {previewArticle.needs_human_review === true && (
                      <span className="ml-2 rounded-full border border-red-500 bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                        🔴 검증 필요
                      </span>
                    )}
                  </summary>
                  {/* 원문이 없으면 체크리스트를 채울 근거 자체가 없다 — 체크 전에 그 사실을 먼저 알린다 */}
                  {previewArticle.raw_source_fulltext ? (
                    <button
                      onClick={() => setShowSource(true)}
                      className="mx-4 mb-3 block text-xs font-semibold text-red-700 underline underline-offset-2 hover:text-red-900"
                    >
                      원문 전문 열어서 대조하기 ({previewArticle.raw_source_fulltext.length.toLocaleString()}자)
                    </button>
                  ) : (
                    <p className="mx-4 mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      ⚠️ 원문 미보존 — 대조 불가. 이 기사는 원문 전문이 저장되기 전에 생성됐습니다.
                      {previewArticle.raw_source_url && " 아래 원문 URL로 직접 확인하세요."}
                    </p>
                  )}
                  <ol className="space-y-3 px-4 pb-4">
                    {(previewArticle.verify_claims ?? []).map((c, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-forest)]" />
                        <div className="text-sm leading-relaxed text-slate-800">
                          <span className="font-bold tabular-nums text-slate-500">{i + 1}.</span> {c.claim ?? "-"}
                          {(c.basis || c.confidence) && (
                            <p className="mt-0.5 text-xs text-slate-500">
                              {c.basis && <>근거: {c.basis}</>}
                              {c.basis && c.confidence && " · "}
                              {c.confidence && <>확신도 {c.confidence}</>}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {previewArticle.summary && (
                <div className="mb-4 rounded-lg bg-slate-50 p-4">
                  <p className="text-[11px] font-bold text-slate-400">SUMMARY</p>
                  <p className="mt-1 text-sm text-slate-700">{previewArticle.summary}</p>
                </div>
              )}
              {(previewArticle.key_points?.length ?? 0) > 0 && (
                <div className="mb-4 rounded-lg bg-slate-50 p-4">
                  <p className="text-[11px] font-bold text-slate-400">핵심 3줄</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                    {previewArticle.key_points?.map((k) => <li key={k}>{k}</li>)}
                  </ul>
                </div>
              )}
              {previewArticle.remodeling_bridge && (
                <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-[11px] font-bold text-emerald-600">리모델링 다리</p>
                  <p className="mt-1 text-sm text-emerald-900">{previewArticle.remodeling_bridge}</p>
                </div>
              )}
              <article className="admin-md text-[15px] leading-relaxed text-slate-800">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {previewArticle.main_website_markdown ?? "_본문 없음_"}
                </ReactMarkdown>
              </article>
            </div>
            {/* 우측 원문 패널 — 좌(생성 원고) / 우(수집 원문 전문) 대조. 독립 스크롤 */}
            {showSource && previewArticle.raw_source_fulltext && (
              <aside className="flex w-1/2 shrink-0 flex-col border-l border-[var(--color-line)] bg-slate-50">
                <div className="flex items-baseline justify-between gap-2 border-b border-[var(--color-line)] px-5 py-3">
                  <p className="text-[11px] font-bold text-slate-500">
                    수집 원문 전문 · {previewArticle.raw_source_fulltext.length.toLocaleString()}자
                    {previewArticle.raw_source_name && ` · ${previewArticle.raw_source_name}`}
                  </p>
                  {previewArticle.raw_source_url && (
                    <a
                      href={previewArticle.raw_source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-[11px] font-semibold text-slate-500 underline underline-offset-2 hover:text-slate-800"
                    >
                      원문 URL ↗
                    </a>
                  )}
                </div>
                <div className="overflow-y-auto px-5 py-4">
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
                    {previewArticle.raw_source_fulltext}
                  </p>
                </div>
              </aside>
            )}
            </div>
          </div>
          {/* 모달 내부 마크다운 최소 스타일 (관리자 전용 스코프) */}
          <style>{`
            .admin-md h2 { font-size: 1.15rem; font-weight: 700; margin: 1.4em 0 0.5em; color: #0f172a; }
            .admin-md h3 { font-size: 1.02rem; font-weight: 700; margin: 1.2em 0 0.4em; color: #1e293b; }
            .admin-md p { margin: 0.6em 0; }
            .admin-md ul, .admin-md ol { margin: 0.6em 0; padding-left: 1.4em; list-style: disc; }
            .admin-md ol { list-style: decimal; }
            .admin-md blockquote { margin: 1em 0; border-left: 3px solid #a8842c; background: #faf8f3; padding: 0.6em 1em; }
            .admin-md table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.9em; }
            .admin-md th { background: #f1f5f9; font-weight: 700; }
            .admin-md th, .admin-md td { border: 1px solid #e2e8f0; padding: 0.5em 0.7em; text-align: left; }
            .admin-md strong { font-weight: 700; }
          `}</style>
        </div>
      )}

      {/* 스레드 문구 모달 — day 순 나열, 글별/답글별 복사 (줄바꿈 유지된 채 클립보드로) */}
      {threadsArticle && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setThreadsArticle(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[var(--color-line)] px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold text-slate-400">
                    스레드 문구 · {threadsArticle.threads_json?.length ?? 0}글
                  </p>
                  <h2 className="mt-0.5 font-bold text-slate-900">{threadsArticle.title}</h2>
                </div>
                <button
                  onClick={() => setThreadsArticle(null)}
                  className="shrink-0 rounded-full border border-[var(--color-line)] px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  닫기 (ESC)
                </button>
              </div>
              <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                본문에 링크 금지(도달 하락). 링크는 마지막 답글에. 인스타 캡션 복붙 금지.
              </p>
            </div>
            <div className="space-y-4 overflow-y-auto px-6 py-5">
              {[...(threadsArticle.threads_json ?? [])]
                .sort((x, y) => x.day - y.day)
                .map((p, i) => (
                  <div key={i} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900">{p.label}</p>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[11px] font-semibold tabular-nums ${
                            p.body.length > 500 ? "text-red-600" : "text-slate-400"
                          }`}
                        >
                          {p.body.length}자{p.body.length > 500 && " ⚠️ 500자 초과"}
                        </span>
                        <button
                          onClick={() => copy(p.body, `${p.label} 본글`)}
                          className="rounded-full border border-[var(--color-line)] px-3 py-1 text-[11px] font-semibold text-slate-700 hover:border-[var(--color-gold-dim)]"
                        >
                          본글 복사
                        </button>
                      </div>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">{p.body}</p>
                    {(p.replies ?? []).map((r, j) => (
                      <div key={j} className="ml-1 mt-3 border-l-2 border-[var(--color-line)] pl-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-bold text-slate-500">↳ 답글 {j + 1}</p>
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[11px] font-semibold tabular-nums ${
                                r.length > 500 ? "text-red-600" : "text-slate-400"
                              }`}
                            >
                              {r.length}자{r.length > 500 && " ⚠️ 500자 초과"}
                            </span>
                            <button
                              onClick={() => copy(r, `${p.label} 답글 ${j + 1}`)}
                              className="rounded-full border border-[var(--color-line)] px-3 py-1 text-[11px] font-semibold text-slate-700 hover:border-[var(--color-gold-dim)]"
                            >
                              복사
                            </button>
                          </div>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">{r}</p>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* 카드 라이트박스 */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setLightbox((lb) => (lb ? { ...lb, index: Math.max(lb.index - 1, 0) } : lb))}
              disabled={lightbox.index === 0}
              className="rounded-full bg-white/10 px-4 py-3 text-xl text-white disabled:opacity-20"
              aria-label="이전 카드"
            >
              ←
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.images[lightbox.index]}
              alt={`이미지 ${lightbox.index + 1}`}
              className="max-h-[80vh] max-w-[80vw] rounded-lg object-contain"
            />
            <button
              onClick={() =>
                setLightbox((lb) =>
                  lb ? { ...lb, index: Math.min(lb.index + 1, lb.images.length - 1) } : lb
                )
              }
              disabled={lightbox.index === lightbox.images.length - 1}
              className="rounded-full bg-white/10 px-4 py-3 text-xl text-white disabled:opacity-20"
              aria-label="다음 카드"
            >
              →
            </button>
          </div>
          <div className="mt-4 flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm tabular-nums text-white/80">
              {lightbox.index + 1} / {lightbox.images.length}
            </span>
            <button
              onClick={() =>
                downloadImage(
                  lightbox.images[lightbox.index],
                  `${lightbox.slug}-${lightbox.images[lightbox.index].split("/").pop() ?? "image.png"}`
                )
              }
              className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-slate-900"
            >
              이 카드 다운로드
            </button>
            <button onClick={() => setLightbox(null)} className="text-xs text-white/60 hover:text-white">
              닫기 (ESC)
            </button>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}

/* ── 리드 카드 ── */
function LeadCard({
  lead: l,
  onCopyPhone,
  onStatus,
  onMemo,
  onDelete,
  selectCls,
}: {
  lead: Lead;
  onCopyPhone: () => void;
  onStatus: (status: string) => void;
  onMemo: (memo: string) => void;
  onDelete: () => void;
  selectCls: string;
}) {
  const [memoDraft, setMemoDraft] = useState(l.memo ?? "");
  const r = (l.quiz_responses ?? {}) as Record<string, unknown>;
  const rows: [string, string][] = [
    ["월 보험료", String(r.premium ?? "-")],
    ["보유 보장", Array.isArray(r.coverages) ? (r.coverages as string[]).join(" · ") : "-"],
    ["최대 관심 리스크", String(r.risk ?? "-")],
    ["연령/가족", String(r.profile ?? "-")],
  ];
  const statusOptions = LEAD_STATUSES.includes(l.status) ? LEAD_STATUSES : [l.status, ...LEAD_STATUSES];

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold text-slate-900">{l.name}</span>
          <button onClick={onCopyPhone} title="클릭하면 복사" className="text-sm font-semibold text-[var(--color-gold-light)] hover:underline">
            {l.phone}
          </button>
          {l.quiz_score != null && (
            <span className="rounded-full border border-[var(--color-gold-dim)]/50 px-3 py-1 text-xs font-bold text-[var(--color-gold-light)]">
              방어력 {l.quiz_score}점
            </span>
          )}
          <span className="text-xs text-slate-500">
            {fmtDate(l.created_at)} · 유입 {l.lead_source ?? "direct"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select className={selectCls} value={l.status} onChange={(e) => onStatus(e.target.value)}>
            {statusOptions.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button
            onClick={onDelete}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:border-red-400 hover:bg-red-50"
          >
            삭제
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-2 text-xs">
            <span className="w-24 shrink-0 font-semibold text-slate-400">{label}</span>
            <span className="text-slate-700">{value}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-start gap-2">
        <textarea
          value={memoDraft}
          onChange={(e) => setMemoDraft(e.target.value)}
          placeholder="상담 이력 메모..."
          rows={2}
          className="min-h-[3rem] flex-1 rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-[var(--color-gold)]"
        />
        <button
          onClick={() => onMemo(memoDraft)}
          disabled={memoDraft === (l.memo ?? "")}
          className="rounded-lg border border-[var(--color-line)] px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[var(--color-gold-dim)] disabled:opacity-30"
        >
          메모 저장
        </button>
      </div>
    </div>
  );
}

/* ── 상담 신청 카드 — LeadCard 패턴 재사용 (상태 어휘도 리드와 통일, 기존 값은 표시 호환) ── */
function ConsultCard({
  consult: c,
  onCopyPhone,
  onStatus,
  onMemo,
  onDelete,
  selectCls,
}: {
  consult: Consultation;
  onCopyPhone: () => void;
  onStatus: (status: string) => void;
  onMemo: (memo: string) => void;
  onDelete: () => void;
  selectCls: string;
}) {
  const [memoDraft, setMemoDraft] = useState(c.memo ?? "");
  const statusOptions = LEAD_STATUSES.includes(c.status) ? LEAD_STATUSES : [c.status, ...LEAD_STATUSES];

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold text-slate-900">{c.name}</span>
          <button onClick={onCopyPhone} title="클릭하면 복사" className="text-sm font-semibold text-[var(--color-gold-light)] hover:underline">
            {c.phone}
          </button>
          <span className="rounded-full border border-[var(--color-line)] px-2.5 py-0.5 text-[11px] text-slate-600">{c.category}</span>
          <span className="text-xs text-slate-500">{fmtDate(c.created_at)}</span>
        </div>
        <div className="flex items-center gap-2">
          <select className={selectCls} value={c.status} onChange={(e) => onStatus(e.target.value)}>
            {statusOptions.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button
            onClick={onDelete}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:border-red-400 hover:bg-red-50"
          >
            삭제
          </button>
        </div>
      </div>

      {c.message && <p className="mt-3 text-sm leading-relaxed text-slate-600">{c.message}</p>}

      <div className="mt-4 flex items-start gap-2">
        <textarea
          value={memoDraft}
          onChange={(e) => setMemoDraft(e.target.value)}
          placeholder="상담 이력 메모..."
          rows={2}
          className="min-h-[3rem] flex-1 rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-[var(--color-gold)]"
        />
        <button
          onClick={() => onMemo(memoDraft)}
          disabled={memoDraft === (c.memo ?? "")}
          className="rounded-lg border border-[var(--color-line)] px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[var(--color-gold-dim)] disabled:opacity-30"
        >
          메모 저장
        </button>
      </div>
    </div>
  );
}

/** 발행 통제 — 상태 뱃지(초안/발행됨/예약) + 발행·예약발행·초안으로 액션 */
function PublishControls({
  article,
  gateOk,
  onPublish,
  onSchedule,
  onDraft,
}: {
  article: Article;
  /** 본진 채널 유효 심의필 보유 여부 — false면 발행/예약 비활성 (금소법 제22조) */
  gateOk: boolean;
  onPublish: () => void;
  onSchedule: (iso: string) => void;
  onDraft: () => void;
}) {
  const [scheduling, setScheduling] = useState(false);
  const [when, setWhen] = useState("");
  // 현재 시각은 렌더 중 직접 읽으면 순수성 규칙 위반 → lazy initializer로 마운트 시 1회 캡처
  const [now] = useState(() => Date.now());

  const isFuture = !!article.published_at && new Date(article.published_at).getTime() > now;
  const status: "draft" | "scheduled" | "published" = !article.is_main_published
    ? "draft"
    : isFuture
      ? "scheduled"
      : "published";

  const badge = {
    draft: { text: "초안", cls: "border-amber-300 bg-amber-50 text-amber-700" },
    published: { text: "발행됨", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" },
    scheduled: {
      text: `예약 · ${article.published_at ? fmtDate(article.published_at) : ""}`,
      cls: "border-sky-300 bg-sky-50 text-sky-700",
    },
  }[status];

  const btn = "rounded-full border px-3 py-1.5 text-xs font-semibold transition-all";

  return (
    <div className="flex flex-col items-end gap-2">
      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
        {badge.text}
      </span>
      {status !== "published" && !gateOk && (
        <span
          title="게시 전 광고심의가 필요합니다 (금소법 제22조)"
          className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[10px] font-bold text-red-600"
        >
          🔒 심의 미완료 — 발행 불가
        </span>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {status !== "published" && (
          <button
            onClick={onPublish}
            disabled={!gateOk}
            title={gateOk ? undefined : "게시 전 광고심의가 필요합니다 (금소법 제22조)"}
            className={`${btn} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-600`}
          >
            발행
          </button>
        )}
        {!scheduling ? (
          status !== "published" && (
            <button
              onClick={() => setScheduling(true)}
              disabled={!gateOk}
              title={gateOk ? undefined : "게시 전 광고심의가 필요합니다 (금소법 제22조)"}
              className={`${btn} border-[var(--color-line)] text-slate-600 hover:border-[var(--color-gold-dim)] disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {status === "scheduled" ? "예약변경" : "예약발행"}
            </button>
          )
        ) : (
          <span className="flex items-center gap-1">
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="rounded-lg border border-[var(--color-line)] bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-[var(--color-gold)]"
            />
            <button
              onClick={() => {
                if (!when) return;
                onSchedule(new Date(when).toISOString());
                setScheduling(false);
              }}
              disabled={!gateOk}
              className={`${btn} border-sky-600 bg-sky-600 text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40`}
            >
              확정
            </button>
            <button
              onClick={() => setScheduling(false)}
              className={`${btn} border-transparent text-slate-500 hover:text-slate-700`}
            >
              취소
            </button>
          </span>
        )}
        {status !== "draft" && (
          <button
            onClick={onDraft}
            className={`${btn} border-[var(--color-line)] text-slate-600 hover:border-amber-400 hover:text-amber-700`}
          >
            초안으로
          </button>
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] px-6 py-14 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}
