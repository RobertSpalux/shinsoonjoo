import { renderMandatoryNotice, type ReviewInfo } from "@/lib/brand";

/**
 * 광고 필수안내사항 — 기사 본문 최하단 렌더. 문구는 brand.ts 싱글소스를 그대로 쓴다
 * (JSX로 다시 옮겨 적지 않는다 — 축약·오탈자는 반송 사유).
 *
 * 표시 기준(손보규정 §26 ① · 협회 가이드북 Part II):
 * - 화면: 바탕색과 구별되는 색상 → 크림 페이지 위 딥그린 밴드. [유의사항]은 골드 헤어라인.
 * - 전체 14px(≈10.5pt) — '전체 8pt 이상' + '심의필 10pt 이상'을 동시에 만족(축소 금지).
 * - @media print: **색 반전**(투명 배경 + 딥그린 글씨 + 딥그린 실선 테두리)으로 전환한다.
 *   Chrome 인쇄의 '배경 그래픽' 체크(기본 꺼짐)에 기대지 않는다 — 체크 없이 PDF로 뽑아도
 *   흰 종이에 딥그린 글씨로 또렷이 읽혀야 한다(캡처→PDF가 심의 제출 경로, §6.9 5-3).
 *   [유의사항]은 색이 아니라 좌측 실선 보더 + 볼드로 차별화(배경 인쇄 비의존).
 *   폰트는 pt로 못 박아 인쇄 축소를 막고, break-inside:avoid로 페이지 분할을 막는다.
 */
// 인쇄용 색 반전 — 배경 인쇄 설정에 의존하지 않는다. 딥그린 #1b3a30(=--color-forest).
// 폰트는 pt로 고정(심의필 10pt·전체 8pt 하한을 인쇄 축소로부터 보호). break-inside 유지.
const PRINT_CSS = `
@media print {
  .mandatory-notice {
    background: transparent !important;
    color: #1b3a30 !important;
    border: 1px solid #1b3a30 !important;
    border-radius: 6px !important;
    font-size: 10.5pt !important;
    line-height: 1.6 !important;
    break-inside: avoid;
  }
  .mandatory-notice p { color: #1b3a30 !important; }
  .mandatory-notice__caution {
    border-top: 0 !important;
    border-left: 2px solid #1b3a30 !important;
    padding-left: 0.75rem !important;
    font-weight: 700 !important;
    color: #1b3a30 !important;
  }
}`;

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
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <section
        aria-label="필수안내사항"
        className="mandatory-notice mt-14 break-inside-avoid rounded-lg bg-[var(--color-forest)] px-6 py-6 text-sm leading-relaxed text-[var(--color-ink)]"
      >
        <p className="whitespace-pre-line">{mainPart}</p>
        {cautionPart && (
          <p className="mandatory-notice__caution mt-4 whitespace-pre-line border-t border-[var(--color-gold)] pt-4 text-[var(--color-ink)]/85">
            {cautionPart}
          </p>
        )}
      </section>
    </>
  );
}
