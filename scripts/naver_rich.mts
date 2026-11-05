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
import { toNaverRichHtml, trackedCtaUrl } from "../src/lib/naver-rich";
import NAVER_FORMAT from "../configs/naver-format.json";

// KC1 — --cta-url=<주소>: 마지막 사진(CTA 카드) 링크. 없으면 종전(진단 페이지) 그대로.
// FN2 — --track-slug=<slug>: 진단 링크에 ?ref=<slug>&utm_… 를 붙인다(새 원고만).
const argv = process.argv.slice(2);
const ctaArg = argv.find((a) => a.startsWith("--cta-url="));
const trackArg = argv.find((a) => a.startsWith("--track-slug="));
const [file, ...images] = argv.filter((a) => a !== ctaArg && a !== trackArg);
if (!file) {
  console.error("사용법: npx tsx scripts/naver_rich.mts <본문.txt> [사진…] [--cta-url=<주소>]");
  process.exit(2);
}
const text = readFileSync(file, "utf-8");
let ctaUrl = ctaArg?.slice("--cta-url=".length);
if (trackArg) ctaUrl = trackedCtaUrl(ctaUrl ?? NAVER_FORMAT.cta_url, trackArg.slice("--track-slug=".length));
process.stdout.write(toNaverRichHtml(text, { images, ctaUrl }));
