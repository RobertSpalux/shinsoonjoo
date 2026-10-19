/**
 * kin_draft.mts 구독 전환 시험 — npx tsx scripts/kin_draft.test.mts (네트워크·claude 실행 없음)
 * API0s(2026-10-14): 유료 API 대신 `claude -p`. API 키가 보이면 실행하지 않는다.
 */
import { buildPrompt, childEnv, parseCliResult, splitDraft, visibleApiEnv } from "./kin_draft.mts";

let fail = 0;
function ok(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) fail++;
}

ok("API 키 없으면 빈 목록", visibleApiEnv({ PATH: "x" }).length === 0);
ok("API 키 이름만 돌려준다", JSON.stringify(visibleApiEnv({ ANTHROPIC_API_KEY: "sk-비밀", ANTHROPIC_BASE_URL: "u" })) === '["ANTHROPIC_API_KEY","ANTHROPIC_BASE_URL"]');
ok("빈 값은 보이지 않는 것", visibleApiEnv({ ANTHROPIC_API_KEY: "" }).length === 0);

const env = childEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", PATH: "p" });
ok("자식 환경에서 API 키·중첩 표지 제거", JSON.stringify(env) === '{"PATH":"p"}');

const p = buildPrompt({ id: "u", title: "실비 청구 질문", body: "질문 본문".repeat(1000), feedback: "length: 본문 946자" }, "SYS");
ok("시스템 프롬프트가 맨 앞", p.startsWith("SYS\n"));
ok("질문 제목 포함", p.includes("질문 제목: 실비 청구 질문"));
ok("질문 본문 3000자 자름", !p.includes("질문 본문".repeat(601)));
ok("재작성 사유 포함", p.includes("length: 본문 946자"));
ok("도구 금지 지시", p.includes("도구도 쓰지 마라"));
ok("사유 없으면 재작성 문구 없음", !buildPrompt({ id: "u", title: "t", body: "b" }, "S").includes("심의 게이트에 걸렸다"));

// KQ2 — 머리 3줄(질문 핵심·직접 응답) 떼기
const sd = splitDraft("질문 핵심: 검진 이력이 고지 대상인가\n직접 응답: 예\n---\n보통 청약서는 일정 기간을 묻습니다.\n\n둘째 문단.");
ok("머리 → core", sd.core === "검진 이력이 고지 대상인가");
ok("머리 → direct 예", sd.direct === true);
ok("본문에 머리 없음", sd.text === "보통 청약서는 일정 기간을 묻습니다.\n\n둘째 문단.");
ok("직접 응답 아니오", splitDraft("질문 핵심: x\n직접 응답: 아니오\n---\n본문").direct === false);
const nh = splitDraft("머리 없이 바로 본문입니다.");
ok("머리 없으면 본문 그대로·core 빈칸", nh.text === "머리 없이 바로 본문입니다." && nh.core === "" && nh.direct === null);
ok("프롬프트에 머리 지시", buildPrompt({ id: "u", title: "t", body: "b" }, "S").includes("질문 핵심"));

ok("정상 결과", parseCliResult(JSON.stringify({ type: "result", is_error: false, result: "  본문입니다.  " }), 0).text === "본문입니다.");
ok("is_error → 오류", !!parseCliResult(JSON.stringify({ is_error: true, result: "Credit balance is too low" }), 1).error);
ok("빈 결과 → 빈 응답", parseCliResult(JSON.stringify({ is_error: false, result: "" }), 0).error === "빈 응답");
ok("JSON 아님 + rc≠0 → 오류", !!parseCliResult("oops", 1, "err").error);
ok("JSON 아님 + rc=0 → 그대로 본문", parseCliResult("본문\n", 0).text === "본문");

if (fail) {
  console.error(`실패 ${fail}건`);
  process.exit(1);
}
console.log("kin_draft 시험 통과");
