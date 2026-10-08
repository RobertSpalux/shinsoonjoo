import { checkReplyTerms, type ReplyFinding } from "./reply-terms";
import { CONDITIONAL_NOTICES, requiredNoticesFor } from "../brand";
import { scanPlainStyle } from "../style-gate";

/**
 * 지식iN 답변 게이트 (PAMS 「지식인 심의(네이버)」 — 폼 직접입력, 사용 불가 표현이면 자동 거절 + 작성 내용 삭제).
 *
 * 신청 버튼 팝업의 금지표현 5항(①회사·상품 유추 ②과장·자극·단정 ③산출기준 없는·대략 보험료 ④비방·비교
 * ⑤질문자 개인정보·민감정보)은 댓글심의와 같다 → reply-terms 를 그대로 부르고, 지식iN 답변에만 있는 규칙을 더한다:
 *  · 링크 없음 — reply-terms 는 카톡 채널·goodfinance.kr 을 허용하지만 지식iN 답변은 **어떤 URL 도** 쓰지 않는다.
 *  · 본문 600~900자(공백 포함, 유의문구 블록 제외).
 *  · 되묻기 금지 — 질문자 상황을 다시 묻지 않는다(「알려 주시면」「말씀해 주시면」).
 *  · 일화 날조 금지(CLAUDE.md §2) — 「제 고객」「어제 상담한 분」.
 *  · 개인 의견 귀속 — 본문에 「제 의견」 류 1회. 개인의견·약관참조 정본 문구는 PAMS 자동생성분이 붙는다.
 *  · 실손 주제면 ACTUAL_LOSS_NOTICE, 간편심사·유병자 소재면 simplifiedIssue 를 정본 그대로(kinNoticeBlock).
 *  · 경어체(style-gate) — 평서체 이탈 금지.
 * 하나라도 걸리면 pass=false. 고쳐 쓰지 않는다 — 버리고 다시 만든다.
 */

export const KIN_BODY_MIN = 600;
export const KIN_BODY_MAX = 900;
/** 본문과 유의문구 블록의 경계 — 이 줄 아래는 정본 자구만 온다. */
export const KIN_NOTICE_MARK = "※ 유의사항";

export type KinRule = ReplyFinding["rule"] | "link" | "length" | "askback" | "anecdote" | "opinion" | "notice" | "style";

export interface KinFinding {
  rule: KinRule;
  term: string;
  reason: string;
}

export interface KinCheckResult {
  pass: boolean;
  bodyLength: number;
  findings: KinFinding[];
}

const SIMPLIFIED_RE = /유병자|간편\s*심사|간편보험|간편\s*가입|유병력/;
const ASKBACK_RE =
  /(?:알려|말씀해|적어|남겨|보내)\s*(?:주시면|주세요|주시겠)|(?:어떤|무슨)\s*(?:상품|보험)(?:인지|이신지)\s*(?:알아야|확인해야)|정확한\s*(?:내용|상황)을\s*알아야/g;
const ANECDOTE_RE =
  /(?:제|저의|우리)\s*고객(?:님|분)?|(?:어제|지난주|지난달|얼마\s*전)\s*(?:상담|만난|오신)|상담(?:했던|한)\s*(?:분|고객)|실제로\s*(?:한\s*)?고객/g;
const OPINION_RE = /(?:제|저의|개인적인)\s*(?:의견|생각|견해)|개인\s*의견/;
const ANY_URL_RE = /https?:\/\/\S+|www\.\S+|[0-9A-Za-z_-]+\.(?:kr|com|net|co\.kr|me|ly)(?:\/\S*)?/g;

