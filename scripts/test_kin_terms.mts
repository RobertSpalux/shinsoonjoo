/**
 * 지식iN 답변 게이트 시험 — npx tsx scripts/test_kin_terms.mts  (실패 시 exit 1)
 */
import { checkKinAnswer, kinNoticeBlock, KIN_NOTICE_MARK, personalTerms } from "../src/lib/compliance/kin-terms";
import { ACTUAL_LOSS_NOTICE, CONDITIONAL_NOTICES } from "../src/lib/brand";

let fail = 0;
function ok(cond: boolean, name: string, extra?: unknown) {
  if (!cond) {
    fail++;
    console.error(`✖ ${name}`, extra ?? "");
  } else console.log(`✓ ${name}`);
}

const P = [
  "부담보 조건이 붙었다는 안내를 받으시면 많이 당황하십니다. 이런 질문을 주시는 분이 많습니다.",
  "판단에 먼저 걸리는 것은 조건의 범위입니다. 어느 부위나 어느 질환군에 붙었는지, 그리고 기간이 정해져 있는지에 따라 같은 부담보라도 의미가 크게 달라집니다. 기간이 정해진 조건이라면 그 기간이 지난 뒤의 보장 구조까지 함께 보셔야 합니다.",
  "두 번째로 걸리는 것은 기존에 가지고 계신 계약과의 관계입니다. 새 계약에 부담보가 붙더라도 이미 가입된 계약에서 같은 부위를 보장하고 있다면 공백이 생기지 않을 수 있고, 반대로 기존 계약이 그 부분을 비워 두고 있다면 공백이 겹쳐서 커질 수 있습니다.",
  "또 하나 살펴보실 부분은 조건이 붙은 계약의 갱신 여부와 납입 기간입니다. 갱신형인지 비갱신형인지에 따라 조건이 이어지는 방식이 다를 수 있어서, 계약서의 조건 안내 문구를 함께 보시는 것이 판단에 도움이 됩니다.",
  "세 번째는 고지 내용과의 연결입니다. 어떤 이력을 어떤 문항에 알렸는지에 따라 조건이 달라졌을 수 있어서, 고지 문항의 문구와 기간을 다시 확인하시는 것이 좋습니다.",
  "제 의견으로는 조건 하나만 따로 보시기보다 가지고 계신 계약 전체를 담보 단위로 펼쳐서 함께 보셔야 정확한 판단이 가능합니다. 같은 조건이라도 전체 구조 안에서 보면 결론이 달라지는 경우가 많습니다.",
].join("\n\n");

const clean = checkKinAnswer(P, "부담보 조건 질문입니다");
ok(clean.pass, "깨끗한 답변 통과", clean.findings);
ok(clean.bodyLength >= 600 && clean.bodyLength <= 900, `길이 ${clean.bodyLength}`);
ok(kinNoticeBlock(P, "부담보") === "", "실손·간편 아니면 유의문구 블록 없음");

const withUrl = checkKinAnswer(P + "\ngoodfinance.kr", "");
ok(!withUrl.pass && withUrl.findings.some((f) => f.rule === "link"), "허용 도메인도 링크면 막힘");

const premium = checkKinAnswer(P.replace("세 번째는", "보험료는 3만원대로 세 번째는"), "");
ok(!premium.pass && premium.findings.some((f) => f.rule === "premium"), "③ 대략 보험료 막힘");

const company = checkKinAnswer(P.replace("세 번째는", "M사 상품이라면 세 번째는"), "");
ok(!company.pass && company.findings.some((f) => f.rule === "recommend"), "① 회사 이니셜 막힘");

const echo = checkKinAnswer(P.replace("세 번째는", "우울증 이력이라면 세 번째는"), "우울증 병력이 있어요");
ok(!echo.pass && echo.findings.some((f) => f.rule === "echo"), "⑤ 질문자 병명 되받기 막힘");

// 약 상품명 — 질문 「제2형당뇨병 마운자로 실비청구」(SH5 견본 1) 되받기는 ①·⑤ 둘 다, 질문에 없어도 ①
const drugQ = "제2형당뇨병 마운자로 실비청구(동네병원)";
const drugEcho = checkKinAnswer(P.replace("세 번째는", "마운자로 처방이라면 세 번째는"), drugQ);
ok(!drugEcho.pass && drugEcho.findings.some((f) => f.rule === "recommend" && f.term.includes("마운자로")), "① 약 상품명 막힘");
ok(drugEcho.findings.some((f) => f.rule === "echo" && f.term.includes("마운자로")), "⑤ 질문의 약 상품명 되받기 막힘");
const drugAlone = checkKinAnswer(P.replace("세 번째는", "위고비 처방이라면 세 번째는"), "부담보 조건 질문입니다");
ok(!drugAlone.pass && drugAlone.findings.some((f) => f.rule === "recommend"), "① 질문에 없는 약 상품명도 막힘");
const generic = checkKinAnswer(P.replace("세 번째는", "주사제 처방이라면 세 번째는"), "마운자로 처방 이력 고지");
ok(generic.pass, "일반명(주사제)은 통과", generic.findings);

