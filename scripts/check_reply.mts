/**
 * 스레드 답글 게이트 CLI — robert-os 가 부른다.
 *
 *   npx tsx scripts/check_reply.mts "<답글>" --comment "<댓글 원문>"
 *   → stdout JSON {"pass":bool,"findings":[{rule,term,reason}]} · 통과 0 / 막힘 1 / 사용법 오류 2
 *   npx tsx scripts/check_reply.mts --batch <파일.json>   ([{reply, comment}] → JSON 배열)
 *
 * 규칙: docs/THREADS-REPLY-RULES.md §3, 구현: src/lib/compliance/reply-terms.ts
 */
import { checkReplyTerms } from "../src/lib/compliance/reply-terms";

const args = process.argv.slice(2);
let comment = "";
let batch = "";
const rest: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--comment") comment = args[++i] ?? "";
  else if (args[i] === "--batch") batch = args[++i] ?? "";
  else rest.push(args[i]);
}
// 여러 건 — `--batch <파일.json>` ([{reply, comment}]) → stdout JSON 배열. 한 건이라도 막히면 exit 1.
if (batch) {
  const { readFileSync } = await import("node:fs");
  const items = JSON.parse(readFileSync(batch, "utf-8")) as { reply: string; comment?: string }[];
  const out = items.map((it) => checkReplyTerms(it.reply, it.comment ?? ""));
  process.stdout.write(JSON.stringify(out) + "\n");
  process.exit(out.every((r) => r.pass) ? 0 : 1);
}
if (rest.length !== 1) {
  console.error('사용법: npx tsx scripts/check_reply.mts "<답글>" --comment "<댓글>"');
  process.exit(2);
}
const r = checkReplyTerms(rest[0], comment);
process.stdout.write(JSON.stringify(r, null, 0) + "\n");
process.exit(r.pass ? 0 : 1);
