// 퍼널 v1 시험 — npx tsx src/lib/funnel/funnel.test.mts
import {
  validateLead,
  buildLeadAlert,
  normalizePhone,
  maskName,
  maskPhone,
  FUNNEL_CONSENT_VERSION,
  LEAD_STATUSES,
} from "./lead";
import { notifyFunnelLead } from "./notify";
import { FUNNEL_COPY, funnelNotices } from "./copy";
import { FUNNEL_CONSENT } from "./consent";
import { REQUIRED_NOTICES, CONDITIONAL_NOTICES } from "../brand";
import { checkBannedTerms } from "../compliance/banned-terms";

let fail = 0;
function ok(name: string, cond: boolean) {
  if (!cond) { fail++; console.error("FAIL", name); } else console.log("ok  ", name);
}

const base = {
  name: "홍길동",
  phone: "010-1234-5678",
  age_band: "40대",
  interests: ["암·뇌·심장 진단비", "실손·의료비"],
  message: "평일 저녁 연락 부탁드립니다",
  privacy_collect_agreed: true,
  consent_version: FUNNEL_CONSENT_VERSION,
  utm_source: "meta",
  utm_campaign: "test-a",
};

// ── 폼 검증
const good = validateLead(base);
ok("정상 신청 통과", good.ok && good.lead.phone === "01012345678" && good.lead.interests.length === 2);
ok("동의 없음 거부", !validateLead({ ...base, privacy_collect_agreed: false }).ok);
ok("동의 누락 거부", !validateLead({ ...base, privacy_collect_agreed: undefined }).ok);
ok("동의 문자열 \"true\" 거부", !validateLead({ ...base, privacy_collect_agreed: "true" }).ok);
ok("옛 동의문 버전 거부", !validateLead({ ...base, consent_version: "old" }).ok);
ok("이름 빈칸 거부", !validateLead({ ...base, name: "   " }).ok);
ok("유선번호 거부", !validateLead({ ...base, phone: "041-572-0372" }).ok);
ok("번호 자릿수 거부", !validateLead({ ...base, phone: "010-123" }).ok);
ok("연령대 임의값 거부", !validateLead({ ...base, age_band: "45세" }).ok);
ok("관심 분야 0개 거부", !validateLead({ ...base, interests: [] }).ok);
ok("관심 분야 임의값 거부", !validateLead({ ...base, interests: ["암·뇌·심장 진단비", "<script>"] }).ok);
ok("말씀 500자 초과 거부", !validateLead({ ...base, message: "가".repeat(501) }).ok);
ok("깨진 인코딩 거부", !validateLead({ ...base, name: "홍�동" }).ok);
const spam = validateLead({ ...base, website: "http://x" });
ok("허니팟 = spam", !spam.ok && spam.spam === true);
ok("본문 없음 거부", !validateLead(null).ok);
ok("증권·주민번호 필드는 저장 대상에 없음", good.ok && !("rrn" in good.lead) && !("file" in good.lead) && !("policy_pdf" in good.lead));
ok("임의 필드는 버린다", (() => { const r = validateLead({ ...base, rrn: "900101-1234567" }); return r.ok && !JSON.stringify(r.lead).includes("900101"); })());
ok("normalizePhone 하이픈 없는 11자리", normalizePhone("01098220379") === "01098220379");

// ── 알림: 식별정보 미포함
if (good.ok) {
  const msg = buildLeadAlert(good.lead, "abcdef12-3456-7890", "https://goodfinance.kr", new Date("2026-10-10T03:00:00Z"));
  ok("알림에 이름 없음", !msg.includes("홍길동"));
  ok("알림에 번호 없음", !msg.includes("01012345678") && !msg.includes("1234-5678") && !msg.includes("5678"));
  ok("알림에 남긴 말씀 없음", !msg.includes("평일 저녁"));
  ok("알림에 어드민 링크", msg.includes("https://goodfinance.kr/admin/funnel"));
  ok("알림에 유입 출처", msg.includes("meta / test-a"));
}

