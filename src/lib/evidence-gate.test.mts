/**
 * evidence-gate 단위 테스트 — `npx tsx src/lib/evidence-gate.test.mts`
 * 발표연도(stale)·증빙 가능성(not_primary)·연도 없음(no_year)·항구성(durable) 판정을 고정한다.
 * 기준연도는 2026으로 고정 주입한다.
 */
import {
  scanEvidence,
  classifyBasis,
  summarizeEvidence,
  STALE_YEARS,
  type EvidenceCheckable,
} from "./evidence-gate";

const YEAR = 2026;
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
const scan = (o: EvidenceCheckable) => scanEvidence(o, YEAR);
const codesOf = (basis: string) => classifyBasis(basis, YEAR).map((r) => r.code);

console.log("[stale — 발표 후 2년 이상]");
{
  const v = scan({ verify_claims: [{ claim: "암 유병률", basis: "국가암정보센터 2024년 통계" }] });
  ok("2024 통계 @2026 → stale 위반", v.length === 1 && v[0].code === "stale" && v[0].level === "violation");
  ok("ageYears=2 기록", v[0]?.ageYears === 2);
  ok("year=2024 기록", v[0]?.year === 2024);
}
ok("'24년 어포스트로피 형태 → stale", codesOf("'24년 발표 자료").includes("stale"));

console.log("[stale_but_durable — 항구성 자료(위반 아님)]");
{
  const v = classifyBasis("보험업감독규정 표준사업방법서 2015", YEAR);
  ok("2015 + 표준사업방법서 → notice", v.length === 1 && v[0].code === "stale_but_durable" && v[0].level === "notice");
  ok("scanEvidence violation 0(관측만)", scan({ verify_claims: [{ claim: "x", basis: "약관 2015" }] }).filter((i) => i.level === "violation").length === 0);
}

console.log("[no_year — 연도 없음]");
ok("연도 없음 → no_year 위반", codesOf("일반적으로 알려진 내용").includes("no_year"));
ok(
  "no_year level=violation",
  classifyBasis("업계에서 흔히 말하는 내용", YEAR).some((r) => r.code === "no_year" && r.level === "violation")
);

console.log("[not_primary — 증빙 불가 표기]");
ok("'인용 보도' → not_primary 위반", codesOf("인용 보도 — 연합뉴스 2025년").includes("not_primary"));
ok("'원문 확인 권장' → not_primary", codesOf("원문 확인 권장, 2025년").includes("not_primary"));
{
  // 인용 보도 + 최신연도 → not_primary만(stale 아님)
  const c = codesOf("인용 보도 — 연합뉴스 2025년");
  ok("인용 보도 2025 → not_primary만(stale 아님)", c.includes("not_primary") && !c.includes("stale"));
}

console.log("[정상 — 위반 0]");
ok("2025 원문 → clean", scan({ verify_claims: [{ claim: "실손 실적", basis: "금융감독원 2025년 보도자료 원문" }] }).length === 0);
ok("2025 자료 clean(경계 age1)", classifyBasis("금감원 2025 통계자료", YEAR).length === 0);
ok(
  "'10년' 기간은 연도 아님(오탐 가드)",
  classifyBasis("보유기간 10년, 2025년 자료", YEAR).length === 0
);

console.log("[요약·상수]");
ok("STALE_YEARS=2", STALE_YEARS === 2);
{
  const v = scan({
    verify_claims: [
      { claim: "a", basis: "2019 통계" },
      { claim: "b", basis: "인용 보도" },
      { claim: "c", basis: "근거 없음" },
    ],
  });
  ok("복수 claim 스캔 + 요약", summarizeEvidence(v).length > 0 && v.length >= 3);
}
{
  const v = scan({ verify_claims: [{ claim: "여러 이슈", basis: "인용 보도, 연도 표기 없음" }] });
  ok("한 claim 다중 코드(not_primary + no_year)", v.length === 2);
}

console.log(`\n결과: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
