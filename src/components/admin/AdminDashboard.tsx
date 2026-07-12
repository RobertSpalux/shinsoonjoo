"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toBlogspotHtml, toNaverText } from "@/lib/osmu-format";

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
  created_at: string;
}
interface CarouselCard {
  type?: string;
  overline?: string;
  headline?: string;
  body?: string;
  heading?: string; // 구형 호환
}
interface Article {
  id: string;
  title: string;
  slug: string;
  category: string;
  summary: string | null;
  key_points: string[] | null;
  remodeling_bridge: string | null;
  main_website_markdown: string | null;
  is_main_published: boolean;
  is_naver_published: boolean;
  is_blogspot_published: boolean;
  is_instagram_published: boolean;
  naver_blog_content: string | null;
  blogspot_content: string | null;
  instagram_caption: string | null;
  carousel_json: CarouselCard[] | null;
  image_paths: string[];
  view_count: number;
  published_at: string | null;
  created_at: string;
}

const LEAD_STATUSES = ["new", "연락함", "상담예정", "전환", "보류"];
const CONSULT_STATUSES = ["접수완료", "연락완료", "계약진행", "보류"];
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

async function updateRow(table: string, id: string, fields: Record<string, unknown>) {
  const res = await fetch("/api/admin/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, id, fields }),
  });
  return res.ok;
}

async function deleteRow(table: string, id: string) {
  const res = await fetch("/api/admin/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, id }),
  });
  return res.ok;
}

