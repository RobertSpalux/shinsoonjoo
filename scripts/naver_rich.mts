/**
 * 네이버 서식 HTML 을 파일로 — publish_approved 가 게시본 .html 을 만들 때 부른다.
 *
 *   npx tsx scripts/naver_rich.mts <본문.txt> [사진1 사진2 사진3]   → stdout HTML
 *
 * 본문은 반드시 /api/admin/compose 가 조립한 toNaverText 출력(개인의견 문구·필수안내 포함)이다.
 * 사진 인자는 <img src> 에 그대로 들어간다 — 같은 폴더의 파일명을 주면 브라우저에서 바로 보인다.
 * 서식 규격: configs/naver-format.json (src/lib/naver-rich.ts 가 읽는다).
 */
import { readFileSync } from "node:fs";
import { toNaverRichHtml } from "../src/lib/naver-rich";

const [file, ...images] = process.argv.slice(2);
if (!file) {
  console.error("사용법: npx tsx scripts/naver_rich.mts <본문.txt> [사진…]");
  process.exit(2);
}
const text = readFileSync(file, "utf-8");
process.stdout.write(toNaverRichHtml(text, { images }));
