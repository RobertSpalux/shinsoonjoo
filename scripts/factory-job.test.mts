/**
 * factory-job.mjs 시험 — npx tsx scripts/factory-job.test.mts (네트워크 없음, 가짜 fetch)
 * 크론 스크립트가 202 대기열 응답을 받아 종전과 같은 {status, json} 으로 바꾸는지 본다.
 */
import { waitFactoryJob } from "./factory-job.mjs";

let fail = 0;
function ok(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) fail++;
}
const res = (status: number) => ({ status }) as Response;
const seq = (...bodies: unknown[]) => {
  let i = 0;
  const urls: string[] = [];
  const f = async (url: string, init: { headers: Record<string, string> }) => {
    urls.push(url + " " + init.headers["x-factory-secret"]);
    const b = bodies[Math.min(i++, bodies.length - 1)];
    return { ok: b !== null, json: async () => b } as Response;
  };
  return { f, urls };
};
const opts = (fetchImpl: unknown, waitMs = 1000) => ({ pollMs: 1, waitMs, fetchImpl: fetchImpl as typeof fetch });

ok("202 아니면 null(종전 처리)", (await waitFactoryJob("https://s", "k", res(200), { success: true })) === null);
ok("job_id 없으면 null", (await waitFactoryJob("https://s", "k", res(202), {})) === null);

{
  const { f, urls } = seq({ status: "queued" }, null, { status: "running" }, { status: "done", result_status: 200, result: { success: true, article: { slug: "a" } } });
  const out = await waitFactoryJob("https://s", "k", res(202), { job_id: "j1" }, opts(f));
  ok("done → 종전 상태·본문", out?.status === 200 && out.json.article.slug === "a");
  ok("폴링 주소·비밀 헤더", urls[0] === "https://s/api/factory/jobs/j1 k");
}
{
  const { f } = seq({ status: "error", result_status: 409, result: { error: "이미 생성된 시드입니다" } });
  const out = await waitFactoryJob("https://s", "k", res(202), { job_id: "j2" }, opts(f));
  ok("error → 종전 409 그대로(상록수 스킵 분기 유지)", out?.status === 409 && out.json.error.includes("이미 생성된 시드"));
}
{
  const { f } = seq({ status: "error", error: "러너: 워커 출력 없음" });
  const out = await waitFactoryJob("https://s", "k", res(202), { job_id: "j3" }, opts(f));
  ok("result 없는 error → 500 + 사유", out?.status === 500 && out.json.error.includes("워커 출력 없음"));
}
{
  const { f } = seq({ status: "queued" });
  const out = await waitFactoryJob("https://s", "k", res(202), { job_id: "j4" }, opts(f, 20));
  ok("계속 queued → 503 PC 꺼짐·대기열에 남음", out?.status === 503 && out.json.queued === true && out.json.error.includes("PC 꺼짐"));
}

if (fail) {
  console.error(`실패 ${fail}건`);
  process.exit(1);
}
console.log("factory-job 시험 통과");