/**
 * 유의문구 블록 — 답변 소재에 맞는 정본 자구(축약·변형 금지). 붙일 것이 없으면 빈 문자열.
 *
 * 🔴 개인의견·약관참조·보험료 상이 문구와 필수안내사항(심의필 자리)은 **PAMS 가 카테고리를 고르면 자동생성**한다
 *    (댓글광고심의 신청매뉴얼 20241024 p5 ⑥). 그래서 REQUIRED_NOTICES 2종은 여기 넣지 않는다 — 넣으면 같은 뜻이
 *    다른 자구로 두 번 나간다. PAMS 자동생성에 없는 소재 문구만 붙인다:
 *    · 실손 주제 → ACTUAL_LOSS_NOTICE(2026-09-23 PAMS 반송 요구 자구, requiredNoticesFor 의 세 번째 줄)
 *    · 유병자·간편 → CONDITIONAL_NOTICES.simplifiedIssue(2호 네이버 반송 사유) — 「유병자보험」 카테고리
 *      자동생성에 같은 문구가 들어가는지 미실측이라 붙인다(유의문구 과다는 반송 사유 아님, §6.11-4).
 */
export function kinNoticeBlock(answerBody: string, question = ""): string {
  const lines = requiredNoticesFor(answerBody, question).slice(2);
  if (SIMPLIFIED_RE.test(answerBody + question)) lines.push(CONDITIONAL_NOTICES.simplifiedIssue);
  return lines.length ? [KIN_NOTICE_MARK, ...lines.map((l) => `- ${l}`)].join("\n") : "";
}

/** 본문(유의문구 블록 앞)만 떼어낸다. */
export function kinBody(answer: string): string {
  const i = answer.indexOf(KIN_NOTICE_MARK);
  return (i === -1 ? answer : answer.slice(0, i)).trim();
}

/**
 * @param answer PAMS 에 넣을 답변 전문(본문 + 유의문구 블록)
 * @param question 질문 원문(되받기·소재 판정용 — PAMS 에 넣지 않는다)
 */
export function checkKinAnswer(answer: string, question = ""): KinCheckResult {
  const text = answer ?? "";
  const body = kinBody(text);
  const findings: KinFinding[] = [];

  for (const f of checkReplyTerms(text, question).findings) {
    // reply-terms 의 허용 URL 판정은 아래 「link」 규칙이 더 엄격하게 대신한다
    if (f.rule === "contact" && f.term.startsWith("URL:")) continue;
    findings.push(f);
  }
  for (const m of text.matchAll(ANY_URL_RE))
    findings.push({ rule: "link", term: `URL: ${m[0]}`, reason: "지식iN 답변은 링크 없음(카톡·사이트 포함)" });
  if (body.length < KIN_BODY_MIN || body.length > KIN_BODY_MAX)
    findings.push({
      rule: "length",
      term: `본문 ${body.length}자`,
      reason: `본문은 ${KIN_BODY_MIN}~${KIN_BODY_MAX}자(공백 포함, 유의문구 블록 제외)`,
    });
  for (const m of body.matchAll(ASKBACK_RE))
    findings.push({ rule: "askback", term: m[0], reason: "질문자 상황을 되묻지 않는다 — 판단에 걸린 것을 알려 준다" });
  for (const m of body.matchAll(ANECDOTE_RE))
    findings.push({ rule: "anecdote", term: m[0], reason: "일화 날조 금지(CLAUDE.md §2) — 반복 관찰 패턴으로만" });
  if (!OPINION_RE.test(body))
    findings.push({ rule: "opinion", term: "개인 의견 귀속 없음", reason: "본문에 「제 의견」 류 귀속 1회 필요" });

  const want = kinNoticeBlock(body, question);
  if (want ? !text.includes(want) : text.includes(KIN_NOTICE_MARK))
    findings.push({ rule: "notice", term: "유의문구 블록 불일치", reason: "kinNoticeBlock() 정본 그대로 붙여야 한다(축약·변형 금지)" });

  for (const v of scanPlainStyle({ main_website_markdown: body }))
    findings.push({ rule: "style", term: `평서체 ${v.plainCount}/${v.total}: ${v.samples[0] ?? ""}`, reason: "경어체 이탈" });

  const seen = new Set<string>();
  const uniq = findings.filter((f) => {
    const k = f.rule + "|" + f.term;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { pass: uniq.length === 0, bodyLength: body.length, findings: uniq };
}
