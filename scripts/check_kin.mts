/**
 * 지식iN 답변 게이트 CLI — scripts/kin_pipeline.py 가 부른다.
 *
 *   npx tsx scripts/check_kin.mts --batch <파일.json>   ([{answer, question}] → stdout JSON 배열)
 *   npx tsx scripts/check_kin.mts --notice <파일.json>  ([{body, question}] → 유의문구 블록 배열)
 *   통과 0 / 막힘 1 / 사용법 오류 2
 *
 * 규칙: src/lib/compliance/kin-terms.ts
 */
import { readFileSync } from "node:fs";
import { checkKinAnswer, kinNoticeBlock } from "../src/lib/compliance/kin-terms";

const [flag, file] = process.argv.slice(2);
if (!file || (flag !== "--batch" && flag !== "--notice")) {
  console.error("사용법: npx tsx scripts/check_kin.mts --batch|--notice <파일.json>");
  process.exit(2);
}
if (flag === "--notice") {
  const items = JSON.parse(readFileSync(file, "utf-8")) as { body: string; question?: string }[];
  process.stdout.write(JSON.stringify(items.map((it) => kinNoticeBlock(it.body, it.question ?? ""))) + "\n");
  process.exit(0);
}
const items = JSON.parse(readFileSync(file, "utf-8")) as { answer: string; question?: string }[];
const out = items.map((it) => checkKinAnswer(it.answer, it.question ?? ""));
process.stdout.write(JSON.stringify(out) + "\n");
process.exit(out.every((r) => r.pass) ? 0 : 1);
