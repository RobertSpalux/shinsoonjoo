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

export type KinRule =
  | ReplyFinding["rule"]
  | "link"
  | "length"
  | "askback"
  | "anecdote"
  | "opinion"
  | "notice"
  | "style"
  | "personal"
  | "legal";

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
 * 개인 사정 되받기(⑤ 확장, SH6 2026-10-09 관제탑 — 견본2 「엑스레이 촬영 후 이상 소견 없이 소염제 처방」「정형외과」).
 * 질문 본문(제목 제외)의 구체어가 답변에 다시 나오면 막는다. 병명·약 상품명은 reply-terms 가 따로 본다.
 * 구체어 = 조사를 뗀 한글 어절 4자 이상(3자는 「~제·~약·~과」 — 소염제·진통제·내과류만) 중 보험 일반어가 섞이지 않은 것.
 * 서술어(「다녀왔는데」「말씀드리면」)는 구체어가 아니라 뺀다.
 */
const GENERAL_ROOTS = [
  "보험", "실손", "실비", "고지", "알릴", "담보", "보장", "청구", "특약", "가입", "심사", "진료", "처방", "병원", "계약",
  "보험사", "설계사", "모집종사자", "보험금", "보험료", "면책", "감액", "부담보", "해지", "유지", "갱신", "환급", "납입",
  "질병", "상해", "수술", "입원", "통원", "치료", "진단", "검사", "의료", "병력", "이력", "기간", "문항", "약관", "서류",
  "확인", "상담", "결론", "말씀", "경우", "내용", "부분", "질문", "답변", "관련", "상품", "회사", "성별", "연령", "직업",
  "급수", "간병", "유병자", "간편", "철회", "청약", "증권", "위반", "조건", "할증", "거절", "심의", "의견", "안내",
  "자기부담", "비급여", "급여", "세대", "구조", "판단", "사실", "의사", "기록", "사유", "가능", "여부", "상황", "정도",
];
const JOSA_RE =
  /(?:으로부터|에서부터|이라도|이라서|이라면|에게서|으로는|에서는|에서도|이지만|이라고|라고|으로|에서|에게|까지|부터|보다|처럼|이나|이랑|하고|과는|와는|에는|에도|상으로|상|을|를|이|가|은|는|에|의|와|과|도|만|로|나|랑)$/;
const PREDICATE_RE =
  /(?:다|요|죠|니다|는데|지만|면서|어서|아서|해서|하여|했|했는|하는|되는|되어|된|한|할|하게|하면|으면|드리면|겠|나요|까요|던|았|었|고서|라도|라서|다고|하고|되고|했고|않고|지고|는지|을지|ㄹ지|인지|니까|어도|아도|해도|려면|어야|아야|거나|하시기|시기를|혀서|려서|워서|와서|가서)$/;
const SHORT_SPECIFIC_RE = /^[가-힣]{2}(?:제|약|과)$/;

export function personalTerms(questionBody: string): string[] {
  const out = new Set<string>();
  for (const m of (questionBody ?? "").matchAll(/[가-힣]{3,}/g)) {
    let w = m[0];
    if (PREDICATE_RE.test(w)) continue;
    w = w.replace(JOSA_RE, ""); // 한 번만 — 「엑스레이상」→「엑스레이」(두 번 떼면 「엑스레」). 답변 쪽은 포함 검사라 짧아져도 잡힌다
    if (w.length < 3) continue;
    if (w.length === 3 && !SHORT_SPECIFIC_RE.test(w)) continue;
    if (PREDICATE_RE.test(w)) continue;
    if (GENERAL_ROOTS.some((r) => w.includes(r))) continue;
    out.add(w);
  }
  return [...out];
}

/**
 * 법리 단정(SH6 — 견본2 「인과관계가 있는 부분에 한정되는 경우가 많습니다」). 법률 효과는 약관·사안별로 다르다는 수준으로만.
 */
const LEGAL_ASSERT: { term: string; re: RegExp }[] = [
  { term: "~에 한정", re: /한정(?:됩니다|된다|되며|되는\s*(?:것이|경우가)\s*(?:많|일반|원칙|보통)|돼요|되어\s*있습니다)/g },
  { term: "해지할 수 없다", re: /해지(?:할|하실|를\s*할)\s*수\s*(?:없습니다|없어요|없다|없게)/g },
  { term: "판례상", re: /판례(?:상|에\s*따르면|로는|는|가)/g },
  { term: "법적으로 ~", re: /법(?:적으로|률상|상)\s*[^.?!\n]{0,40}?(?:입니다|됩니다|합니다|없습니다|있습니다)/g },
  { term: "~이 원칙입니다", re: /원칙(?:입니다|이다|이에요|이라|이므로|으로\s*(?:합니다|봅니다))/g },
  // SH6 2회차 견본1(실비 시효) — 「진료일자별로 각각 시효가 따로 진행된다」「시효 중단 사유」
  { term: "시효 법리", re: /시효(?:가|는)?\s*(?:중단|(?:각각\s*|따로\s*)*진행|완성)|소멸\s*시효/g },
  // 3회차 — 「원칙적으로 … 별개의 사안으로 다뤄지는 경우가 많습니다」(완곡형도 법률 효과 서술이다)
  { term: "원칙적으로", re: /원칙적으로/g },
  { term: "무효·취소 단정", re: /(?:무효|취소)(?:입니다|가\s*됩니다|됩니다|할\s*수\s*있습니다)/g },
];

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
  // question = 「제목\n본문 조각」(kin_pipeline). 제목의 일반 낱말은 되받아도 되고(병명은 위 reply-terms 가 본다), 본문만 본다.
  const nl = (question ?? "").indexOf("\n");
  for (const w of personalTerms(nl === -1 ? "" : question.slice(nl + 1)))
    if (body.includes(w))
      findings.push({
        rule: "personal",
        term: `개인 사정 되받기: ${w}`,
        reason: "§6.10 댓글심의 ⑤ 질문자 개인 사정 — 「그 진료」「해당 처방」처럼 일반화",
      });
  for (const p of LEGAL_ASSERT)
    for (const m of body.matchAll(p.re))
      findings.push({
        rule: "legal",
        term: `법리 단정(${p.term}): ${m[0].trim()}`,
        reason: "법률 효과는 약관·사안별로 다르다는 수준으로만",
      });
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
