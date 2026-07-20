import { renderMandatoryNotice, type ReviewInfo } from "@/lib/brand";

/**
 * 광고 필수안내사항 — 기사 본문 최하단 렌더. 문구는 brand.ts 싱글소스를 그대로 쓴다
 * (JSX로 다시 옮겨 적지 않는다 — 축약·오탈자는 반송 사유).
 *
 * 표시 기준(손보규정 §26 ① · 협회 가이드북 Part II):
 * - 바탕색과 구별되는 색상 → 크림 페이지 위 딥그린 밴드로 분리.
 * - [유의사항](승환 경고 2항)은 골드 헤어라인으로 나머지와 시각적 차별화.
 * - 전체 14px(≈10.5pt) — '전체 8pt 이상' + '심의필 10pt 이상'을 동시에 만족(축소 금지).
 * - @media print: 배경색 강제 인쇄(printColorAdjust:exact) + 페이지 분할 금지 → 캡처에서
 *   잘리거나 크림 글자가 흰 배경에 묻히지 않게 한다(캡처는 PDF 인쇄 경로).
 */
export default function MandatoryNotice({
  review,
  mode,
}: {
  review: ReviewInfo | null;
  mode: "submission" | "publish";
}) {
  const notice = renderMandatoryNotice(review ?? undefined, mode);
  if (!notice) return null;

  const cIdx = notice.indexOf("[유의사항]");
  const mainPart = cIdx >= 0 ? notice.slice(0, cIdx).trimEnd() : notice;
  const cautionPart = cIdx >= 0 ? notice.slice(cIdx).trim() : "";

  return (
    <section
      aria-label="필수안내사항"
      className="mt-14 break-inside-avoid rounded-lg bg-[var(--color-forest)] px-6 py-6 text-sm leading-relaxed text-[var(--color-ink)]"
      style={{ WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
    >
      <p className="whitespace-pre-line">{mainPart}</p>
      {cautionPart && (
        <p className="mt-4 whitespace-pre-line border-t border-[var(--color-gold)] pt-4 text-[var(--color-ink)]/85">
          {cautionPart}
        </p>
      )}
    </section>
  );
}
