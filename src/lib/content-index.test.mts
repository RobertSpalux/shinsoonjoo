/**
 * 주간 유입 지수 표 접기 테스트 — `npx tsx src/lib/content-index.test.mts`
 */
import { pivot, rankArrow, convTotal, type IndexRow } from "./content-index";

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

const row = (week_start: string, slug: string, rank: number | null, verdicts: string[] = []): IndexRow => ({
  week_start, slug, keyword: "k", keyword_source: "auto", naver_blog_rank: rank, naver_blog_n: 30, naver_post_matched: null,
  naver_integ_blog: null, naver_integ_main: null, gsc_impressions: null, gsc_clicks: null, gsc_position: null,
  gsc_top_queries: null, ga_sessions: null, conv_events: { kakao_click: 1, generate_lead: 2 }, verdicts, errors: null,
});

console.log("\n[1] rankArrow");
ok("올라감", rankArrow(3, 7) === "▲4");
ok("내려감", rankArrow(9, 2) === "▼7");
ok("밖으로", rankArrow(null, 5) === "▼밖");
ok("전주 없음 = 빈칸", rankArrow(5, null) === "");

console.log("\n[2] pivot");
const { weeks, lines } = pivot([
  row("2026-10-12", "a", 2),
  row("2026-10-19", "a", 1),
  row("2026-10-19", "b", null, ["갱신 대상"]),
  row("2026-10-19", "c", 6, ["보강 대상"]),
  row("2026-10-05", "a", 9),
], 2);
ok("주차 최신순 · 최대 2", JSON.stringify(weeks) === JSON.stringify(["2026-10-19", "2026-10-12"]));
ok("판정 순서 갱신 → 보강 → 나머지", lines.map((l) => l.slug).join() === "b,c,a");
ok("셀 정렬", lines[2].cells.map((c) => c?.naver_blog_rank).join() === "1,2");
ok("없는 주 = null", lines[0].cells[1] === null);
ok("convTotal", convTotal(lines[0].latest) === 3);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
