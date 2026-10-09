import { checkBannedTerms } from "./banned-terms";

/**
 * 스레드 댓글 답글 전용 게이트 (docs/THREADS-REPLY-RULES.md §3).
 *
 * 답글은 PAMS 「댓글심의」 대상이고, 댓글심의는 규정상 사용 불가 표현이 있으면 **자동 거절 + 작성 내용 삭제**다
 * (CLAUDE.md §6.4·§6.10 「댓글심의 전용 금지표현」). 그래서 기사용 금지어 대장만으로는 부족한 것을 여기서 더 잡는다.
 *
 * 🔴 판정은 보수적이다 — 하나라도 걸리면 통과가 아니다(pass=false). 기사처럼 B등급 「확인」 절차가 없다:
 *    답글은 짧아서 고쳐 쓰는 비용이 작고, 걸린 채 접수하면 원고가 초기화된다.
 *    기사용 checkBannedTerms 의 B등급(통계·보험사명 등)도 답글에서는 막는다.
 */

export type ReplyRule =
  | "banned" // 기사용 금지어 대장(A·B)
  | "premium" // 대략 보험료·금액
  | "contact" // 전화번호·카톡ID·URL·개인 연락 약속
  | "slander" // 타사·설계사·채널 비방
  | "assertive" // 단정·지급 확약·해지 권유
  | "recommend" // 추천·최상급·회사(이니셜)
  | "echo"; // 댓글 원문의 병명·연락처 되받기

export interface ReplyFinding {
  rule: ReplyRule;
  term: string;
  reason: string;
}

export interface ReplyCheckResult {
  pass: boolean;
  findings: ReplyFinding[];
}

/** PAMS 등록 명의(§6.4 사전등록) — 이 주소만 허용한다. */
const ALLOWED_URL = [/pf\.kakao\.com\/_xoxdBwX/i, /goodfinance\.kr/i, /threads\.(?:net|com)\/@goodfinance_sj/i];

type Pattern = { term: string; re: RegExp };

const PREMIUM: Pattern[] = [
  { term: "N만원(대)", re: /\d[\d,.]*\s*만\s*원?\s*(?:대|선|정도|쯤|초반|중반|후반|이하|이상|안팎)?/g },
  { term: "N원(대)", re: /\d[\d,]{2,}\s*원\s*(?:대|선|정도|쯤)?/g },
  { term: "월 N", re: /(?:월|한\s*달(?:에)?)\s*\d[\d,.]*\s*(?:만|천)/g },
  { term: "N천원", re: /\d+\s*천\s*원/g },
  { term: "화폐기호", re: /[₩$]/g },
];

const CONTACT: Pattern[] = [
  { term: "전화번호", re: /0\d{1,2}[-\s.]?[\dxX*]{3,4}[-\s.]?[\dxX*]{4}/g },
  { term: "카톡ID·오픈채팅", re: /(?:카톡|카카오톡|카카오)\s*(?:아이디|ID|id)|open\.kakao\.com|오픈\s*채팅/g },
  { term: "개인 연락 약속", re: /(?:전화|문자|연락|카톡)\s*(?:드릴|해\s*드릴|할게|하겠|줄게|주세요|주시면|남겨)/g },
  { term: "DM 유도", re: /(?:DM|디엠|쪽지)\s*(?:주|보내|남겨|드릴)/gi },
];

const SLANDER: Pattern[] = [
  { term: "다른 설계사", re: /(?:다른|타|일부|많은)\s*설계사/g },
  { term: "설계사들은", re: /설계사들?\s*(?:은|는)\s*(?:다|모두|대부분)?/g },
  { term: "실적 때문에", re: /실적\s*(?:때문|위해|채우)/g },
  { term: "비추", re: /비추/g },
  { term: "보장이 약", re: /(?:보장|혜택)(?:이|은|는)?\s*(?:약하|약해|형편없|별로)/g },
  { term: "보험사 비방", re: /보험사(?:는|가|들은)?\s*(?:안\s*주|안\s*알려|싫어|배불|장난)/g },
];

