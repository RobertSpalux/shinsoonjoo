/**
 * 진단 결과 → 카톡 다리 문구 테스트 — `npx tsx src/lib/diagnosis-bridge.test.mts`
 * 금소법 게이트(checkBannedTerms)를 통과하고, 복사 메시지에 점수·계약 수 외의 응답이 들어가지 않는지 고정한다.
 */
import { BRIDGE_COPY, KAKAO_CHAT_URL, buildKakaoMessage } from "./diagnosis-bridge";
import { checkBannedTerms } from "./compliance/banned-terms";

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

console.log("[1] 금소법 게이트 — 화면 문구 + 복사 메시지");
const msg = buildKakaoMessage(76, "3~5개");
const all = [...Object.values(BRIDGE_COPY), msg].join("\n");
const r = checkBannedTerms({ main_website_markdown: all });
for (const f of r.findings) console.log("   ", f.grade, f.term, "—", f.reason);
ok("A·B 등급 적발 0건", r.findings.length === 0);
ok("「무료」 없음", !all.includes("무료"));

console.log("\n[2] 복사 메시지 — 점수·계약 수만");
ok("점수 포함", msg.includes("76점"));
ok("계약 수 포함", msg.includes("계약 수: 3~5개"));
ok("계약 수 미응답이면 줄에서 빠진다", !buildKakaoMessage(80).includes("계약 수"));
for (const w of ["만원", "소득", "보험료", "싱글", "자녀", "은퇴", "법인", "실손", "암"]) {
  ok(`응답 누출 없음: ${w}`, !buildKakaoMessage(76, "3~5개").includes(w));
}

console.log("\n[3] 채팅창 URL");
ok("…/_xoxdBwX/chat", KAKAO_CHAT_URL.endsWith("/_xoxdBwX/chat"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
