import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAdminAuthed } from "@/lib/admin-auth";
import { isFunnelPublic } from "@/lib/funnel/lead";
import { FUNNEL_COPY, funnelNotices } from "@/lib/funnel/copy";
import FunnelForm from "@/components/funnel/FunnelForm";

// 공개 스위치·관리자 쿠키를 매 요청 판정
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: FUNNEL_COPY.metaTitle,
  description: FUNNEL_COPY.metaDescription,
  alternates: { canonical: "/remodeling-check" },
  // 광고 랜딩 — 검색 색인 대상이 아니다(사이트맵에도 넣지 않는다)
  robots: { index: false, follow: false },
};

export default async function RemodelingCheckPage() {
  const isPublic = isFunnelPublic();
  if (!isPublic && !(await isAdminAuthed())) notFound();

  const c = FUNNEL_COPY;

  return (
    <main className="min-h-screen bg-[var(--color-ink)] pt-16">
      {!isPublic && (
        <p className="bg-[var(--color-forest)] px-5 py-2 text-center text-xs text-[var(--color-ink)]">
          비공개 미리보기 — 관리자에게만 보입니다(FUNNEL_V1_ENABLED OFF · 심의 전)
        </p>
      )}

      <section className="mx-auto max-w-3xl px-5 py-20 md:px-8 md:py-28">
        <p className="mb-4 text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)]">{c.eyebrow}</p>
        <h1 className="whitespace-pre-line font-serif text-3xl font-semibold leading-[1.3] tracking-[-0.015em] text-[var(--color-text-strong)] md:text-[2.5rem]">
          {c.headline}
        </h1>
        <span className="mt-8 block h-px w-8 bg-[var(--color-gold)]" aria-hidden="true" />
        <p className="mt-8 max-w-[44ch] text-[1.0625rem] leading-[1.85] text-[var(--color-text-body)]">{c.lead}</p>

        {/* 리포트 예시 — 가상 데이터. 금액 + 합계 필수(§2 각성 포인트) */}
        <figure className="mt-14">
          <div className="overflow-x-auto rounded-sm border border-[var(--color-line)] bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-text-muted)]">
                  <th className="px-4 py-3 font-medium">담보</th>
                  <th className="px-4 py-3 font-medium">가입 계약별</th>
                  <th className="px-4 py-3 text-right font-medium">합계</th>
                </tr>
              </thead>
              <tbody>
                {c.sampleRows.map((r) => (
                  <tr key={r.coverage} className="border-b border-[var(--color-line)] last:border-0">
                    <td className="px-4 py-3 font-medium text-[var(--color-text-strong)]">{r.coverage}</td>
                    <td className="px-4 py-3 text-[var(--color-text-body)]">{r.parts.join(" + ")}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--color-forest)]">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <figcaption className="mt-2 text-xs text-[var(--color-text-muted)]">{c.sampleCaption}</figcaption>
        </figure>

        <ol className="mt-16 space-y-8">
          {c.steps.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[2.5rem_1fr] gap-2">
              <span className="font-serif text-xl tabular-nums text-[var(--color-gold)]">{i + 1}</span>
              <div>
                <p className="font-semibold text-[var(--color-text-strong)]">{s.title}</p>
                <p className="mt-1 text-[0.9375rem] leading-[1.8] text-[var(--color-text-body)]">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-14 border-l-2 border-[var(--color-gold)] pl-4 text-[0.9375rem] leading-[1.8] text-[var(--color-text-body)]">
          {c.principle}
        </p>

        <div className="mt-16">
          <FunnelForm />
        </div>

        {/* 유의문구 — 축약·변경 금지(§6.10). 필수안내사항(심의필)은 전 페이지 푸터가 상시 노출 */}
        <ul className="mt-12 space-y-1.5 text-xs leading-relaxed text-[var(--color-text-muted)]">
          {funnelNotices().map((n) => (
            <li key={n}>※ {n}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
