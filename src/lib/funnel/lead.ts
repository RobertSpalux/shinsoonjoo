/**
 * 「보험 리모델링 진단」 상담 퍼널 v1 — 신청 검증·상태·알림 문구 싱글소스.
 * 설계: docs/funnel_v1.md · 테이블: sql/007_funnel_leads.sql
 *
 * ⚠️ 웹은 증권·계약 실데이터를 받지 않는다(CLAUDE.md §2 사업 구조 · §6.1).
 *    v1 폼에는 파일 업로드가 없다. 증권 PDF 수령 경로는 docs/funnel_v1.md §4(로버트 결정 대기).
 * ⚠️ 텔레그램 알림에는 이름·연락처를 싣지 않는다 — 대화방 기록은 3개월 파기 정책 밖에 남는다.
 */

/** 공개 스위치. 기본 OFF — PAMS 심의(랜딩) 통과 전에는 켜지 않는다. OFF면 관리자 쿠키로만 열린다. */
export function isFunnelPublic(): boolean {
  return process.env.FUNNEL_V1_ENABLED === "1";
}

/** 알림 실발송 스위치. 기본 드라이런 — 콘솔에만 남긴다. */
export function isFunnelNotifyLive(): boolean {
  return process.env.FUNNEL_NOTIFY_LIVE === "1";
}

export const AGE_BANDS = ["20대 이하", "30대", "40대", "50대", "60대 이상"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const INTERESTS = [
  "암·뇌·심장 진단비",
  "실손·의료비",
  "수술·입원",
  "사망보장",
  "간병·치매",
  "연금·노후",
  "전체 점검",
] as const;
export type Interest = (typeof INTERESTS)[number];

/** 파이프라인 단계. 순서 = 퍼널 순서. 불발은 어느 단계에서든 종결. */
export const LEAD_STATUSES = ["신청", "연락됨", "분석완료", "상담", "계약", "불발"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** 동의문 버전 — 문구가 바뀌면 올린다. DB에 함께 저장해 어떤 문구에 동의했는지 남긴다. */
export const FUNNEL_CONSENT_VERSION = "funnel-v1-draft-20261010";

export const MESSAGE_MAX = 500;
const NAME_MAX = 30;

export interface LeadInput {
  name: string;
  phone: string; // 숫자만
  age_band: AgeBand;
  interests: Interest[];
  message: string | null;
  consent_version: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  landing_path: string | null;
}

export type ValidateResult = { ok: true; lead: LeadInput } | { ok: false; error: string; spam?: boolean };

/** 한국 휴대전화(010·011·016·017·018·019). 하이픈·공백 허용, 저장은 숫자만. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.replace(/[\s-]/g, "");
  return /^01[016789]\d{7,8}$/.test(d) ? d : null;
}

function shortText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** 신청 본문 검증. 실패 문구는 그대로 화면에 띄워도 되는 수준으로 쓴다. */
export function validateLead(body: unknown): ValidateResult {
  if (!body || typeof body !== "object") return { ok: false, error: "잘못된 요청입니다." };
  const b = body as Record<string, unknown>;

  // 허니팟 — 사람에게는 보이지 않는 칸. 채워져 있으면 봇.
  if (typeof b.website === "string" && b.website.trim()) return { ok: false, error: "spam", spam: true };

  // 동의는 정확히 true 만 인정("true" 문자열·1 불가)
  if (b.privacy_collect_agreed !== true) {
    return { ok: false, error: "개인정보 수집·이용에 동의해 주셔야 신청할 수 있습니다." };
  }
  if (b.consent_version !== FUNNEL_CONSENT_VERSION) {
    return { ok: false, error: "동의 문구가 갱신되었습니다. 새로고침 후 다시 신청해 주세요." };
  }

  const strings = [b.name, b.phone, b.message].filter((v): v is string => typeof v === "string");
  if (strings.some((v) => v.includes("�"))) {
    return { ok: false, error: "문자 인코딩이 올바르지 않습니다. UTF-8로 다시 시도해 주세요." };
  }

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > NAME_MAX) return { ok: false, error: "이름을 확인해 주세요." };

  const phone = normalizePhone(b.phone);
  if (!phone) return { ok: false, error: "휴대전화 번호를 확인해 주세요." };

  if (!AGE_BANDS.includes(b.age_band as AgeBand)) return { ok: false, error: "연령대를 선택해 주세요." };

  const rawInterests = Array.isArray(b.interests) ? b.interests : [];
  const interests = INTERESTS.filter((i) => rawInterests.includes(i));
  if (interests.length === 0 || interests.length !== new Set(rawInterests).size) {
    return { ok: false, error: "관심 분야를 1개 이상 선택해 주세요." };
  }

  if (typeof b.message === "string" && b.message.trim().length > MESSAGE_MAX) {
    return { ok: false, error: `남기실 말씀은 ${MESSAGE_MAX}자 이내로 적어 주세요.` };
  }

  return {
    ok: true,
    lead: {
      name,
      phone,
      age_band: b.age_band as AgeBand,
      interests,
      message: shortText(b.message, MESSAGE_MAX),
      consent_version: FUNNEL_CONSENT_VERSION,
      utm_source: shortText(b.utm_source, 60),
      utm_medium: shortText(b.utm_medium, 60),
      utm_campaign: shortText(b.utm_campaign, 100),
      utm_content: shortText(b.utm_content, 100),
      landing_path: shortText(b.landing_path, 200),
    },
  };
}

/**
 * 순주(Soonjoo_PB) 알림 문구. 식별정보(이름·연락처·남긴 말씀) 없음 — 어드민에서 확인한다.
 * 남긴 말씀은 자유입력이라 건강정보 등 민감정보가 섞일 수 있어 제외한다.
 */
export function buildLeadAlert(
  lead: Pick<LeadInput, "age_band" | "interests" | "utm_source" | "utm_campaign">,
  leadId: string,
  siteUrl: string,
  now: Date = new Date()
): string {
  const src = [lead.utm_source, lead.utm_campaign].filter(Boolean).join(" / ") || "직접 유입";
  return [
    "🧭 보험 리모델링 진단 신청",
    "",
    `연령대: ${lead.age_band}`,
    `관심 분야: ${lead.interests.join(", ")}`,
    `유입: ${src}`,
    `접수번호: ${leadId.slice(0, 8)}`,
    "",
    `연락처 확인 → ${siteUrl}/admin/funnel`,
    `🕐 ${now.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
  ].join("\n");
}

/** 어드민 목록 마스킹 — 목록에서는 가리고, 행을 펼칠 때만 전체 표시. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 10) return "***";
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

export function maskName(name: string): string {
  const chars = Array.from(name);
  if (chars.length <= 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

export function isLeadStatus(v: unknown): v is LeadStatus {
  return LEAD_STATUSES.includes(v as LeadStatus);
}
