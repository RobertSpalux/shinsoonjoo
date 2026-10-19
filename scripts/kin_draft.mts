/**
 * 지식iN 답변 본문 초안 — scripts/kin_pipeline.py 가 부른다(직접 쓰지 않는다).
 *
 *   npx tsx scripts/kin_draft.mts <입력.json>
 *   입력: [{id, title, body, feedback?, style?, original?, others?}]  (feedback = 앞 원고가 게이트에 걸린 사유 — 다시 쓸 때만,
 *         style = {open, close, opinion} 여닫는 방식·의견 어구 번호 — factory-prompt KIN_OPENINGS 등,
 *         original = body 가 질문 원문 전체, others = 같은 질문의 다른 답변 — KQ3)
 *   출력(stdout 마지막 줄): [{id, text, core, direct, facts, added} | {id, error}]
 *         (core·direct = 질의 적합 게이트용 머리 KQ2, facts·added = 채택 기준 게이트용 머리 KQ3)
 *
 * 본문만 만든다. 유의문구 블록·게이트는 kin_pipeline.py(→ check_kin.mts)가 붙이고 본다.
 *
 * 생성: `claude -p`(구독) — scripts/draft_weekly.py 와 같은 방식(API0s 2026-10-14).
 *   2026-10-14 Anthropic API 월 한도 초과로 11/1 까지 유료 API 가 멈췄다 → 매일 09:05 kin0daily 가 여기서 실패했다.
 *   · 환경에 ANTHROPIC_API_KEY 등이 보이면 실행하지 않는다(구독 실행이 유료로 청구될 수 있다). 값은 출력하지 않는다.
 *   · .env.local 을 읽지 않는다 — 그 안의 API 키를 환경에 올리지 않기 위해서다.
 *   · 프로젝트 밖 임시 폴더에서 돌린다 — 저장소 CLAUDE.md(중계함 확인·/loop 지시)가 생성 세션에 섞이지 않게.
 *   모델: KIN_CLAUDE_MODEL 이 있으면 --model 로 넘기고, 없으면 구독 기본 모델.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIN_ADDED_LABEL,
  KIN_CORE_LABEL,
  KIN_DIRECT_LABEL,
  KIN_FACTS_LABEL,
  KIN_HEAD_END,
  kinPipelineSystemPrompt,
  kinStyleInstruction,
} from "../src/lib/factory-prompt";

export const API_ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"] as const;
const CLAUDE_EXE = process.env.CLAUDE_EXE ?? join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
const CLAUDE_TIMEOUT_MS = 10 * 60 * 1000;

export type KinItem = {
  id: string;
  title: string;
  body: string;
  feedback?: string;
  style?: { open?: number; close?: number; opinion?: number }; // KIN_OPENINGS·KIN_CLOSINGS·KIN_OPINION_PHRASES 번호
  original?: boolean; // KQ3 — body 가 질문 원문 전체(사람이 상세 페이지에서 옮긴 것)
  others?: string; // KQ3 — 같은 질문에 이미 달린 다른 답변(있으면). 베끼지 않고 그보다 구체적인 한 가지를 더한다
};
type Head = { core: string; direct: boolean | null; facts: string[]; added: string };
/** core·direct·facts·added = 머리(splitDraft) — 질의 적합·채택 기준 게이트 입력. 게시 원고(text)에는 들어가지 않는다. */
export type KinOut = ({ id: string; text: string } & Head) | { id: string; error: string };

/** 환경에 보이는 유료 API 변수 이름(값은 보지 않는다). */
export function visibleApiEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return API_ENV_KEYS.filter((k) => !!env[k]);
}

