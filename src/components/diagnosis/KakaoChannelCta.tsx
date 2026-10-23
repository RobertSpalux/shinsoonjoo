import TrackedLink from "@/components/TrackedLink";
import { BRAND } from "@/lib/brand";

/**
 * KC1 — 상담 출구를 카카오톡 채널 하나로. /diagnosis 상단(첫 화면)·하단 버튼.
 * 카카오 브랜드 가이드 색(#FEE500 배경 · #191919 글자 · 말풍선 아이콘). 이벤트는 기존 퍼널 이벤트(kakao_cta_click)에 position 만 달리 붙인다.
 * 설명 문단 없이 버튼 한 줄만 둔다(로버트 결정 10/23 — 푸터에 이미 카톡 아이콘이 있어 재심의 불요).
 */
export const KAKAO_CTA_LABEL = "카카오톡으로 상담하기";

export default function KakaoChannelCta({
  position,
}: {
  position: "diagnosis_top" | "diagnosis_bottom";
}) {
  return (
    <TrackedLink
      event="kakao_cta_click"
      position={position}
      href={BRAND.social.kakaoChat}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2.5 rounded-[var(--radius-sm)] bg-[#FEE500] px-7 py-3.5 text-sm font-semibold text-[#191919] transition-transform duration-300 hover:-translate-y-px"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="#191919">
        <path d="M12 3C6.48 3 2 6.58 2 11c0 2.84 1.87 5.33 4.69 6.74l-.95 3.5a.4.4 0 0 0 .61.43l4.1-2.72c.51.06 1.02.09 1.55.09 5.52 0 10-3.58 10-8S17.52 3 12 3Z" />
      </svg>
      {KAKAO_CTA_LABEL}
    </TrackedLink>
  );
}
