"use client";

import { useState } from "react";

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
interface Article {
  id: string;
  title: string;
  slug: string;
  category: string;
  is_main_published: boolean;
  is_naver_published: boolean;
  is_blogspot_published: boolean;
  is_instagram_published: boolean;
  naver_blog_content: string | null;
  blogspot_content: string | null;
  image_paths: string[];
  view_count: number;
  published_at: string | null;
  created_at: string;
}

const LEAD_STATUSES = ["new", "연락완료", "계약진행", "보류"];
const CONSULT_STATUSES = ["접수완료", "연락완료", "계약진행", "보류"];

function fmtDate(s: string) {
  return new Date(s).toLocaleString("ko-KR", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

async function updateRow(table: string, id: string, fields: Record<string, unknown>) {
  const res = await fetch("/api/admin/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, id, fields }),
  });
  if (!res.ok) alert("저장 실패 — 새로고침 후 다시 시도해 주세요.");
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
  const [tab, setTab] = useState<"leads" | "consults" | "articles">("leads");
  const [leads, setLeads] = useState(initialLeads);
  const [consults, setConsults] = useState(initialConsults);
  const [articles, setArticles] = useState(initialArticles);
  const [copied, setCopied] = useState("");

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
  };

  const selectCls =
    "rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-[var(--color-gold)]";

  return (
    <main className="min-h-screen bg-[var(--color-ink)] pt-16">
      <div className="mx-auto max-w-7xl px-6 py-10 md:px-12">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">운영 콘솔</h1>
            <p className="text-xs text-slate-500">신순주의 선한 금융 · 관리자 전용</p>
          </div>
          <div className="flex gap-2">
            {([
              ["leads", `진단 리드 ${leads.length}`],
              ["consults", `상담 신청 ${consults.length}`],
              ["articles", `콘텐츠 ${articles.length}`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-full border px-4 py-2 text-xs font-semibold transition-all ${
                  tab === key
                    ? "border-[var(--color-gold)] bg-[var(--color-gold)] text-white"
                    : "border-[var(--color-line)] text-slate-600 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 진단 리드 */}
        {tab === "leads" && (
          <div className="space-y-3">
            {leads.length === 0 && <Empty text="아직 진단 리드가 없습니다." />}
            {leads.map((l) => (
              <div key={l.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-bold text-slate-900">{l.name}</span>
                    <a href={`tel:${l.phone}`} className="ml-3 text-sm text-[var(--color-gold-light)]">{l.phone}</a>
                    <span className="ml-3 text-xs text-slate-500">{fmtDate(l.created_at)} · 유입 {l.lead_source ?? "-"}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {l.quiz_score != null && (
                      <span className="rounded-full border border-[var(--color-gold-dim)]/50 px-3 py-1 text-xs font-bold text-[var(--color-gold-light)]">
                        방어력 {l.quiz_score}점
                      </span>
                    )}
                    <select
                      className={selectCls}
                      value={l.status}
                      onChange={(e) => {
                        const status = e.target.value;
                        setLeads((prev) => prev.map((x) => (x.id === l.id ? { ...x, status } : x)));
                        updateRow("lead_consultings", l.id, { status });
                      }}
                    >
                      {LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                {l.quiz_responses && (
                  <p className="mt-3 text-xs leading-relaxed text-slate-500">
                    {Object.entries(l.quiz_responses)
                      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("·") : v}`)
                      .join("  |  ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 상담 신청 */}
        {tab === "consults" && (
          <div className="space-y-3">
            {consults.length === 0 && <Empty text="아직 상담 신청이 없습니다." />}
            {consults.map((c) => (
              <div key={c.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-bold text-slate-900">{c.name}</span>
                    <a href={`tel:${c.phone}`} className="ml-3 text-sm text-[var(--color-gold-light)]">{c.phone}</a>
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

        {/* 콘텐츠 */}
        {tab === "articles" && (
          <div className="space-y-3">
            {articles.length === 0 && (
              <Empty text="아직 콘텐츠가 없습니다. 새벽 자동 발행이 시작되면 여기에 쌓입니다. (GitHub Actions → Run workflow로 즉시 테스트 가능)" />
            )}
            {articles.map((a) => (
              <div key={a.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a
                      href={`/news/${a.slug}`}
                      target="_blank"
                      className="font-bold text-slate-900 hover:text-[var(--color-gold-light)]"
                    >
                      {a.title}
                    </a>
                    <p className="mt-1 text-xs text-slate-500">
                      {a.category} · 조회 {a.view_count} · {fmtDate(a.created_at)}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={a.is_main_published}
                      className="h-4 w-4 accent-[var(--color-gold)]"
                      onChange={(e) => {
                        const v = e.target.checked;
                        setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_main_published: v } : x)));
                        updateRow("premium_articles", a.id, { is_main_published: v });
                      }}
                    />
                    사이트 공개
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {a.naver_blog_content && (
                    <button
                      onClick={() => {
                        copy(`${a.title}\n\n${a.naver_blog_content}`, `n-${a.id}`);
                        setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_naver_published: true } : x)));
                        updateRow("premium_articles", a.id, { is_naver_published: true });
                      }}
                      className={`rounded-full border px-4 py-2 text-xs font-semibold transition-all ${
                        a.is_naver_published
                          ? "border-emerald-800 text-emerald-400"
                          : "border-[var(--color-line)] text-slate-700 hover:border-[var(--color-gold-dim)]"
                      }`}
                    >
                      {copied === `n-${a.id}` ? "✓ 복사됨!" : a.is_naver_published ? "네이버 원고 다시 복사" : "네이버 원고 복사"}
                    </button>
                  )}
                  {a.blogspot_content && (
                    <button
                      onClick={() => {
                        copy(`${a.title}\n\n${a.blogspot_content}`, `b-${a.id}`);
                        setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_blogspot_published: true } : x)));
                        updateRow("premium_articles", a.id, { is_blogspot_published: true });
                      }}
                      className={`rounded-full border px-4 py-2 text-xs font-semibold transition-all ${
                        a.is_blogspot_published
                          ? "border-emerald-800 text-emerald-400"
                          : "border-[var(--color-line)] text-slate-700 hover:border-[var(--color-gold-dim)]"
                      }`}
                    >
                      {copied === `b-${a.id}` ? "✓ 복사됨!" : a.is_blogspot_published ? "블로그스팟 다시 복사" : "블로그스팟 원고 복사"}
                    </button>
                  )}
                  {a.image_paths?.length > 0 && (
                    <>
                      {a.image_paths.map((url, i) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          className="rounded-full border border-[var(--color-line)] px-3 py-2 text-xs text-slate-600 hover:border-[var(--color-gold-dim)] hover:text-[var(--color-gold-light)]"
                        >
                          카드{i + 1}
                        </a>
                      ))}
                      <label className="ml-1 flex items-center gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={a.is_instagram_published}
                          className="h-4 w-4 accent-[var(--color-gold)]"
                          onChange={(e) => {
                            const v = e.target.checked;
                            setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_instagram_published: v } : x)));
                            updateRow("premium_articles", a.id, { is_instagram_published: v });
                          }}
                        />
                        인스타 업로드 완료
                      </label>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] px-6 py-14 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}
