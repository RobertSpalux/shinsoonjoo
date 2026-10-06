// 하단 프로필 글 단위 분기 시험 — npx tsx src/lib/profile.test.mts
import { BRAND, PROFILE_PHONE, CERT_8Y_LABEL, CERT_8Y_LEGACY, profileForReview } from "./brand";

let fail = 0;
function ok(name: string, cond: boolean) {
  if (!cond) { fail++; console.error("FAIL", name); } else console.log("ok  ", name);
}
const rv = (no: string, from: string) => ({ authority: "", no, from, to: "" }) as never;

// 승인 글 렌더 차이 0: 기존 승인본(10-06 이전)은 원안 값 그대로
for (const [n, d] of [["2026-07-6088", "2026.07.21"], ["2026-10-0146", "2026.10.01"], ["2026-10-0500", "2026.10.06"], ["2026-09-7998", "2026-09-29"]]) {
  const p = profileForReview(rv(n, d));
  ok(`승인본 ${n} 원안`, p.phone === BRAND.phone && p.cert === CERT_8Y_LEGACY);
}
// 새 심의
for (const [n, d] of [["2026-10-0900", "2026.10.07"], ["2026-10-1000", "2026.10.15"]]) {
  const p = profileForReview(rv(n, d));
  ok(`신규 ${n}`, p.phone === PROFILE_PHONE && p.cert === CERT_8Y_LABEL);
}
ok("심의필 없음(미리보기)", profileForReview(null).phone === PROFILE_PHONE);
ok("번호 없음", profileForReview(rv("", "2026.07.21")).phone === PROFILE_PHONE);
ok("날짜 깨짐", profileForReview(rv("2026-07-6088", "")).phone === PROFILE_PHONE);
ok("정본 자구", CERT_8Y_LABEL === "우수인증설계사 8년 연속 [2018~2025]" && PROFILE_PHONE === "010-9822-0379");
ok("사이트 골격 전화 불변", BRAND.phone === "041-572-0372");
process.exit(fail ? 1 : 0);
