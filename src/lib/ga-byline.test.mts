/**
 * 바이라인 GA 명장 표기 — 글 단위 규칙 고정. `npx tsx src/lib/ga-byline.test.mts`
 * (로버트 2026-10-02: 이미 승인된 글은 바꾸지 않는다 · 7호·8호(반송)·신규 심의만 「22년·25년 GA 명장」)
 */
import { bylineGaMaster, GA_MASTER_LABEL, GA_MASTER_LEGACY, GA_MASTER_CUTOFF } from "./brand";

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
const rv = (no: string, from: string) => ({ authority: "프라임에셋", no, from, to: "2027.09.30" });

console.log("\n[1] 기준일 이전 승인 = 승인본 그대로");
ok("6088 (2026.07.21)", bylineGaMaster(rv("2026-07-6088", "2026.07.21")) === GA_MASTER_LEGACY);
ok("0146 10호 (2026.10.01)", bylineGaMaster(rv("2026-10-0146", "2026.10.01")) === GA_MASTER_LEGACY);
ok("하이픈 날짜도 같다", bylineGaMaster(rv("2026-09-7998", "2026-09-29")) === GA_MASTER_LEGACY);
ok("옛 표기는 「GA명장」", GA_MASTER_LEGACY === "GA명장");

console.log("\n[2] 승인 전·반송·신규 = 새 표기");
ok("심의필 없음(제출용 미리보기 · 반송)", bylineGaMaster(null) === GA_MASTER_LABEL);
ok("기준일 당일 승인", bylineGaMaster(rv("2026-10-0500", GA_MASTER_CUTOFF)) === GA_MASTER_LABEL);
ok("기준일 뒤 승인", bylineGaMaster(rv("2026-10-0900", "2026.10.15")) === GA_MASTER_LABEL);
ok("번호 없는 값", bylineGaMaster(rv("", "2026.07.21")) === GA_MASTER_LABEL);
ok("날짜 깨짐", bylineGaMaster(rv("2026-07-6088", "")) === GA_MASTER_LABEL);
ok("새 표기", GA_MASTER_LABEL === "22년·25년 GA 명장");

console.log(`\n${pass} 통과 · ${fail} 실패`);
if (fail) process.exit(1);
