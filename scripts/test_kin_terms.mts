/**
 * 지식iN 답변 게이트 시험 — npx tsx scripts/test_kin_terms.mts  (실패 시 exit 1)
 */
import { checkKinAnswer, kinNoticeBlock, KIN_NOTICE_MARK } from "../src/lib/compliance/kin-terms";
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

const assertive = checkKinAnswer(P.replace("세 번째는", "걱정 마세요. 세 번째는"), "");
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

if (fail) {
  console.error(`\n${fail}건 실패`);
  process.exit(1);
}
console.log("\n전부 통과");
