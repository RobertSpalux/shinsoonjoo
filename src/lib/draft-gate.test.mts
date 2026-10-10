// draft-gate.ts — 초안 게이트 판정(금지어 A 차단 · 문체 · 근거 violation 차단).
//   npx tsx src/lib/draft-gate.test.mts
import { judgeDraft } from "./draft-gate";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗ FAIL:", name); }
};

const CLEAN = "사망보장은 원인별로 나눠서 봅니다. 합계를 표로 정리합니다. 담보별로 판단합니다.";
const GOOD_CLAIM = [{ claim: "상법", basis: "상법 제730조, 2024 개정 법령", confidence: "high" }];

ok("깨끗한 초안 → 통과", judgeDraft({ slug: "t", verify_claims: GOOD_CLAIM }, CLEAN, null, 2026).pass);
ok("금지어 A(무료 진단) → 막힘", !judgeDraft({ slug: "t" }, CLEAN + " 무료 진단을 받아 보세요.", null, 2026).pass);
ok("평서체 다수 → 막힘", !judgeDraft({ slug: "t" }, "보장은 나뉜다. 합계가 다르다. 만기도 다르다. 판단은 담보별이다.", null, 2026).pass);
const noYear = judgeDraft({ slug: "t", verify_claims: [{ claim: "약관", basis: "표준약관 — 연도 미기재" }] }, CLEAN, null, 2026);
ok("근거 연도 없음 → 막힘(no_year)", !noYear.pass && noYear.evidence.issues.some((i) => i.code === "no_year"));
ok("못 미친다면 → 금지어 clean", judgeDraft({ slug: "t" }, CLEAN + " 필요한 금액에 못 미친다면 보완합니다.", null, 2026).banned.level === "clean");
ok("본진 원고도 검사", !judgeDraft({ slug: "t" }, CLEAN, "무료 진단을 받아 보세요.", 2026).pass);

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
