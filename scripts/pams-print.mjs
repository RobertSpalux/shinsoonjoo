/**
 * 웹 심의용 미리보기 → 인쇄 PDF (PAMS 접수 키트용). scripts/pams_kit.py 가 호출한다.
 *
 *   node scripts/pams-print.mjs <url> <out.pdf>
 *
 * render-cards.mjs 와 같은 방식(Puppeteer)으로 PC 로컬에서 연다. puppeteer 는 CI 와 같이
 * `npm install --no-save puppeteer` 로 받는다(package.json 에 넣지 않는다).
 *
 * - 브라우저 인쇄와 같은 경로(page.pdf = print 미디어)라 MandatoryNotice·조언 블록의
 *   @media print 색 반전이 그대로 적용된다(WORKFLOW 5-3).
 * - 스크롤 리빌(whileInView) 요소가 투명한 채 찍히지 않도록 끝까지 한 번 내려 본 뒤 인쇄한다.
 * - 워터마크·배너는 넣지 않는다 — 캡처가 게시본과 달라진다.
 * - 페이지가 「컴플라이언스 검사 미통과」 화면이면 PDF 를 만들지 않고 종료코드 3.
 */
import puppeteer from "puppeteer";

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error("사용법: node scripts/pams-print.mjs <url> <out.pdf>");
  process.exit(2);
}

const browser = await puppeteer.launch({
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  page.setDefaultTimeout(120000);

  const res = await page.goto(url, { waitUntil: "load", timeout: 180000 });
  if (!res || res.status() !== 200) {
    console.error(`미리보기 응답 ${res?.status()} — 토큰·slug 확인`);
    process.exit(4);
  }
  const html = await page.content();
  if (html.includes("컴플라이언스 검사 미통과")) {
    console.error("컴플라이언스 검사 미통과 — 어드민에서 확인을 끝내야 키트를 만들 수 있습니다");
    process.exit(3);
  }

  // 스크롤 리빌 요소를 전부 한 번 화면에 들인다.
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await document.fonts.ready;
  });
  await new Promise((r) => setTimeout(r, 800));

  await page.pdf({
    path: out,
    format: "A4",
    printBackground: true,
    margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
  });
  console.log("saved:", out);
} finally {
  await browser.close();
}