const ASSERTIVE: Pattern[] = [
  { term: "충분합니다", re: /충분(?:합니다|해요|하세요|하다|해|할\s*거)/g },
  { term: "걱정 마세요", re: /걱정\s*(?:마세요|하지\s*마|없어요|없습니다)/g },
  { term: "무조건", re: /무조건/g },
  { term: "확실", re: /확실(?:히|합니다|해요)/g },
  { term: "반드시·꼭 나온다", re: /(?:반드시|꼭|틀림없이|당연히)\s*(?:나옵|나와|받으|받을\s*수\s*있|지급)/g },
  { term: "꼭 청구", re: /(?:꼭|반드시|무조건)\s*청구/g },
  { term: "N% 나온다", re: /\d+\s*%\s*(?:나옵|나와|보장|지급)/g },
  { term: "해지 권유", re: /해지\s*(?:하고|하세요|하시고|하시는\s*게\s*낫|하는\s*게\s*낫)/g },
  { term: "새로 드세요", re: /새로\s*(?:드세요|가입하세요|드시)/g },
];

const RECOMMEND: Pattern[] = [
  { term: "추천", re: /추천\s*(?:해요|합니다|드려요|드립니다|해\s*드|드릴)/g },
  { term: "제일·가장 좋", re: /(?:제일|가장|젤)\s*(?:좋|낫|싸|저렴|괜찮)/g },
  { term: "최고·1위", re: /최고|1\s*위|넘버\s*원|No\.?\s*1/gi },
  { term: "회사 이니셜·자리표시", re: /(?<![가-힣A-Za-z])(?:[A-Z]{1,3}|[○◯OX]{1,3})\s*사(?![가-힣])/g },
  { term: "~보다 낫", re: /보다\s*(?:낫|좋|싸|유리)/g },
];

/** 병명 사전(자주 나오는 것) + 접미 패턴. 댓글에서 뽑아 답글에 다시 나오면 되받기다. */
const DISEASES = [
  "암", "위암", "간암", "폐암", "대장암", "유방암", "갑상선암", "백혈병", "치매", "파킨슨", "뇌졸중", "뇌경색",
  "뇌출혈", "심근경색", "협심증", "부정맥", "당뇨", "고혈압", "고지혈증", "봉와직염", "폐렴", "골절", "디스크",
  "우울증", "공황장애", "치주염", "관절염", "통풍", "신부전", "간경화", "결핵", "대상포진", "녹내장", "백내장",
];
/**
 * 약 상품명(브랜드) — 질문에 자주 나오는 것. 상품명이라 답변에 나오면 ①(상품 유추), 질문에서 되받으면 ⑤(질병 추정 민감정보)도 걸린다.
 * 성분명이나 「비만 치료 주사」처럼 일반명으로 쓴다(2026-10-09 SH5 견본 「제2형당뇨병 마운자로 실비청구」).
 */
const DRUG_BRANDS = [
  "마운자로", "젭바운드", "위고비", "오젬픽", "삭센다", "큐시미아", "트루리시티", "자디앙", "포시가",
  "프롤리아", "이베니티", "휴미라", "키트루다", "옵디보", "타그리소", "엔허투", "레켐비", "보톡스", "리피토", "크레스토",
];
// 뒤에 한글이 붙어도 「수술·진단·치료…」면 병명이다(SH6 「여유증수술」 — 질문 제목·답변 모두에서 못 잡았다).
const DISEASE_SUFFIX =/[가-힣]{1,6}(?:암|병|염|증|증후군|장애|경색|출혈)(?=수술|진단|치료|검사|판정|환자|소견|약|[^가-힣]|$)/g;
/** 접미 패턴에 걸리지만 병명이 아닌 말(보험 일반어 등). kin_harvest.py 가 같은 목록을 읽는다(단일 출처). */
const NOT_DISEASE = [
  "질병", "간병", "유병", "발병", "투병", "지병", "중증", "경증", "검증", "인증", "보증", "영수증", "확인증",
  "신분증", "자격증", "가입증", "후유장애", "궁금증",
];
/** 답글 단독으로도 병명을 조건으로 판단하면(○○병이면) 막는다. */
const DISEASE_CONDITION = /(?:[가-힣○◯]{1,6})(?:암|병|염|증)\s*이?면\s/g;

