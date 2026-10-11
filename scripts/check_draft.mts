/**
 * 초안 게이트 CLI — 금지어·문체·근거 게이트를 로컬 초안 파일에 건다(규칙: src/lib/draft-gate.ts).
 * 구독 세션 생성 → 결재방 미리보기 사이에 쓴다(SH10). DB·텔레그램·배포 사이트를 부르지 않는다.
 *
 *   npx tsx scripts/check_draft.mts <meta.json> <naver.txt> [main.md]
 *   통과 0 / 막힘 1 / 사용법 오류 2   — 결과 JSON 을 stdout 에 쓴다(결재방 미리보기용).
 */
import { readFileSync } from "node:fs";
import { judgeDraft } from "../src/lib/draft-gate";

const [metaPath, naverPath, mainPath] = process.argv.slice(2);
if (!metaPath || !naverPath) {
  console.error("사용법: npx tsx scripts/check_draft.mts <meta.json> <naver.txt> [main.md]");
  process.exit(2);
}
const out = judgeDraft(
  JSON.parse(readFileSync(metaPath, "utf-8")),
  readFileSync(naverPath, "utf-8"),
  mainPath ? readFileSync(mainPath, "utf-8") : null,
);
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
process.exit(out.pass ? 0 : 1);