// ── 알림 드라이런: 기본값이면 fetch 를 부르지 않는다
{
  delete process.env.FUNNEL_NOTIFY_LIVE;
  let called = 0;
  const fake = (async () => { called++; return new Response("{}"); }) as typeof fetch;
  const r = await notifyFunnelLead("test", fake);
  ok("드라이런 기본값 — 발송 안 함", r.dryRun && !r.sent && called === 0);

  process.env.FUNNEL_NOTIFY_LIVE = "1";
  process.env.TELEGRAM_BOT_TOKEN = "t";
  process.env.TELEGRAM_CHAT_ID = "c";
  let body = "";
  const fake2 = (async (_u: unknown, init?: RequestInit) => { called++; body = String(init?.body); return new Response("{}"); }) as typeof fetch;
  const r2 = await notifyFunnelLead("hello", fake2);
  ok("실발송 스위치 ON — 발송", r2.sent && called === 1 && body.includes("\"chat_id\":\"c\""));
  delete process.env.FUNNEL_NOTIFY_LIVE;
}

// ── 어드민 마스킹
ok("이름 마스킹 3자", maskName("홍길동") === "홍*동");
ok("이름 마스킹 2자", maskName("김순") === "김*");
ok("번호 마스킹", maskPhone("01012345678") === "010-****-5678");
ok("상태 6단계", LEAD_STATUSES.join(",") === "신청,연락됨,분석완료,상담,계약,불발");

// ── 랜딩 문구 금지어(§6.10) — 생성 게이트와 같은 검사기
const landingText = [
  FUNNEL_COPY.headline,
  FUNNEL_COPY.lead,
  ...FUNNEL_COPY.steps.flatMap((s) => [s.title, s.body]),
  FUNNEL_COPY.principle,
  FUNNEL_COPY.formNote,
  FUNNEL_COPY.submit,
  FUNNEL_COPY.success,
  FUNNEL_COPY.sampleCaption,
].join("\n");
const banned = checkBannedTerms({ title: FUNNEL_COPY.metaTitle, summary: FUNNEL_COPY.metaDescription, main_website_markdown: landingText });
const blocking = banned.findings.filter((f) => f.grade === "A");
ok(`랜딩 A등급 금지어 0건 (${blocking.map((f) => f.term).join(",")})`, blocking.length === 0);
if (banned.findings.length) console.log("  B등급 참고:", banned.findings.map((f) => `${f.grade}:${f.term}`).join(", "));
ok("「무료」 미사용", !/무료/.test(landingText + FUNNEL_COPY.metaDescription));
ok("헤드라인에 금액 없음", !/\d/.test(FUNNEL_COPY.headline));
{
  // 렌더 결과엔 getCareer() 값이 들어가므로 원본 소스에서 리터럴 연차를 찾는다
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./copy.ts", import.meta.url), "utf8");
  ok("경력 연차 하드코딩 없음(getCareer 사용)", !/\d+\s*년\s*(현장|차|간)/.test(src) && src.includes("getCareer()"));
}
ok("예시 표에 가상 예시 고지", FUNNEL_COPY.sampleCaption.includes("가상 예시"));
ok("예시 표 합계 존재", FUNNEL_COPY.sampleRows.every((r) => /만원$/.test(r.total)));
ok("회사 표기 A·B·C", !/[가-힣]+(생명|화재|손해보험)/.test(landingText));

// ── 유의문구
const notices = funnelNotices();
ok("필수 유의문구 2종", REQUIRED_NOTICES.every((n) => notices.includes(n)));
ok("금액 예시 → premiumVariation", notices.includes(CONDITIONAL_NOTICES.premiumVariation));
ok("실손 언급 → 실손 문장", notices.some((n) => n.startsWith("실손보험은")));

// ── 동의문
ok("동의문: 제3자 제공 없음 명시", FUNNEL_CONSENT.body.includes("제3자에게 제공하지 않습니다"));
ok("동의문: 보유기간 3개월", FUNNEL_CONSENT.body.includes("수집일로부터 3개월"));
ok("동의문: 거부권 고지", FUNNEL_CONSENT.body.includes("거부하실 권리"));
ok("동의문: 연령대·관심 분야 항목", FUNNEL_CONSENT.body.includes("연령대, 관심 분야"));

process.exit(fail ? 1 : 0);
