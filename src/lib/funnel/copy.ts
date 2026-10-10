/**
 * /remodeling-check 랜딩 문구 싱글소스 — ⚠️ PAMS 심의 전 초안.
 * 이 파일의 문구가 곧 심의 원안이다. 승인 뒤에는 한 글자도 바꾸지 않는다(§6.11-9).
 * 금지어 검사: npx tsx src/lib/funnel/funnel.test.mts (checkBannedTerms 를 그대로 돌린다).
 *
 * 원칙: 헤드라인 = 방법(담보 합산), 그 아래 = 가치(§2 카피 구조).
 * 「무료」 미사용(§6.10). 결론은 유지·재설계·해지·신규 어느 쪽으로도 기울지 않는다(§2 리모델링 정의).
 */
import { getCareer, requiredNoticesFor, CONDITIONAL_NOTICES } from "@/lib/brand";

const { years } = getCareer();

export const FUNNEL_COPY = {
  metaTitle: "보험 리모델링 진단 신청",
  metaDescription:
    "가입한 보험을 담보 단위로 펼쳐 합계로 보여드리는 보장분석 리포트. 신청은 이름·연락처·관심 분야만 받습니다.",
  eyebrow: "보험 리모델링 진단",
  headline: "보험이 몇 개인지는 알아도,\n암 진단비가 합쳐서 얼마인지는 잘 모릅니다.",
  lead: `여러 계약에 흩어진 보장을 담보 단위로 펼쳐 한 줄로 합산합니다. ${years}년 현장에서 반복해서 본 패턴을 감이 아니라 데이터로 읽기 위해, 신순주가 직접 개발한 분석 프로그램으로 보장분석 리포트를 만들어 드립니다.`,
  steps: [
    {
      title: "신청",
      body: "이름·연락처·연령대·관심 분야만 받습니다. 증권이나 주민등록번호는 이 페이지에서 받지 않습니다.",
    },
    {
      title: "연락",
      body: "신순주가 직접 연락드려 상담 일정을 정합니다. 전국 어디서나 비대면 상담이 가능합니다.",
    },
    {
      title: "동의 후 조회",
      body: "상담에서 동의를 받은 뒤, 설계사 권한으로 각 보험사가 제공하는 프로그램에서 가입 중인 계약의 보장내역을 조회합니다.",
    },
    {
      title: "보장분석 리포트",
      body: "담보별 합계와 함께, 유지·재설계·해지·신규를 담보마다 판단한 결과를 설명드립니다. 제안 뒤에도 남는 공백이 있으면 그것도 함께 보여드립니다.",
    },
  ],
  sampleCaption: "리포트 예시 — 이해를 돕기 위한 가상 예시이며 실제 고객 정보가 아닙니다.",
  sampleRows: [
    { coverage: "암 진단비", parts: ["A사 2,000만원", "B사 1,000만원", "C사 500만원"], total: "3,500만원" },
    { coverage: "뇌혈관질환 진단비", parts: ["A사 1,000만원"], total: "1,000만원" },
    { coverage: "질병 사망", parts: ["B사 5,000만원", "C사 3,000만원"], total: "8,000만원" },
  ],
  principle:
    "진단은 기존 계약의 해지를 전제로 하지 않습니다. 결론은 담보마다 다르며, 유지가 맞는 계약은 유지를 권합니다.",
  formTitle: "진단 신청",
  formNote: "신청하신 내용은 신순주 본인만 확인합니다. 영업일 기준 1~2일 안에 연락드립니다.",
  submit: "보험 리모델링 진단 신청",
  success: "신청이 접수되었습니다. 신순주가 직접 연락드리겠습니다.",
} as const;

/** 랜딩에 나가는 유의문구. 예시 금액이 있으므로 premiumVariation 포함, 실손 언급이 있으므로 실손 문장 포함. */
export function funnelNotices(): string[] {
  const all = [
    FUNNEL_COPY.headline,
    FUNNEL_COPY.lead,
    ...FUNNEL_COPY.steps.map((s) => s.body),
    "실손·의료비", // 관심 분야 선택지에 실손이 있다
  ].join("\n");
  return [...requiredNoticesFor(all), CONDITIONAL_NOTICES.premiumVariation];
}