function hits(text: string, list: Pattern[], rule: ReplyRule, reason: string): ReplyFinding[] {
  const out: ReplyFinding[] = [];
  for (const p of list) {
    const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g");
    for (const m of text.matchAll(re)) out.push({ rule, term: `${p.term}: ${m[0].trim()}`, reason });
  }
  return out;
}

function diseasesIn(text: string): string[] {
  const found = new Set<string>();
  for (const d of DISEASES) if (text.includes(d)) found.add(d);
  for (const m of text.matchAll(DISEASE_SUFFIX))
    if (!NOT_DISEASE.some((x) => m[0].endsWith(x))) found.add(m[0]);
  return [...found];
}

/**
 * @param reply 게시할 답글 원고
 * @param comment 답글을 다는 댓글 원문(있으면 되받기 검사)
 */
export function checkReplyTerms(reply: string, comment = ""): ReplyCheckResult {
  const text = reply ?? "";
  const findings: ReplyFinding[] = [];

  for (const f of checkBannedTerms({ main_website_markdown: text }).findings) {
    findings.push({ rule: "banned", term: `${f.grade}: ${f.term}`, reason: f.reason });
  }
  findings.push(...hits(text, PREMIUM, "premium", "§6.10 댓글심의 ③ 산출기준 없는 대략 보험료·금액 — 금액은 쓰지 않는다"));

  const urls = text.match(/https?:\/\/\S+|www\.\S+|[0-9A-Za-z_-]+\.(?:kr|com|net|co\.kr)\S*/g) ?? [];
  for (const u of urls) {
    if (!ALLOWED_URL.some((re) => re.test(u)))
      findings.push({ rule: "contact", term: `URL: ${u}`, reason: "PAMS 등록 명의 외 링크 — 카톡 채널·goodfinance.kr 만" });
  }
  findings.push(...hits(text, CONTACT, "contact", "개인 연락처·개인 연락 — 카톡 채널(프로필 링크)로 일원화, §6.7"));
  findings.push(...hits(text, SLANDER, "slander", "§6.10 댓글심의 ④ 업계 비방·비교"));
  findings.push(...hits(text, ASSERTIVE, "assertive", "§6.10 댓글심의 ② 단정·지급 확약·해지 권유(승환 리스크)"));
  findings.push(...hits(text, RECOMMEND, "recommend", "§6.10 댓글심의 ① 회사·상품 유추 / 추천·최상급"));
  for (const d of DRUG_BRANDS)
    if (text.includes(d)) findings.push({ rule: "recommend", term: `약 상품명: ${d}`, reason: "§6.10 댓글심의 ① 상품명 노출 — 성분·일반명으로" });

  // 되받기 — 댓글의 병명·연락처가 답글에 다시 나오면 민감정보 확산(§6.10 댓글심의 ⑤)
  if (comment) {
    for (const d of diseasesIn(comment)) {
      if (text.includes(d)) findings.push({ rule: "echo", term: `병명 되받기: ${d}`, reason: "§6.10 댓글심의 ⑤ 질문자 민감정보 기재" });
    }
    for (const d of DRUG_BRANDS) {
      if (comment.includes(d) && text.includes(d))
        findings.push({ rule: "echo", term: `약 되받기: ${d}`, reason: "§6.10 댓글심의 ⑤ 질문자 민감정보 기재(처방약 = 질병 추정)" });
    }
    const phone = comment.match(/0\d{1,2}[-\s.]?[\dxX*]{3,4}[-\s.]?[\dxX*]{4}/);
    if (phone && /(?:전화|문자|연락)\s*(?:드릴|해\s*드릴|할게|하겠|줄게)/.test(text))
      findings.push({ rule: "echo", term: "연락처 되받기(댓글에 번호 + 답글에 연락 약속)", reason: "§6.10 댓글심의 ⑤ 질문자 개인정보" });
  }
  for (const m of text.matchAll(DISEASE_CONDITION))
    findings.push({ rule: "echo", term: `병명 조건 판단: ${m[0].trim()}`, reason: "병명을 조건으로 보장·청구를 판단 — 개별 판단은 상담에서" });

  // 같은 규칙·같은 말 중복 제거
  const seen = new Set<string>();
  const uniq = findings.filter((f) => {
    const k = f.rule + "|" + f.term;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { pass: uniq.length === 0, findings: uniq };
}
