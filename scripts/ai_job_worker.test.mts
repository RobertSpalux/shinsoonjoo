/**
 * API2 시험 — npx tsx scripts/ai_job_worker.test.mts (네트워크·DB·진짜 claude 없음)
 * ① 두 route 가 Anthropic SDK 를 import 하지 않는다 ② 가짜 claude 로 워커 생성 경로(spawn·stdin·파싱)
 * ③ 가짜 DB 로 지식iN·팩토리 본체가 종전과 같은 행을 적재한다.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStagePrompt,
  claudeEnv,
  extractJsonObject,
  missingRequired,
  runClaude,
  runJob,
  stopReason,
} from "./ai_job_worker.mts";
import { parseKinPayload } from "../src/lib/ai-job-kin";
import { parseFactoryRequest } from "../src/lib/factory-pipeline";

let fail = 0;
function ok(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) fail++;
}

// ── ① route 에 SDK 없음 ─────────────────────────────────────
const ROUTES = [
  "src/app/api/admin/kin/route.ts",
  "src/app/api/factory/generate/route.ts",
  "src/app/api/admin/ai-jobs/[id]/route.ts",
  "src/app/api/factory/jobs/[id]/route.ts",
];
for (const r of ROUTES) {
  const src = readFileSync(r, "utf-8");
  ok(`${r} — @anthropic-ai/sdk import 없음`, !src.includes("@anthropic-ai/sdk"));
  ok(`${r} — ANTHROPIC_API_KEY 언급 없음`, !src.includes("ANTHROPIC_API_KEY"));
}
for (const lib of ["src/lib/ai-job-kin.ts", "src/lib/factory-pipeline.ts", "src/lib/ai-jobs.ts"]) {
  ok(`${lib} — @anthropic-ai/sdk import 없음`, !readFileSync(lib, "utf-8").includes("@anthropic-ai/sdk"));
}

// ── 입력 검사(종전 route 와 같은 400) ─────────────────────────
ok("kin: 빈 본문 → 오류", "error" in parseKinPayload({ question_url: "u", question_title: "t", question_body: " " }));
const kp = parseKinPayload({ question_url: " u ", question_title: "t", question_body: "b", linked_article_url: "" });
ok("kin: 다듬고 빈 선택값은 뺀다", "payload" in kp && kp.payload.question_url === "u" && !("linked_article_url" in kp.payload));
ok("factory: mode 오류 400", (parseFactoryRequest({ mode: "x", content: "c" }) as { status?: number }).status === 400);
ok("factory: content 없음 400", (parseFactoryRequest({ content: "" }) as { status?: number }).status === 400);
ok("factory: 상록수 seed 없음 400", (parseFactoryRequest({ mode: "evergreen", content: "c" }) as { status?: number }).status === 400);
const fr = parseFactoryRequest({ mode: "evergreen", content: "c", seed: { key: " k ", title: "t", intent: "전환" } });
ok("factory: 시드 정규화", "request" in fr && fr.request.seed?.key === "k" && fr.request.seed?.intent === "전환" && fr.request.seed?.isHub === false);
ok("factory: mode 기본 news", "request" in parseFactoryRequest({ content: "c" }) && (parseFactoryRequest({ content: "c" }) as { request: { mode: string } }).request.mode === "news");

// ── 출력 파싱 ─────────────────────────────────────────────
ok("JSON: 코드펜스 섞여도 읽는다", extractJsonObject('설명\n```json\n{"a":1}\n```')?.a === 1);
ok("JSON: 아니면 null", extractJsonObject("본문뿐") === null);
ok("JSON: 배열은 null", extractJsonObject("[1]") === null);
ok("required 누락", JSON.stringify(missingRequired({ a: 1 }, { required: ["a", "b"] })) === '["b"]');
const sp = buildStagePrompt("SYS", "USER", { required: ["x"] });
ok("단계 프롬프트: system 맨 앞 · 스키마 맨 끝", sp.startsWith("SYS\n") && sp.trimEnd().endsWith('{"required":["x"]}'));

// ── 유료 API 차단 ──────────────────────────────────────────
ok("API 키 보이면 멈춤", stopReason({ ANTHROPIC_API_KEY: "sk" }, process.execPath).includes("ANTHROPIC_API_KEY"));
ok("claude 없으면 멈춤", stopReason({}, join(tmpdir(), "없는-claude.exe")).includes("claude 실행 파일이 없다"));
ok("조건 맞으면 빈 사유", stopReason({}, process.execPath) === "");
const ce = claudeEnv({ ANTHROPIC_API_KEY: "k", SUPABASE_SERVICE_ROLE_KEY: "s", TELEGRAM_BOT_TOKEN: "t", CLAUDECODE: "1", PATH: "p" });
ok("claude 자식 환경: API 키·DB 비밀·중첩 표지 제거", JSON.stringify(ce) === '{"PATH":"p"}');

// ── ② 가짜 claude ─────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "shin_api2_test_"));
const fake = join(dir, "fake_claude.mjs");
writeFileSync(
  fake,
  `let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
    const mode=process.env.FAKE_MODE||"text";
    if(mode==="fail"){process.stdout.write(JSON.stringify({type:"result",is_error:true,result:"Credit balance is too low"}));return;}
    const secret=process.env.SUPABASE_SERVICE_ROLE_KEY?"비밀보임":"비밀없음";
    process.stdout.write(JSON.stringify({type:"result",is_error:false,result:"가짜 초안입니다. "+secret+" argv="+process.argv.slice(2).join(" ")+" len="+s.length}));
  });`,
  "utf-8"
);
const fakeOpts = (mode = "text") => ({
  exe: process.execPath,
  preArgs: [fake],
  env: claudeEnv({ ...process.env, SUPABASE_SERVICE_ROLE_KEY: "s", FAKE_MODE: mode }),
});
const r1 = await runClaude("프롬프트".repeat(100), dir, fakeOpts());
ok("가짜 claude: 결과 본문", !!r1.text?.startsWith("가짜 초안입니다."));
ok("가짜 claude: -p · json 출력 인자", !!r1.text?.includes("-p --output-format json"));
ok("가짜 claude: 프롬프트는 stdin 으로", !!r1.text?.includes("len=400"));
ok("가짜 claude: DB 비밀이 자식에 안 보임", !!r1.text?.includes("비밀없음"));
const r2 = await runClaude("p", dir, fakeOpts("fail"));
ok("가짜 claude: is_error → 오류", !!r2.error?.includes("Credit balance"));

// ── ③ 가짜 DB ─────────────────────────────────────────────
type Op = { table: string; op: string; row?: Record<string, unknown> };
function fakeDb(seed: Record<string, Record<string, unknown>[]> = {}) {
  const ops: Op[] = [];
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let row: Record<string, unknown> | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: (k: string, v: unknown) => (filters.push([k, v]), b),
        insert: (r: Record<string, unknown>) => ((row = r), ops.push({ table, op: "insert", row: r }), b),
        upsert: (r: Record<string, unknown>) => (ops.push({ table, op: "upsert", row: r }), b),
        maybeSingle: () =>
          Promise.resolve({
            data: (seed[table] ?? []).find((x) => filters.every(([k, v]) => x[k] === v)) ?? null,
            error: null,
          }),
        single: () => Promise.resolve({ data: { id: "new-id", status: "초안", ...row }, error: null }),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(res, rej),
      };
      return b;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, ops };
}

// 지식iN — 가짜 claude 로 끝까지(워커 → 본체 → kin_answers)
{
  const { db, ops } = fakeDb({ premium_articles: [{ id: "a1", title: "본진 제목", naver_title: "네이버 제목", summary: "요약", key_points: ["핵심"] }] });
  const out = await runJob(
    { id: "j1", kind: "kin_draft", payload: { question_url: "https://kin.naver.com/q", question_title: "실비 질문", question_body: "본문", linked_article_id: "a1" } },
    (prompt) => runClaude(prompt, dir, fakeOpts()),
    db
  );
  const ins = ops.find((o) => o.table === "kin_answers" && o.op === "insert");
  ok("kin: 200 + 행 돌려줌", out.status === 200 && (out.body.answer as { id?: string })?.id === "new-id");
  ok("kin: kin_answers 에 초안 적재", !!String(ins?.row?.answer_draft ?? "").startsWith("가짜 초안입니다.") && ins?.row?.linked_article_id === "a1");
}
{
  const { db } = fakeDb();
  const out = await runJob(
    { id: "j2", kind: "kin_draft", payload: { question_url: "u", question_title: "t", question_body: "b", linked_article_id: "없음" } },
    async () => ({ text: "x" }),
    db
  );
  ok("kin: 연결 글 없음 → 400(종전과 같음)", out.status === 400);
}
{
  const { db, ops } = fakeDb();
  const out = await runJob(
    { id: "j3", kind: "kin_draft", payload: { question_url: "u", question_title: "t", question_body: "b" } },
    (prompt) => runClaude(prompt, dir, fakeOpts("fail")),
    db
  );
  ok("kin: 생성 실패 → 502 · 적재 없음", out.status === 502 && !ops.some((o) => o.op === "insert"));
}
{
  const out = await runJob({ id: "j4", kind: "nope", payload: {} }, async () => ({ text: "x" }), fakeDb().db);
  ok("모르는 작업 → 400", out.status === 400);
}

// 팩토리 — 가짜 생성기가 스키마 required 를 채운 JSON 을 낸다
const SENT = "상담하다 보면 여러 계약에 흩어진 담보를 한 줄로 합산해 보시는 분이 많습니다. ";
const md = Array.from({ length: 5 }, (_, i) => `## 소제목 ${i + 1}\n\n${SENT.repeat(12)}`).join("\n\n");
function fakeStageText(prompt: string): string {
  const schema = JSON.parse(prompt.trimEnd().split("\n").pop() ?? "{}");
  const req: string[] = schema.required ?? [];
  if (req.includes("main_website_markdown")) {
    return JSON.stringify({
      title: "담보 합산으로 보는 보장 공백",
      naver_title: "담보 합산으로 보는 보장 공백",
      blogspot_title: "담보 합산으로 보는 보장 공백",
      slug: "coverage-sum-gap",
      category: "보험 리모델링",
      summary: "담보를 합산하면 보장의 실제 크기가 보입니다.",
      tags: ["담보", "합산"],
      key_points: ["담보 단위 합산"],
      remodeling_bridge: SENT,
      main_website_markdown: md,
      faq_json: [{ question: "합산은 왜 필요한가요?", answer: SENT }],
      ...(req.includes("verify_claims") ? { verify_claims: [] } : {}),
    });
  }
  return "```json\n" + JSON.stringify({ naver_blog_content: SENT, blogspot_content: SENT, instagram_caption: SENT }) + "\n```";
}
{
  const { db, ops } = fakeDb();
  const prompts: string[] = [];
  const out = await runJob(
    { id: "f1", kind: "factory_generate", payload: { mode: "news", content: "원천 자료", source_url: "https://fss.or.kr/x", source_name: "금융감독원" } },
    async (p) => (prompts.push(p), { text: fakeStageText(p) }),
    db
  );
  const ins = ops.find((o) => o.table === "premium_articles" && o.op === "insert");
  ok("factory: 200 + article", out.status === 200 && (out.body.article as { slug?: string })?.slug === "coverage-sum-gap");
  ok("factory: 초안으로만 적재(is_main_published=false)", ins?.row?.is_main_published === false);
  ok("factory: 1·2차 병합 적재", ins?.row?.naver_blog_content === SENT && ins?.row?.main_website_markdown === md);
  ok("factory: 원천 URL 기록", ins?.row?.raw_source_url === "https://fss.or.kr/x");
  ok("factory: 응답 모양 종전 그대로(usage·timing)", !!out.body.usage && !!out.body.timing);
  ok("factory: 2단계 호출(재생성 없으면 2회)", prompts.length === 2);
}
{
  const { db } = fakeDb({ premium_articles: [{ id: "x", slug: "s", seed_key: "k1" }] });
  const out = await runJob(
    { id: "f2", kind: "factory_generate", payload: { mode: "evergreen", content: "c", seed: { key: "k1", title: "t", category: "", intent: "유입", keywords: [], sources: [] } } },
    async () => ({ text: "{}" }),
    db
  );
  ok("factory: 대기 중 생긴 시드 중복 → 409", out.status === 409);
}
{
  const { db, ops } = fakeDb();
  const out = await runJob(
    { id: "f3", kind: "factory_generate", payload: { mode: "news", content: "c" } },
    async () => ({ text: '{"title":"반쪽"}' }),
    db
  );
  ok("factory: 필수 필드 누락 → 502 · 적재 없음", out.status === 502 && !ops.some((o) => o.op === "insert"));
}

if (fail) {
  console.error(`실패 ${fail}건`);
  process.exit(1);
}
console.log("ai_job_worker 시험 통과");
