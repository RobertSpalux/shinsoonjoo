/**
 * AI 작업 1건 실행 — scripts/ai_job_runner.py 가 부른다(직접 쓰지 않는다). API2 2026-10-15.
 *
 *   npx tsx scripts/ai_job_worker.mts <job.json>
 *   입력: {id, kind: "kin_draft" | "factory_generate", payload}
 *   출력(stdout 마지막 줄): {status, body}  — 종전 route 의 HTTP 상태·응답 본문 그대로
 *
 * 생성: `claude -p`(구독) — kin_draft.mts·draft_weekly.py 와 같은 방식.
 *   · 환경에 ANTHROPIC_API_KEY 등이 보이면 생성하지 않는다(구독 실행이 유료로 청구될 수 있다). 값은 출력하지 않는다.
 *   · .env.local 을 읽지 않는다 — 러너가 Supabase·텔레그램 변수만 골라 넘긴다(API 키는 넘기지 않는다).
 *   · `claude` 자식 환경에서는 그 Supabase·텔레그램 비밀도 뺀다(생성 세션에 쓸 일이 없다).
 *   · 프로젝트 밖 임시 폴더에서 돌린다 — 저장소 CLAUDE.md(중계함·/loop 지시)가 생성 세션에 섞이지 않게.
 *   모델: AI_JOB_CLAUDE_MODEL 이 있으면 --model 로 넘기고, 없으면 구독 기본 모델.
 * 생성 본체(검증·게이트·DB 적재)는 src/lib/ai-job-kin.ts · src/lib/factory-pipeline.ts — 종전 route 와 같은 코드다.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv, parseCliResult, visibleApiEnv } from "./kin_draft.mts";
import { runKinDraft, type KinJobPayload, type JobOutcome, type TextGenerator } from "../src/lib/ai-job-kin";
import { runFactory, type FactoryRequest, type StageGenerator } from "../src/lib/factory-pipeline";

const CLAUDE_EXE = process.env.CLAUDE_EXE ?? join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
const CLAUDE_TIMEOUT_MS = 20 * 60 * 1000;
/** 러너가 워커에 넘기는 비밀 — `claude` 자식에게는 넘기지 않는다 */
export const WORKER_SECRET_KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const;

export type Job = { id: string; kind: string; payload: unknown };

/** `claude` 자식 환경 — API 키·중첩 실행 표지(kin_draft childEnv) + 워커 비밀 제거 */
export function claudeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const base = childEnv(env);
  for (const k of WORKER_SECRET_KEYS) delete base[k];
  return base;
}

/** `claude -p` 1회. exe·preArgs 는 시험(가짜 claude)용 */
export function runClaude(
  prompt: string,
  cwd: string,
  { exe = CLAUDE_EXE, preArgs = [] as string[], timeoutMs = CLAUDE_TIMEOUT_MS, env = claudeEnv() } = {}
): Promise<{ text?: string; error?: string }> {
  const argv = [...preArgs, "-p", "--output-format", "json", "--permission-mode", "default"];
  if (process.env.AI_JOB_CLAUDE_MODEL) argv.push("--model", process.env.AI_JOB_CLAUDE_MODEL);
  return new Promise((resolve) => {
    const p = spawn(exe, argv, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.setEncoding("utf-8").on("data", (d) => (out += d));
    p.stderr.setEncoding("utf-8").on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(timer);
      resolve({ error: `claude 실행 실패: ${e.name}` });
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve(parseCliResult(out, code, err));
    });
    p.stdin.end(prompt, "utf-8");
  });
}

/** 단계 프롬프트 — 종전 system + user 그대로 + 출력 스키마(API 의 json_schema 강제를 지시로 대신한다) */
export function buildStagePrompt(system: string, user: string, schema: unknown): string {
  return [
    system,
    "",
    "──────────",
    user,
    "",
    "──────────",
    "출력 형식: 아래 JSON Schema 에 맞는 JSON 객체 하나만 출력한다(코드펜스·머리말·설명 금지).",
    "파일을 읽거나 쓰지 말고 도구도 쓰지 마라.",
    JSON.stringify(schema),
  ].join("\n");
}

/** 모델 출력 → JSON 객체(코드펜스·앞뒤 설명이 섞여도 첫 { ~ 끝 } 를 읽는다) */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    const v = JSON.parse(text.slice(s, e + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** 스키마 required 중 빠진 필드 */
export function missingRequired(data: Record<string, unknown>, schema: unknown): string[] {
  const req = (schema as { required?: unknown })?.required;
  return Array.isArray(req) ? req.filter((k) => typeof k === "string" && !(k in data)) : [];
}

export function makeTextGenerator(call: (prompt: string) => Promise<{ text?: string; error?: string }>): TextGenerator {
  return (prompt) => call(prompt);
}

export function makeStageGenerator(call: (prompt: string) => Promise<{ text?: string; error?: string }>): StageGenerator {
  return async ({ label, system, schema, user }) => {
    const r = await call(buildStagePrompt(system, user, schema));
    if (!r.text) return { error: { status: 502, message: `${label}: ${r.error ?? "빈 응답"}` } };
    const data = extractJsonObject(r.text);
    if (!data) return { error: { status: 502, message: `${label}: 출력이 JSON 이 아닙니다` } };
    const miss = missingRequired(data, schema);
    if (miss.length) return { error: { status: 502, message: `${label}: 필수 필드 누락(${miss.join(", ")})` } };
    return { data };
  };
}

/** 작업 1건 → 종전 route 와 같은 {status, body} */
export async function runJob(
  job: Job,
  call: (prompt: string) => Promise<{ text?: string; error?: string }>,
  db?: Parameters<typeof runKinDraft>[2]
): Promise<JobOutcome> {
  if (job.kind === "kin_draft") return runKinDraft(job.payload as KinJobPayload, makeTextGenerator(call), db);
  if (job.kind === "factory_generate") return runFactory(job.payload as FactoryRequest, makeStageGenerator(call), db);
  return { status: 400, body: { error: `모르는 작업 종류: ${job.kind}` } };
}

/** 생성하면 안 되는 사유(유료 API 변수가 보이거나 claude 가 없음) — 없으면 빈 문자열 */
export function stopReason(env: NodeJS.ProcessEnv = process.env, exe = CLAUDE_EXE): string {
  const seen = visibleApiEnv(env);
  if (seen.length) return `환경에 ${seen.join(" · ")} 가 보인다 — 구독 실행이 유료로 청구될 수 있어 생성하지 않는다`;
  if (!existsSync(exe)) return `claude 실행 파일이 없다: ${exe}`;
  return "";
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("사용법: npx tsx scripts/ai_job_worker.mts <job.json>");
    process.exit(2);
  }
  const job = JSON.parse(readFileSync(file, "utf-8")) as Job;
  const stop = stopReason();
  if (stop) {
    console.error(stop);
    // stop:true — 이 PC 의 실행 조건 문제다(작업 탓이 아님). 러너가 작업을 대기열로 되돌린다.
    process.stdout.write(JSON.stringify({ status: 503, body: { error: stop }, stop: true }) + "\n");
    process.exit(1);
  }
  const cwd = join(tmpdir(), "shin_ai_job");
  mkdirSync(cwd, { recursive: true });
  const out = await runJob(job, (prompt) => runClaude(prompt, cwd));
  process.stdout.write(JSON.stringify(out) + "\n");
}

// 시험(ai_job_worker.test.mts)이 import 할 때는 실행하지 않는다
if (/ai_job_worker\.mts$/.test(process.argv[1] ?? "")) {
  await main();
}
