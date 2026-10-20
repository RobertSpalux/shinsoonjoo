/**
 * GA4 이벤트 맥락 테스트 — `npx tsx src/lib/ga.test.mts`
 * 전환 이벤트마다 붙는 article_slug 가 글·미리보기·진단(ref)에서 맞게 잡히는지, 내부 경로 판정이 맞는지 고정한다(IX1).
 */
import { articleSlugOf, pageContext, INTERNAL_PATH } from "./ga";

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

console.log("\n[1] article_slug");
ok("/news/<slug>", articleSlugOf("/news/daily-life-liability-deductible-nusu", "") === "daily-life-liability-deductible-nusu");
ok("/preview/news/<slug>", articleSlugOf("/preview/news/a-b", "?token=x") === "a-b");
ok("진단 ?ref=<slug>", articleSlugOf("/diagnosis", "?ref=silson-conversion-withdrawal-6month&utm_source=naver") === "silson-conversion-withdrawal-6month");
ok("홈 = 빈 값", articleSlugOf("/", "") === "");
ok("/news 목록 = 빈 값", articleSlugOf("/news", "") === "");
ok("pageContext 경로", pageContext("/news/x", "").page_path === "/news/x");

console.log("\n[2] 내부 경로");
ok("/admin", INTERNAL_PATH.test("/admin"));
ok("/admin/funnel", INTERNAL_PATH.test("/admin/funnel"));
ok("/preview/news/x", INTERNAL_PATH.test("/preview/news/x"));
ok("/administrator 아님", !INTERNAL_PATH.test("/administrator"));
ok("/news 아님", !INTERNAL_PATH.test("/news/admin-guide"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
