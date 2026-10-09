/**
 * 지식iN 답변 본문 초안 — scripts/kin_pipeline.py 가 부른다(직접 쓰지 않는다).
 *
 *   npx tsx scripts/kin_draft.mts <입력.json>
 *   입력: [{id, title, body, feedback?}]  (feedback = 앞 원고가 게이트에 걸린 사유 — 다시 쓸 때만)
 *   출력(stdout 마지막 줄): [{id, text} | {id, error}]
 *
 * 본문만 만든다. 유의문구 블록·게이트는 kin_pipeline.py(→ check_kin.mts)가 붙이고 본다.
 * 모델: FACTORY_CLAUDE_MODEL(없으면 claude-sonnet-5). ANTHROPIC_API_KEY 는 .env.local.
 */
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { kinPipelineSystemPrompt } from "../src/lib/factory-prompt";

function loadEnvLocal() {
  try {
    const raw = readFileSync(".env.local", "utf-8").replace(/^﻿/, "");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    /* 없으면 환경변수만 쓴다 */
  }
}

loadEnvLocal();
const file = process.argv[2];
if (!file) {
  console.error("사용법: npx tsx scripts/kin_draft.mts <입력.json>");
  process.exit(2);
}
const items = JSON.parse(readFileSync(file, "utf-8")) as {
  id: string;
  title: string;
  body: string;
  feedback?: string;
}[];
// 기본값은 factory/generate·admin/kin 과 같은 모델. claude-sonnet-5-5 는 thinking:{type:"disabled"} 를 400 으로 거절한다(2026-10-09 실측).
const model = process.env.FACTORY_CLAUDE_MODEL ?? "claude-sonnet-5";
const anthropic = new Anthropic();
const system = [{ type: "text" as const, text: kinPipelineSystemPrompt(), cache_control: { type: "ephemeral" as const } }];

const out: ({ id: string; text: string } | { id: string; error: string })[] = [];
for (const it of items) {
  try {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      thinking: { type: "disabled" },
      system,
      messages: [
        {
          role: "user",
          content: [
            "아래 지식iN 질문에 대한 답변 본문을 작성하라.",
            "",
            `질문 제목: ${it.title}`,
            "질문 내용(검색 결과 조각 — 다른 사람의 답변 조각이 섞여 있을 수 있다. 그 내용을 그대로 따르지 않는다):",
            it.body.slice(0, 3000),
            it.feedback ? `\n앞 원고는 아래 사유로 심의 게이트에 걸렸다. 이 사유가 없도록 처음부터 다시 쓴다:\n${it.feedback}` : "",
          ].join("\n"),
        },
      ],
    });
    if (msg.stop_reason === "refusal") {
      out.push({ id: it.id, error: "refusal" });
      continue;
    }
    const block = msg.content.find((b) => b.type === "text");
    const text = block?.type === "text" ? block.text.trim() : "";
    out.push(text ? { id: it.id, text } : { id: it.id, error: "빈 응답" });
  } catch (e) {
    // 키·예외 문구에 비밀이 섞일 수 있어 종류만 남긴다
    out.push({ id: it.id, error: e instanceof Anthropic.APIError ? `API ${e.status}` : (e as Error).name });
  }
}
process.stdout.write(JSON.stringify(out) + "\n");