const assertive =checkKinAnswer(P.replace("세 번째는", "걱정 마세요. 세 번째는"), "");
ok(!assertive.pass && assertive.findings.some((f) => f.rule === "assertive"), "② 단정 막힘");

const ask = checkKinAnswer(P.replace("세 번째는", "가입하신 상품을 알려 주시면 세 번째는"), "");
ok(!ask.pass && ask.findings.some((f) => f.rule === "askback"), "되묻기 막힘");

const anec = checkKinAnswer(P.replace("세 번째는", "제 고객 중에도 세 번째는"), "");
ok(!anec.pass && anec.findings.some((f) => f.rule === "anecdote"), "일화 날조 막힘");

const noOpinion = checkKinAnswer(P.replace("제 의견으로는", "결국"), "");
ok(!noOpinion.pass && noOpinion.findings.some((f) => f.rule === "opinion"), "개인 의견 귀속 없으면 막힘");

const short = checkKinAnswer(P.slice(0, 300), "");
ok(!short.pass && short.findings.some((f) => f.rule === "length"), "600자 미만 막힘");

const plain = checkKinAnswer(P.replace(/습니다\./g, "다."), "");
ok(!plain.pass && plain.findings.some((f) => f.rule === "style"), "평서체 막힘");

// 실손 주제 → ACTUAL_LOSS_NOTICE 블록 필요, 정본 그대로면 통과
const lossBody = P.replace("부담보 조건이 붙었다는", "실손 청구와 부담보 조건이 붙었다는");
const lossBlock = kinNoticeBlock(lossBody, "");
ok(lossBlock.startsWith(KIN_NOTICE_MARK) && lossBlock.includes(ACTUAL_LOSS_NOTICE), "실손 → 자기부담금 문구 블록");
ok(!checkKinAnswer(lossBody, "").pass, "실손인데 블록 없으면 막힘");
const lossOk = checkKinAnswer(`${lossBody}\n\n${lossBlock}`, "");
ok(lossOk.pass, "실손 + 정본 블록 통과", lossOk.findings);
ok(!checkKinAnswer(`${lossBody}\n\n${lossBlock.replace("보험입니다", "보험")}`, "").pass, "블록 자구 변형 막힘");

const simpleBlock = kinNoticeBlock(P, "간편심사보험 가입 질문");
ok(simpleBlock.includes(CONDITIONAL_NOTICES.simplifiedIssue), "간편심사 → 유병자(간편) 문구");
ok(!simpleBlock.includes("보험설계사의 의견"), "개인의견 문구는 PAMS 자동생성분 — 블록에 넣지 않음");

// ── SH6: 개인 사정 되받기 · 법리 단정 ─────────────────────────────
// 견본2(SH5, 관제탑 반려) 질문 조각과 답변 문장 그대로
const q2 =
  "간병인가입시 상해고지\n깜박하고 고지를 안했어요. . 철회하고 고지하고 다시 들어야할까요 결론부터 말씀드리면, 즉시 계약을... " +
  "보험사 상품별로 성별, 연령, 직업(급수)에 따라 가입가능한 담보와 가입금액, 보험료 등은 상이할 수 있습니다. 보험사... / " +
  "간병인가입을 했는데 신랑이 부딪혀서 정형외과를 다녀왔는데 엑스레이상 괜찮다고.하였어요. 소염제 약... 본 내용은 모집종사자…";
const a2 = [
  "또 하나 짚어볼 부분은, 상해로 다녀온 정형외과 진료가 지금 가입하신 간병보험의 보장 담보와 실제로 연관이 있는지입니다.",
  "단순히 엑스레이 촬영 후 이상 소견 없이 소염제 처방을 받은 정도가 해당 문항의 고지 대상 범위에 들어가는 사안이었는지가 먼저입니다.",
].join(" ");
const echo2 = checkKinAnswer(P.replace("세 번째는", a2 + " 세 번째는"), q2);
for (const w of ["정형외과", "엑스레이", "소염제"])
  ok(echo2.findings.some((f) => f.rule === "personal" && f.term.endsWith(w)), `견본2 개인 사정 되받기: ${w}`, echo2.findings);
