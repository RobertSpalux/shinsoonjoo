/**
 * 「근거 대조 완료 — 전체 확인」 전제 조건 테스트 — `npx tsx src/lib/compliance/verify-pages.test.mts`
 * verify_claims 전 항목에 원문 쪽수가 있을 때만 전체 확인을 연다.
 */
import { allClaimsHavePages, claimsMissingPages, hasPageRef } from "./verify-pages";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) {
    pass++;
    console.log("  ✓", name);
  } else {
    fail++;
    console.log("  ✗ FAIL:", name);
  }
};

const SRC = "국민건강보험공단, 2026년도 노인장기요양보험 민원상담사례집, 2026.3.17";

console.log("\n[1] 쪽수 표기 인식");
ok("「71쪽」", hasPageRef(`${SRC} 71쪽`));
ok("「71쪽 표, 126쪽」", hasPageRef(`${SRC} 71쪽 표, 126쪽`));
ok("「2쪽 ※」", hasPageRef(`${SRC} 2쪽 ※`));
ok("「p.71」", hasPageRef(`${SRC} p.71`));
ok("「p 71」", hasPageRef(`${SRC} p 71`));
ok("발표일만 있으면 쪽수 아님", !hasPageRef(SRC));
ok("연도만 있으면 쪽수 아님", !hasPageRef("금융감독원 보도자료 2025"));
ok("빈 값", !hasPageRef("") && !hasPageRef(null) && !hasPageRef(undefined));

console.log("\n[2] 전 항목 판정");
const good = [
  { claim: "a", basis: `${SRC} 4쪽` },
  { claim: "b", basis: `${SRC} 71쪽 표` },
];
ok("전 항목 쪽수 있음 → 활성", allClaimsHavePages(good));
ok("한 항목 누락 → 비활성", !allClaimsHavePages([...good, { claim: "c", basis: SRC }]));
ok("누락 개수 1", claimsMissingPages([...good, { claim: "c", basis: SRC }]) === 1);
ok("빈 배열 → 비활성(근거 없는 일괄 확인 금지)", !allClaimsHavePages([]));
ok("null → 비활성", !allClaimsHavePages(null));
ok("basis 없음 → 비활성", !allClaimsHavePages([{ claim: "x" }]));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
