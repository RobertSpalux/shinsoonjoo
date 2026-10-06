// 원문 출처 줄 글 단위 분기 시험 — npx tsx src/lib/source-line.test.mts
import { reviewSourceLine } from "./source-line";

let fail = 0;
function ok(name: string, cond: boolean) {
  if (!cond) { fail++; console.error("FAIL", name); } else console.log("ok  ", name);
}
const rv = (no: string, from: string) => ({ authority: "", no, from, to: "" }) as never;
const ESWL = "https://www.fss.or.kr/fss/bbs/B0000188/view.do?nttId=218809&menuNo=200218";
const OTHER = "https://www.fss.or.kr/fss/bbs/B0000188/view.do?nttId=217901&menuNo=200218";
const TARGET = "금융감독원_금융소비자 보호 및 실손보험금 누수 방지를 위해 체외충격파 치료 분쟁조정기준을 마련하였습니다._2026.6.24.";

ok("eswl 새 심의(미승인) = 목표 문자열", reviewSourceLine(ESWL, null) === TARGET);
ok("eswl 새 심의(승인일 10-07 이후) = 목표 문자열", reviewSourceLine(ESWL, rv("2026-10-0900", "2026.10.07")) === TARGET);
ok("eswl 승인본(10-06) = 원안(undefined)", reviewSourceLine(ESWL, rv("2026-10-0500", "2026.10.06")) === undefined);
ok("eswl 승인본(07-21) = 원안(undefined)", reviewSourceLine(ESWL, rv("2026-07-6088", "2026.07.21")) === undefined);
ok("수동 값 없는 출처 새 심의 = 기본 {org}_{title}_{published}.", reviewSourceLine(OTHER, null) === "금융감독원_최근 민원사례로 알아보는 실손의료보험 관련 소비자 유의사항_2026.5.19.");
ok("수동 값 없는 출처 승인본 = 원안(undefined)", reviewSourceLine(OTHER, rv("2026-07-6088", "2026.07.21")) === undefined);
ok("sources.json 에 없는 URL = undefined", reviewSourceLine("https://example.com/x", null) === undefined);
ok("출처 URL 없음 = undefined", reviewSourceLine(null, null) === undefined);
process.exit(fail ? 1 : 0);