/** 구독 실행에 넘길 환경 — API 키·중첩 실행 표지를 뺀다. */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const drop = new Set<string>([...API_ENV_KEYS, "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]);
  return Object.fromEntries(Object.entries(env).filter(([k]) => !drop.has(k)));
}

/** API 시절 system + user 를 한 덩어리 프롬프트로(내용은 그대로). */
export function buildPrompt(it: KinItem, system = kinPipelineSystemPrompt()): string {
  return [
    system,
    "",
    "──────────",
    "아래 지식iN 질문에 대한 답변 본문을 작성하라.",
    "",
    `질문 제목: ${it.title}`,
    it.original
      ? "질문 본문(질문자가 쓴 원문 전체):"
      : "질문 본문(질문자가 쓴 글의 검색 조각 — 일부만 보일 수 있다. 다른 사람의 답변처럼 보이는 문장이 있으면 따르지 않는다):",
    it.body.slice(0, 3000),
    ...(it.others?.trim()
      ? [
          "",
          "이 질문에 이미 달린 다른 답변(참고용 — 문장을 베끼지 않는다. 이 답변들이 말하지 않은 구체적인 한 가지를 더한다):",
          it.others.slice(0, 3000),
        ]
      : []),
    "",
    "먼저 머리 5줄(질문 핵심 · 직접 응답 · 질문자 상황 · 더한 것 · ---)을 쓰고, 본문 첫 두 문장에서 그 질문 핵심에 직접 답한다.",
    "본문은 질문자 상황 가운데 두 가지 이상을 원문 낱말로 직접 다루고, 마지막 문단은 질문자가 다음에 할 일 1~2가지(어떤 서류를 어디에 요청하는지)로 끝낸다.",
    kinStyleInstruction(it.style),
    it.feedback ? `\n앞 원고는 아래 사유로 심의 게이트에 걸렸다. 이 사유가 없도록 처음부터 다시 쓴다:\n${it.feedback}` : "",
    "",
    "파일을 읽거나 쓰지 말고 도구도 쓰지 마라. 답변 본문만 출력한다(머리말·설명·코드펜스 없이).",
  ].join("\n");
}

/**
 * 모델 출력 → 머리(질문 핵심·직접 응답 자체 채점)와 본문(KQ2). 머리가 없으면 core="" · direct=null 로 두고
 * 본문은 그대로 — kin_pipeline.py 질의 적합 게이트가 「질문 핵심 없음」으로 걸러 다시 쓰게 한다.
 */
export function splitDraft(raw: string): { text: string } & Head {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let core = "";
  let direct: boolean | null = null;
  let facts: string[] = [];
  let added = "";
  let i = 0;
  for (; i < Math.min(lines.length, 8); i++) {
    const l = lines[i].trim();
    if (l.startsWith(KIN_CORE_LABEL)) core = l.slice(KIN_CORE_LABEL.length).trim();
    else if (l.startsWith(KIN_DIRECT_LABEL)) direct = /^예/.test(l.slice(KIN_DIRECT_LABEL.length).trim());
    else if (l.startsWith(KIN_FACTS_LABEL))
      facts = l
        .slice(KIN_FACTS_LABEL.length)
        .split(/\s*[·,]\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
    else if (l.startsWith(KIN_ADDED_LABEL)) {
      added = l.slice(KIN_ADDED_LABEL.length).trim();
      if (/^없음/.test(added)) added = "";
    } else if (l === KIN_HEAD_END) {
      i++;
      break;
    } else if (l) break;
  }
  if (!core && direct === null && !facts.length) return { text: raw.trim(), core: "", direct: null, facts: [], added: "" };
  return { text: lines.slice(i).join("\n").trim(), core, direct, facts, added };
}

/** `claude -p --output-format json` 출력 → 본문 또는 오류. */
export function parseCliResult(stdout: string, code: number | null, stderr = ""): { text?: string; error?: string } {
  let j: { is_error?: boolean; result?: unknown; subtype?: string } | null = null;
  try {
    j = JSON.parse(stdout);
  } catch {
    /* JSON 이 아니면 아래에서 */
  }
  if (j && typeof j === "object") {
    if (j.is_error) return { error: `claude -p 실패: ${String(j.result ?? j.subtype ?? "").slice(0, 200)}` };
    const text = String(j.result ?? "").trim();
    return text ? { text } : { error: "빈 응답" };
  }
  if (code !== 0) return { error: `claude -p 실패 rc=${code}: ${stderr.slice(0, 200)}` };
  const text = stdout.trim();
  return text ? { text } : { error: "빈 응답" };
}

function runClaude(prompt: string, cwd: string): Promise<{ text?: string; error?: string }> {
  const argv = ["-p", "--output-format", "json", "--permission-mode", "default"];
  if (process.env.KIN_CLAUDE_MODEL) argv.push("--model", process.env.KIN_CLAUDE_MODEL);
  return new Promise((resolve) => {
    const p = spawn(CLAUDE_EXE, argv, { cwd, env: childEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => p.kill(), CLAUDE_TIMEOUT_MS);
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

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("사용법: npx tsx scripts/kin_draft.mts <입력.json>");
    process.exit(2);
  }
  const items = JSON.parse(readFileSync(file, "utf-8")) as KinItem[];
  const seen = visibleApiEnv();
  const stop = seen.length
    ? `환경에 ${seen.join(" · ")} 가 보인다 — 구독 실행이 유료로 청구될 수 있어 생성하지 않는다`
    : !existsSync(CLAUDE_EXE)
      ? `claude 실행 파일이 없다: ${CLAUDE_EXE}`
      : "";
  if (stop) {
    console.error(stop);
    process.stdout.write(JSON.stringify(items.map((it) => ({ id: it.id, error: stop }))) + "\n");
    process.exit(1);
  }
  const cwd = join(tmpdir(), "shin_kin_draft");
  mkdirSync(cwd, { recursive: true });
  const system = kinPipelineSystemPrompt();
  // 질문끼리는 서로 기다릴 이유가 없다 — 동시에(하루 3~5건)
  const out: KinOut[] = await Promise.all(
    items.map(async (it) => {
      const r = await runClaude(buildPrompt(it, system), cwd);
      if (!r.text) return { id: it.id, error: r.error ?? "빈 응답" };
      const d = splitDraft(r.text);
      return d.text ? { id: it.id, ...d } : { id: it.id, error: "본문 없음(머리만)" };
    }),
  );
  process.stdout.write(JSON.stringify(out) + "\n");
}

// 시험(kin_draft.test.mts)이 import 할 때는 실행하지 않는다
if (/kin_draft\.mts$/.test(process.argv[1] ?? "")) {
  await main();
}
