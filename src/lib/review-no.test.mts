/**
 * 심의필 번호 이중 표기 방지 테스트 — `npx tsx src/lib/review-no.test.mts`
 * 번호만 · 전체 문구 · 앞뒤 공백 · 「호」만 붙은 값이 모두 한 번만 감싸져 찍히는지 고정한다.
 * (실측 사고: 2026-09 4건이 「제프라임에셋 심의필 제…호호」로 게시됨)
 */
import { normalizeReviewNo } from "./review-no";
import { renderMandatoryNotice, SITE_REVIEW } from "./brand";

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

const EXPECTED = "프라임에셋 심의필 제2026-09-7095호 (2026.09.28~2027.09.27)";
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const render = (no: string) =>
  renderMandatoryNotice(
    { authority: "프라임에셋", no, from: "2026.09.28", to: "2027.09.27" },
    "publish"
  );

console.log("\n[1] 입력 변형 → 한 번만 감싼 표기");
const variants: Record<string, string> = {
  번호만: "2026-09-7095",
  "전체 문구": "프라임에셋 심의필 제2026-09-7095호",
  "앞뒤 공백": "  2026-09-7095 \n",
  "「호」만 붙음": "2026-09-7095호",
  "「제」만 붙음": "제2026-09-7095",
  "전체 문구 + 기간": "프라임에셋 심의필 제2026-09-7095호 (2026.09.28~2027.09.27)",
  "전체 문구 + 공백": "  프라임에셋 심의필 제 2026-09-7095 호  ",
};
for (const [name, v] of Object.entries(variants)) {
  ok(`${name}: 정규화 = 2026-09-7095`, normalizeReviewNo(v) === "2026-09-7095");
  const out = render(v) ?? "";
  ok(`${name}: 표기 문장 정확히 1회`, count(out, EXPECTED) === 1);
  ok(`${name}: 「심의필」 1회`, count(out, "심의필") === 1);
  ok(`${name}: 이중 표기 없음`, !out.includes("호호") && !out.includes("제프라임에셋"));
}

console.log("\n[2] 형식 오류 → 저장 거절 / 표기 안 함");
for (const bad of ["", "   ", "7095", "2026-7095", "2026-13-7095", "2026-09-70", "abc", "2026-09-7095-1"]) {
  ok(`거절: ${JSON.stringify(bad)}`, normalizeReviewNo(bad) === null);
}
{
  const origErr = console.error;
  console.error = () => {};
  ok("형식 오류 값은 필수안내사항을 만들지 않는다", render("심의필 제7095호") === null);
  console.error = origErr;
}
ok("null/undefined 거절", normalizeReviewNo(null) === null && normalizeReviewNo(undefined) === null);

console.log("\n[3] 사이트 심의필 상수");
ok(
  "SITE_REVIEW.no 는 번호만",
  !SITE_REVIEW || normalizeReviewNo(SITE_REVIEW.no) === SITE_REVIEW.no
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