export default function AdminDashboard({
  leads: initialLeads,
  consultations: initialConsults,
  articles: initialArticles,
}: {
  leads: Lead[];
  consultations: Consultation[];
  articles: Article[];
}) {
  const [tab, setTab] = useState<"leads" | "consults" | "articles">("articles");
  const [leads, setLeads] = useState(initialLeads);
  const [consults, setConsults] = useState(initialConsults);
  const [articles, setArticles] = useState(initialArticles);

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
  const [articleFilter, setArticleFilter] = useState<(typeof ARTICLE_FILTERS)[number]>("전체");
  const [undistributedOnly, setUndistributedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [leadFilter, setLeadFilter] = useState("전체");

  // 모달
  const [previewArticle, setPreviewArticle] = useState<Article | null>(null);
  const [lightbox, setLightbox] = useState<{ article: Article; index: number } | null>(null);
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

  const filteredArticles = articles.filter((a) => {
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

  // 미리보기 모달 ESC 닫기
  useEffect(() => {
    if (!previewArticle) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewArticle(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewArticle]);

  // 라이트박스 키보드
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight")
        setLightbox((lb) =>
          lb ? { ...lb, index: Math.min(lb.index + 1, lb.article.image_paths.length - 1) } : lb
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

  const downloadZip = async (a: Article) => {
    if (!a.image_paths?.length) return;
    setZipping(a.id);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const [i, url] of a.image_paths.entries()) {
        const blob = await (await fetch(url)).blob();
        zip.file(`${a.slug}-card-${String(i + 1).padStart(2, "0")}.png`, blob);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `${a.slug}-cards.zip`);
      showToast(`카드 ${a.image_paths.length}장 ZIP 다운로드`);
    } catch {
      showToast("ZIP 생성 실패");
    } finally {
      setZipping("");
    }
  };

  const removeArticle = async (a: Article) => {
    if (
      !window.confirm(
        `⚠️ 기사 삭제\n\n"${a.title}"\n\n기사 원고·카드 이미지(Storage)가 모두 삭제되며 되돌릴 수 없습니다. 삭제할까요?`
      )
    )
      return;
    const ok = await deleteRow("premium_articles", a.id);
    if (ok) {
      setArticles((prev) => prev.filter((x) => x.id !== a.id));
      showToast("기사 삭제 완료");
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
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {a.category} · 조회 {a.view_count} · {fmtDate(a.created_at)}
                        </p>
                      </div>
                      <PublishControls
                        article={a}
                        onPublish={() => {
                          const published_at = new Date().toISOString();
                          setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_main_published: true, published_at } : x)));
                          updateRow("premium_articles", a.id, { is_main_published: true });
                        }}
                        onSchedule={(iso) => {
                          setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_main_published: true, published_at: iso } : x)));
                          updateRow("premium_articles", a.id, { is_main_published: true, published_at: iso });
                        }}
                        onDraft={() => {
                          setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_main_published: false } : x)));
                          updateRow("premium_articles", a.id, { is_main_published: false });
                        }}
                      />
                    </div>

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
                              `${a.title}\n\n${toNaverText(a.naver_blog_content ?? "")}`,
                              "네이버 원고 (에디터용 텍스트 변환)"
                            )
                          }
                          title="마크다운 기호 제거 · [이미지] 마커 유지 · 진단 링크 삽입"
                          className="rounded-full border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-slate-700 hover:border-[var(--color-gold-dim)]"
                        >
                          네이버 복사 <span className="text-slate-400">· 텍스트 변환</span>
                        </button>
                      )}
                      {a.blogspot_content && (
                        <button
                          onClick={() =>
                            copy(
                              toBlogspotHtml(a.blogspot_content ?? "", a.slug),
                              "블로그스팟 HTML (Blogger 'HTML 보기'에 붙여넣기)"
                            )
                          }
                          title="마크다운→HTML 변환 · 이미지 마커 제거 · 본진 링크 삽입. 제목은 Blogger 제목란에 별도 입력"
                          className="rounded-full border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-slate-700 hover:border-[var(--color-gold-dim)]"
                        >
                          블로그스팟 복사 <span className="text-slate-400">· HTML 변환</span>
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
                      {a.image_paths?.length > 0 && (
                        <button
                          onClick={() => downloadZip(a)}
                          disabled={zipping === a.id}
                          className="rounded-full border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-slate-700 hover:border-[var(--color-gold-dim)] disabled:opacity-40"
                        >
                          {zipping === a.id ? "ZIP 생성 중..." : `카드 전체 ZIP (${a.image_paths.length})`}
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
                        ["네이버", "is_naver_published", a.is_naver_published],
                        ["블로그스팟", "is_blogspot_published", a.is_blogspot_published],
                        ["인스타", "is_instagram_published", a.is_instagram_published],
                      ] as const).map(([label, field, checked]) => (
                        <label key={field} className="flex items-center gap-1.5 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={checked}
                            className="h-4 w-4 accent-[var(--color-forest)]"
                            onChange={(e) => {
                              const v = e.target.checked;
                              setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, [field]: v } : x)));
                              updateRow("premium_articles", a.id, { [field]: v });
                            }}
                          />
                          {label}
                        </label>
                      ))}
                    </div>

                    {/* 카드 썸네일 */}
                    {a.image_paths?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {a.image_paths.map((url, i) => (
                          <button
                            key={url}
                            onClick={() => setLightbox({ article: a, index: i })}
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
                    const ok = await updateRow("lead_consultings", l.id, { memo });
                    showToast(ok ? "메모 저장 완료" : "메모 저장 실패");
                  }}
                  onDelete={() => removeLead(l)}
                  selectCls={selectCls}
                />
              ))}
            </div>
          </>
        )}

        {/* ─── 상담 신청 탭 ─── */}
        {tab === "consults" && (
          <div className="space-y-3">
            {consults.length === 0 && <Empty text="아직 상담 신청이 없습니다." />}
            {consults.map((c) => (
              <div key={c.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-bold text-slate-900">{c.name}</span>
                    <button onClick={() => copy(c.phone, "연락처")} className="ml-3 text-sm text-[var(--color-gold-light)] hover:underline">
                      {c.phone}
                    </button>
                    <span className="ml-3 rounded-full border border-[var(--color-line)] px-2.5 py-0.5 text-[11px] text-slate-600">{c.category}</span>
                    <span className="ml-3 text-xs text-slate-500">{fmtDate(c.created_at)}</span>
                  </div>
                  <select
                    className={selectCls}
                    value={c.status}
                    onChange={(e) => {
                      const status = e.target.value;
                      setConsults((prev) => prev.map((x) => (x.id === c.id ? { ...x, status } : x)));
                      updateRow("consultations", c.id, { status });
                    }}
                  >
                    {CONSULT_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                {c.message && <p className="mt-3 text-sm leading-relaxed text-slate-600">{c.message}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 본문 미리보기 모달 */}
      {previewArticle && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreviewArticle(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-6 py-4">
              <div>
                <p className="text-[11px] font-semibold text-slate-400">{previewArticle.category} · 발행 전 검수</p>
                <h2 className="mt-0.5 font-bold text-slate-900">{previewArticle.title}</h2>
              </div>
              <button onClick={() => setPreviewArticle(null)} className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
                닫기 (ESC)
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-5">
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
              src={lightbox.article.image_paths[lightbox.index]}
              alt={`카드 ${lightbox.index + 1}`}
              className="max-h-[80vh] rounded-lg"
            />
            <button
              onClick={() =>
                setLightbox((lb) =>
                  lb ? { ...lb, index: Math.min(lb.index + 1, lb.article.image_paths.length - 1) } : lb
                )
              }
              disabled={lightbox.index === lightbox.article.image_paths.length - 1}
              className="rounded-full bg-white/10 px-4 py-3 text-xl text-white disabled:opacity-20"
              aria-label="다음 카드"
            >
              →
            </button>
          </div>
          <div className="mt-4 flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm tabular-nums text-white/80">
              {lightbox.index + 1} / {lightbox.article.image_paths.length}
            </span>
            <button
              onClick={() =>
                downloadImage(
                  lightbox.article.image_paths[lightbox.index],
                  `${lightbox.article.slug}-card-${String(lightbox.index + 1).padStart(2, "0")}.png`
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

/** 발행 통제 — 상태 뱃지(초안/발행됨/예약) + 발행·예약발행·초안으로 액션 */
function PublishControls({
  article,
  onPublish,
  onSchedule,
  onDraft,
}: {
  article: Article;
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
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {status !== "published" && (
          <button
            onClick={onPublish}
            className={`${btn} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700`}
          >
            발행
          </button>
        )}
        {!scheduling ? (
          status !== "published" && (
            <button
              onClick={() => setScheduling(true)}
              className={`${btn} border-[var(--color-line)] text-slate-600 hover:border-[var(--color-gold-dim)]`}
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
              className={`${btn} border-sky-600 bg-sky-600 text-white hover:bg-sky-700`}
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
