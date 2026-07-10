/**
 * 카드뉴스 렌더러 — GitHub Actions에서 구동 (비용 제로).
 * premium_articles 중 carousel_json이 있고 image_paths가 비어있는 글을 찾아
 * 1080x1350 프리미엄 템플릿 HTML → Puppeteer 스냅샷 PNG → Supabase Storage 업로드
 * → image_paths / og_image_path 기록.
 *
 * 필요 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * 실행: node scripts/render-cards.mjs
 */
import puppeteer from "puppeteer";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Supabase 환경변수가 없습니다.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ⚠️ src/lib/brand.ts의 getCareer() 시작일과 반드시 동일하게 유지할 것 (불일치 시 카드/사이트 경력 어긋남)
const CAREER_START = new Date("2003-07-01T00:00:00+09:00");
const years = Math.floor((Date.now() - CAREER_START.getTime()) / 86_400_000 / 365.25);

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 1080x1350 세로형 카드 — 라이트/에디토리얼(크림↔딥그린 리듬), 전국구 */
function cardHtml({ heading, body, index, total, category, isHook, isCta, big_number, highlight }) {
  // 훅·CTA = 딥그린 배경 / 본문 = 크림 배경 (사이트 대비 밴드 리듬)
  const dark = isHook || isCta;
  const bg = dark ? "#1b3a30" : "#faf9f6";
  const headColor = dark ? "#faf9f6" : "#221e18";
  const bodyColor = dark ? "#9db3a8" : "#48423a";
  const overline = dark ? "#c9a94a" : "#a8842c";
  const footColor = dark ? "#7a9488" : "#6b6457";
  const divider = dark ? "#3a5449" : "#e0d9cb";
  const idxColor = dark ? "#5f776c" : "#a89f8e";
  // 인덱스 라벨: 훅=카테고리, 본문=번호(01,02…), CTA="무료 진단"
  const overlineText = isHook ? category : isCta ? "무료 진단" : "확인 포인트";
  const pageLabel = String(index + 1).padStart(2, "0");

  // 형광펜: 중간 카드에서 highlight 단어가 든 곳(heading/본문)에 첫 1회 강조.
  // heading·본문 어디에도 리터럴로 없으면 강조 없이 그냥 렌더(패러프레이즈 방어).
  const hlActive = highlight && !isHook && !isCta;
  const hlText = (s) =>
    hlActive && (s ?? "").includes(highlight)
      ? esc(s).replace(esc(highlight), `<span class="hl">${esc(highlight)}</span>`)
      : esc(s);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1080px; height:1350px; overflow:hidden;
    font-family:'Pretendard', sans-serif;
    background:${bg}; color:${headColor};
    display:flex; flex-direction:column;
    letter-spacing:-0.02em;
  }
  .top { padding:88px 96px 0; display:flex; justify-content:space-between; align-items:center; }
  .overline { font-size:30px; font-weight:700; color:${overline}; letter-spacing:0.16em; }
  .idx { font-size:30px; color:${idxColor}; font-weight:600; }
  .main { flex:1; display:flex; flex-direction:column; justify-content:center; padding:0 96px; }
  .rule { width:120px; height:6px; background:#a8842c; margin-bottom:56px; border-radius:2px; }
  h1 { font-size:${isHook ? 116 : isCta ? 104 : 96}px; font-weight:800; line-height:1.22;
    color:${headColor}; letter-spacing:-0.03em; word-break:keep-all; }
  h1 .gold { color:#c9a94a; }
  h1 .hl { background:linear-gradient(transparent 55%, rgba(168,132,44,0.42) 55%); padding:0 4px; }
  .bignum { position:absolute; top:${isHook ? "40" : "0"}px; right:-40px; font-size:420px;
    font-weight:800; color:${dark ? "#22493d" : "#efe9dd"}; line-height:1; letter-spacing:-0.05em; z-index:0; }
  .main, .top, .bottom { position:relative; z-index:1; }
  p { font-size:44px; line-height:1.6; color:${bodyColor}; word-break:keep-all;
    white-space:pre-line; margin-top:56px; font-weight:500; }
  .cta-btn { display:inline-flex; align-items:center; gap:12px; margin-top:64px;
    background:#a8842c; color:#1b3a30; font-size:40px; font-weight:800;
    padding:28px 52px; border-radius:14px; width:fit-content; letter-spacing:-0.02em; }
  .bottom { padding:0 96px 88px; }
  .footer { border-top:1px solid ${divider}; padding-top:44px; }
  .brand { font-size:32px; font-weight:600; color:${footColor}; }
</style></head>
<body>
  <div class="top">
    <span class="overline">${esc(overlineText)}</span>
    <span class="idx">${isHook || isCta ? "" : pageLabel}</span>
  </div>
  <div class="main">
    ${dark ? `<div class="rule"></div>` : ``}
    ${isHook && big_number ? `<div class="bignum">${esc(big_number)}</div>` : ``}
    <h1>${hlText(heading)}</h1>
    ${isCta
      ? `<div class="cta-btn">프로필 링크 →</div>`
      : body ? `<p>${hlText(body)}</p>` : ``}
  </div>
  <div class="bottom">
    <div class="footer">
      <div class="brand">${isCta ? "비대면 · 전국 상담" : `신순주 · GA명장 ${years}년`}</div>
    </div>
  </div>
</body></html>`;
}

async function main() {
  const { data: articles, error } = await supabase
    .from("premium_articles")
    .select("id, slug, category, carousel_json, image_paths")
    .not("carousel_json", "is", null)
    .eq("image_paths", "{}")
    .limit(5);

  if (error) throw error;
  if (!articles?.length) {
    console.log("렌더링할 카드뉴스가 없습니다.");
    return;
  }

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
  page.setDefaultTimeout(60000);

  for (const article of articles) {
    const cards = Array.isArray(article.carousel_json) ? article.carousel_json : [];
    if (!cards.length) continue;
    console.log(`[${article.slug}] 카드 ${cards.length}장 렌더링...`);

    const paths = [];
    for (let i = 0; i < cards.length; i++) {
      const html = cardHtml({
        heading: cards[i].heading,
        body: cards[i].body,
        index: i,
        total: cards.length,
        category: article.category,
        isHook: i === 0,
        isCta: i === cards.length - 1,
        big_number: cards[i].big_number,
        highlight: cards[i].highlight,
      });
      // 한글 tofu(□) 방지. networkidle0은 Pretendard CDN(서브셋 스트리밍)에서 idle에 도달 못해 타임아웃 →
      // domcontentloaded 후, 카드에서 쓰는 Pretendard weight를 fonts.load()로 명시 강제 로드하고 fonts.ready까지 실제 await.
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(async () => {
        await Promise.all([
          document.fonts.load("500 44px Pretendard"),
          document.fonts.load("600 32px Pretendard"),
          document.fonts.load("700 30px Pretendard"),
          document.fonts.load("800 96px Pretendard"),
        ]);
        await document.fonts.ready;
      });
      const png = await page.screenshot({ type: "png" });

      const storagePath = `${article.slug}/card-${String(i + 1).padStart(2, "0")}.png`;
      const { error: upErr } = await supabase.storage
        .from("card-news")
        .upload(storagePath, png, { contentType: "image/png", upsert: true });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("card-news").getPublicUrl(storagePath);
      paths.push(pub.publicUrl);
    }

    const { error: updErr } = await supabase
      .from("premium_articles")
      .update({ image_paths: paths, og_image_path: paths[0] ?? null, is_instagram_published: false })
      .eq("id", article.id);
    if (updErr) throw updErr;

    console.log(`[${article.slug}] 완료 — ${paths.length}장 업로드`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
