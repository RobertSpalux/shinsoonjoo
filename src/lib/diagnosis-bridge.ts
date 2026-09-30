import { BRAND } from "@/lib/brand";

/**
 * 진단 결과 → 카카오톡 상담 다리(A안, 2026-09-30 관제탑 결정).
 * 사용자가 카톡 빈 대화창에서 첫 말을 스스로 써야 하는 마찰을 없앤다 — 결과 요약을 복사해 두고 채팅창을 바로 연다.
 *
 * ⚠️ 이 문구는 심의 대상(사이트 골격 6977 원안 변경 → 별건 심의). 심의 통과 전 배포 금지.
 * ⚠️ 복사 메시지에는 점수·계약 수만 — 소득·보험료·보장 종류·연령대 등 응답은 넣지 않는다(개인정보 최소화).
 */
export const BRIDGE_COPY = {
  headline: "이 점수가 맞는지는 실제 계약을 펼쳐봐야 압니다",
  body: "설문은 기억에 기대고, 계약은 기억보다 많습니다. 방금 결과를 카카오톡으로 보내 주시면, 전 계약을 조회해 담보 단위로 합산한 표로 다시 보여 드립니다.",
  button: "내 결과 카카오톡으로 보내기",
  sub: "점수와 계약 수가 첫 메시지로 복사됩니다. 채팅창에 붙여넣기만 하세요.",
  copied: "복사했습니다. 카카오톡 채팅창에 붙여넣어 보내 주세요.",
  copyFailed: "복사가 되지 않았다면 아래 문장을 그대로 보내 주세요.",
  privacy: "이름·연락처·주민번호는 여기서 받지 않습니다. 계약 조회는 상담에서 동의를 받은 뒤에만 합니다.",
} as const;

/** 카카오톡 채널 채팅창(홈이 아니라 대화창으로 바로 연다). */
export const KAKAO_CHAT_URL = `${BRAND.social.kakao.replace(/\/+$/, "")}/chat`;

/** 복사할 첫 메시지 — 점수와 계약 수만. */
export function buildKakaoMessage(score: number, contracts?: string): string {
  const parts = [`[자산 방어력 진단] ${score}점`];
  if (contracts) parts.push(`계약 수: ${contracts}`);
  return `${parts.join(" · ")}\n이 결과로 제 계약을 담보별로 보고 싶습니다.`;
}
