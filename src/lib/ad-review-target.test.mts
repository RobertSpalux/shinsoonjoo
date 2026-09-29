/**
 * 어드민 ad-review 갱신 대상 테스트 — `npx tsx src/lib/ad-review-target.test.mts`
 * 스레드는 「최신 행 update」로 다른 원글의 승인 행(7550)을 덮지 않아야 한다(2026-09-30).
 */
import { resolveAdReviewTarget } from "./ad-review-target";

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

console.log("[1] 본진·네이버 — 최신 행(1글 1행)");
for (const ch of ["main", "naver", "blogspot", "instagram"]) {
  for (const act of ["submit", "approve", "reject", "register-url"]) {
    ok(`${ch} ${act} → latest`, resolveAdReviewTarget(ch, act).mode === "latest");
  }
}

console.log("\n[2] 스레드 — id 로만 갱신, 접수는 새 행");
ok("threads submit(id 없음) → insert", resolveAdReviewTarget("threads", "submit").mode === "insert");
for (const act of ["approve", "reject", "register-url"]) {
  ok(`threads ${act}(id 없음) → error`, resolveAdReviewTarget("threads", act).mode === "error");
}
const t = resolveAdReviewTarget("threads", "approve", "7325c366-463e-4c8f-8e85-998e29cc9f04");
ok("threads approve(id) → byId", t.mode === "byId" && t.id === "7325c366-463e-4c8f-8e85-998e29cc9f04");
ok("threads submit(id) → byId(재접수)", resolveAdReviewTarget("threads", "submit", "x").mode === "byId");
ok("main 도 id 를 주면 byId", resolveAdReviewTarget("main", "approve", "y").mode === "byId");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