ok(!personalTerms(q2.slice(q2.indexOf("\n") + 1)).some((w) => /말씀드리|가입가능|모집종사자|성별|철회/.test(w)),
  "질문 조각의 서술어·보험 일반어는 구체어가 아님", personalTerms(q2));
// 제목의 일반 낱말(상해·간병인)은 되받아도 된다 — 본문만 본다
ok(!checkKinAnswer(P, "간병인가입시 상해고지\n조각").findings.some((f) => f.rule === "personal"), "제목 낱말은 되받기 아님");
// 견본3(통과 수준) 질문 조각 + 일반 서술 — 되받기 없어야 한다
const q3 =
  "상해보험 질문이요.\n거절되거나 부담보 할증이 붙을 수 있어요 특히 보험사는 영양제처럼 보이는 처방도 진료기록으로는 약 복용 이력으로 볼 수 있어서 " +
  "더 보수적으로 보는 편이에요 그래서 보완하려면 1) 일반 상해보험 가능 여부를 먼저 보고 2) 안 되면...";
const general3 =
  "보험사가 심사에서 보는 것은 진료기록에 남은 처방 내역이 고지 대상 기간과 문항에 해당하는지 여부입니다. 단순히 약 이름만으로 판단할 수 없고, 처방 당시 진단명, 처방 기간, 횟수가 함께 심사 대상이 됩니다.";
ok(!checkKinAnswer(P.replace("세 번째는", general3 + " 세 번째는"), q3).findings.some((f) => f.rule === "personal"),
  "견본3 일반 서술은 되받기 아님");
ok(checkKinAnswer(P.replace("세 번째는", "영양제처럼 보이는 처방이라도 세 번째는"), q3).findings.some(
  (f) => f.rule === "personal" && f.term.endsWith("영양제")), "견본3 「영양제처럼 보이는 처방」은 되받기");

// SH6 실수집 견본1 「여유증수술」 — 병명에 「수술」이 붙어 있어도 병명 되받기
const yeo = checkKinAnswer(P.replace("세 번째는", "여유증수술은 분류가 다릅니다. 세 번째는"), "여유증수술\n조각");
ok(yeo.findings.some((f) => f.rule === "echo" && f.term.includes("여유증")), "병명+수술 붙여 쓴 것도 되받기", yeo.findings);
ok(!checkKinAnswer(P, "실손24 청구 궁금증\n조각").findings.some((f) => f.rule === "echo"), "「궁금증」은 병명 아님");

const legalCases: [string, string][] = [
  ["보장을 제한할 수 있는 범위는 통상 인과관계가 있는 부분에 한정되는 경우가 많습니다.", "~에 한정"],
  ["이 경우 보험사는 계약을 해지할 수 없습니다.", "해지할 수 없다"],
  ["판례상 이런 경우는 보험금이 지급됩니다.", "판례상"],
  ["법적으로 고지의무 위반은 계약 해지 사유입니다.", "법적으로 ~"],
  ["고지의무는 청약서 질문 문항에 한해서 적용되는 것이 원칙입니다.", "~이 원칙입니다"],
  ["소멸시효는 청구할 수 있는 권리가 생긴 날부터 세는 것이 원칙이라 날짜가 다를 수 있습니다.", "~이 원칙입니다"],
  ["진료일자별로 각각 시효가 따로 진행된다는 점도 보셔야 합니다.", "시효 법리"],
  ["보험사 내부적으로 시효 중단 사유가 있었는지도 따집니다.", "시효 법리"],
  ["보험금 청구권의 소멸시효는 보통 사고일부터 계산되는 경우가 많습니다.", "시효 법리"],
  ["계약 성립 이후 사고는 원칙적으로 고지 의무와 별개의 사안으로 다뤄지는 경우가 많습니다.", "원칙적으로"],
];
for (const [s, term] of legalCases) {
  const r = checkKinAnswer(P.replace("세 번째는", s + " 세 번째는"), "");
  ok(!r.pass && r.findings.some((f) => f.rule === "legal" && f.term.includes(term) && f.reason.includes("약관·사안별")),
    `법리 단정 막힘: ${term}`, r.findings);
}
const soft = checkKinAnswer(
  P.replace("세 번째는", "고지 여부가 보장에 미치는 영향은 약관과 사안에 따라 판단이 달라질 수 있습니다. 세 번째는"), "");
ok(!soft.findings.some((f) => f.rule === "legal"), "「약관과 사안에 따라 달라질 수 있다」는 통과", soft.findings);
ok(!clean.findings.some((f) => f.rule === "legal"), "기존 깨끗한 답변(「질환군에 붙었는지」 등)은 법리 단정 아님");

if (fail) {
  console.error(`\n${fail}건 실패`);
  process.exit(1);
}
console.log("\n전부 통과");
