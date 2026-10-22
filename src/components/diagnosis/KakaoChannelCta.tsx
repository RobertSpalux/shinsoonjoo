import TrackedLink from "@/components/TrackedLink";
import { BRAND } from "@/lib/brand";

/**
 * KC1 — 상담 출구를 카카오톡 채널 하나로. /diagnosis 상단(텍스트 링크)·하단(딥그린 밴드).
 * 이벤트는 기존 퍼널 이벤트(kakao_cta_click)에 position 만 달리 붙인다.
 * 🔴 /diagnosis 는 사이트 골격(6977) 소속 — 이 컴포넌트의 문구는 신규 문구라 골격 재심의 선행 후 배포.
 */
export const KAKAO_CTA_LINE = "내 증권을 보내 보장분석 상담받기";
export const KAKAO_CTA_SUB = "카카오톡 채널 신순주의선한금융";

export default function KakaoChannelCta({
  position,
  variant,
}: {
  position: "diagnosis_top" | "diagnosis_bottom";
  variant: "link" | "band";
}) {
  const link = (
    <TrackedLink
      event="kakao_cta_click"
      position={position}
      href={BRAND.social.kakao}
      target="_blank"
      rel="noopener noreferrer"
      className={
        variant === "band"
          ? "mt-6 inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-7 py-3.5 text-sm font-semibold text-[var(--color-forest)] transition-transform duration-300 hover:-translate-y-px"
          : "mt-5 inline-block text-sm font-semibold text-[var(--color-forest)] underline decoration-[var(--color-gold)] underline-offset-4"
      }
    >
      {KAKAO_CTA_LINE}
    </TrackedLink>
  );

  if (variant === "link") return <div>{link}</div>;

  return (
    <aside className="rounded-[var(--radius-lg)] bg-[var(--color-forest)] p-8 text-center md:p-10">
      <span aria-hidden className="mx-auto mb-4 block h-px w-6 bg-[var(--color-gold)]" />
      <p className="text-sm leading-relaxed text-[var(--color-ink)]/80">{KAKAO_CTA_SUB}</p>
      {link}
    </aside>
  );
}
