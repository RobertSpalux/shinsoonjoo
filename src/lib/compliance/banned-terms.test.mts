/**
 * banned-terms 단위 테스트 — `npx tsx src/lib/compliance/banned-terms.test.mts`
 * 오탐(최대한·치명적 질병·무조건 해지 부정문)과 A등급 적발·통계 승격을 고정한다.
 */
import { checkBannedTerms, type CheckableArticle, type ComplianceAck } from "./banned-terms";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗ FAIL:", name); }
};
const art = (o: Partial<CheckableArticle>): CheckableArticle => o;
const levelOf = (o: Partial<CheckableArticle>, acks: ComplianceAck[] = []) =>
  checkBannedTerms(art(o), acks).level;

console.log("[오탐 0 — clean]");
ok("최대한 → clean", levelOf({ main_website_markdown: "최대한 확인해 보시기 바랍니다." }) === "clean");
ok("최고령 → clean", levelOf({ main_website_markdown: "최고령 가입 사례를 봅니다." }) === "clean");
ok("치명적 질병 진단비 → clean", levelOf({ main_website_markdown: "치명적 질병 진단비 담보를 봅니다." }) === "clean");
ok("무조건 해지가 답은 아닙니다 → clean", levelOf({ main_website_markdown: "무조건 해지가 답은 아닙니다." }) === "clean");

console.log("[A등급 — block]");
ok("무료 진단 → block", levelOf({ main_website_markdown: "무료 진단을 받아보세요." }) === "block");
ok("제목 5,000만원 → block", levelOf({ title: "내 암보험금, 5,000만원 맞을까?" }) === "block");
ok("본문 5,000만원 → block 아님(가정형)", levelOf({ main_website_markdown: "담보를 합산하면 5,000만원이 보입니다." }) === "clean");
ok("비과세 단독 → block", levelOf({ main_website_markdown: "이 상품은 비과세 혜택이 있습니다." }) === "block");
ok("비과세 + 요건 병기 → clean", levelOf({ main_website_markdown: "비과세(관련 세법 요건 충족시) 혜택." }) === "clean");
ok("당장 가입하세요 → block", levelOf({ main_website_markdown: "당장 가입하세요." }) === "block");
ok("당장 필요하지 않은 → clean", levelOf({ main_website_markdown: "당장 필요하지 않은 보장은 줄입니다." }) === "clean");
ok("설계사는 안 알려주는 → block", levelOf({ main_website_markdown: "설계사는 안 알려주는 사실이 있습니다." }) === "block");
ok("O원 보상 받았습니다 → block", levelOf({ main_website_markdown: "500만원 보상 받았습니다." }) === "block");
ok("O원 보장받을 수 있습니다 → clean", levelOf({ main_website_markdown: "500만원 보장받을 수 있습니다." }) === "clean");
ok("납입면제 사례 → block", levelOf({ main_website_markdown: "납입면제 사례를 소개합니다." }) === "block");

console.log("[B등급 — warn / ack]");
ok("최고 (증빙無) → warn", levelOf({ main_website_markdown: "최고의 보장입니다." }) === "warn");
ok("삼성생명 → warn", levelOf({ main_website_markdown: "삼성생명 상품과 비교하면" }) === "warn");
{
  const a = art({ main_website_markdown: "최고의 보장입니다." });
  const r = checkBannedTerms(a);
  const b = r.findings.find((f) => f.grade === "B");
  const acks: ComplianceAck[] = b ? [{ field: b.field, term: b.term, offset: b.offset, ackedAt: "t" }] : [];
  ok("B 확인(ack) 후 → clean", checkBannedTerms(a, acks).level === "clean");
}

console.log("[통계치 승격 — verify_claims 대조]");
ok("근거 없는 30% → block", levelOf({ main_website_markdown: "환자의 30%가 해당됩니다." }) === "block");
ok("근거 있는 30% → warn",
  levelOf({
    main_website_markdown: "환자의 30%가 해당됩니다.",
    verify_claims: [{ claim: "유병률", basis: "국가암정보센터 2023, 30%" }],
  }) === "warn");

console.log("[findings 메타]");
{
  const r = checkBannedTerms(art({ title: "무료 5,000만원 끝판왕" }));
  const f = r.findings[0];
  ok("Finding에 field/term/grade/offset/reason/guidance 존재",
    !!f && !!f.field && !!f.term && !!f.grade && Number.isInteger(f.offset) && !!f.reason && !!f.guidance);
  ok("§6.10 조항 근거 포함", r.findings.every((x) => x.reason.includes("§6.10")));
}

console.log("[신규 금지어 260521 — A block]");
ok("어마무시한 → block", levelOf({ main_website_markdown: "어마무시한 보장입니다." }) === "block");
ok("왕창 → block", levelOf({ main_website_markdown: "보험료 왕창 아끼는 법." }) === "block");
ok("전설의 보험 → block", levelOf({ main_website_markdown: "전설의 보험이 있습니다." }) === "block");
ok("3대천왕 → block", levelOf({ main_website_markdown: "실손 3대천왕 정리." }) === "block");
ok("문의 폭주 → block", levelOf({ main_website_markdown: "문의 폭주 중입니다." }) === "block");
ok("거지되기 싫으면 → block", levelOf({ main_website_markdown: "거지되기 싫으면 준비하세요." }) === "block");
ok("호구 → block", levelOf({ main_website_markdown: "호구 되지 마세요." }) === "block");
ok("호구조사 → clean(오탐 제외)", levelOf({ main_website_markdown: "옛 호구조사 자료입니다." }) === "clean");
ok("쪽박찬다 → block", levelOf({ main_website_markdown: "쪽박찬다는 말이 있습니다." }) === "block");
ok("미친 듯이 → block", levelOf({ main_website_markdown: "미친 듯이 오릅니다." }) === "block");
ok("막차타세요 → block", levelOf({ main_website_markdown: "지금 막차타세요." }) === "block");
ok("부자되는 보험 → block", levelOf({ main_website_markdown: "부자되는 보험입니다." }) === "block");
ok("보험을 로또 비유 → block", levelOf({ main_website_markdown: "보험을 로또처럼 생각하면 안 됩니다." }) === "block");
ok("간병파산 → block", levelOf({ main_website_markdown: "간병파산을 막으려면." }) === "block");
ok("곧 없어진다 → block", levelOf({ main_website_markdown: "이 상품 곧 없어진다." }) === "block");
ok("영상 삭제 전에 → block", levelOf({ main_website_markdown: "영상 삭제 전에 보세요." }) === "block");
ok("보험사는 안 알려주는 → block", levelOf({ main_website_markdown: "보험사는 안 알려주는 사실." }) === "block");
ok("보험사만 배불려준다 → block", levelOf({ main_website_markdown: "보험사만 배불려준다는 말." }) === "block");
ok("보험사는 해지를 기다린다 → block", levelOf({ main_website_markdown: "보험사는 해지하기를 기다립니다." }) === "block");
console.log("[신규 B등급 — warn + 동사 오탐 제외]");
ok("미친 가성비 → warn", levelOf({ main_website_markdown: "완전 미친 가성비." }) === "warn");
ok("영향을 미친다 → clean(동사 제외)", levelOf({ main_website_markdown: "보험료에 영향을 미친다." }) === "clean");
ok("죽어도 → warn", levelOf({ main_website_markdown: "죽어도 안 나오는 경우가 있습니다." }) === "warn");
ok("돈 날린다 → warn", levelOf({ main_website_markdown: "돈 날린다는 말이 있습니다." }) === "warn");

console.log(`\n결과: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
