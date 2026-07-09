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

const CAREER_START = new Date("2003-07-01T00:00:00+09:00");
const years = Math.floor((Date.now() - CAREER_START.getTime()) / 86_400_000 / 365.25);

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 1080x1350 세로형 카드 템플릿 — 딥블랙 + 샴페인골드, 상·하단 Safe Zone 브랜딩 */
function cardHtml({ heading, body, index, total, category, isHook, isCta }) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1080px; height:1350px; overflow:hidden;
    font-family:'Pretendard Variable', Pretendard, sans-serif;
    background:#050505; color:#f5f5f4;
    display:flex; flex-direction:column;
    letter-spacing:-0.02em;
  }
  .glow { position:absolute; width:700px; height:700px; border-radius:50%;
    background:radial-gradient(circle, rgba(212,175,55,0.10) 0%, transparent 70%);
    top:-200px; right:-200px; }
  .top { padding:64px 80px 0; display:flex; justify-content:space-between; align-items:center; }
  .badge { font-size:26px; font-weight:700; color:#d4af37; letter-spacing:0.14em; }
  .page { font-size:26px; color:#52525b; font-weight:600; }
  .main { flex:1; display:flex; flex-direction:column; justify-content:center; padding:0 88px; position:relative; }
  .cat { display:inline-block; font-size:28px; font-weight:700; color:#e6c96b;
    border:2px solid rgba(154,127,42,0.6); border-radius:999px; padding:10px 30px;
    margin-bottom:44px; width:fit-content; }
  h1 { font-size:${isHook ? 84 : 68}px; font-weight:800; line-height:1.25; color:#ffffff;
    margin-bottom:40px; word-break:keep-all; }
  h1 .gold { color:#d4af37; }
  p { font-size:40px; line-height:1.65; color:#c8c8cc; word-break:keep-all; white-space:pre-line; }
  .rule { width:88px; height:5px; background:#d4af37; margin-bottom:44px; border-radius:3px; }
  .bottom { padding:0 80px 60px; }
  .footer { border-top:1px solid #26262a; padding-top:36px;
    display:flex; justify-content:space-between; align-items:center; }
  .brand { font-size:28px; font-weight:700; color:#fafafa; }
  .brand small { display:block; font-size:22px; font-weight:500; color:#71717a; margin-top:6px; }
  .seal { font-size:24px; font-weight:700; color:#d4af37; text-align:right; line-height:1.5; }
  ${isCta ? ".main{align-items:center;text-align:center;} .rule{margin-left:auto;margin-right:auto;} .cat{display:none;}" : ""}
</style></head>
<body>
  <div class="glow"></div>
  <div class="top">
    <span class="badge">신순주의 선한 금융</span>
    <span class="page">${index + 1} / ${total}</span>
  </div>
  <div class="main">
    ${isHook ? `<span class="cat">${esc(category)}</span>` : `<div class="rule"></div>`}
    <h1>${esc(heading)}</h1>
    <p>${esc(body)}</p>
  </div>
  <div class="bottom">
    <div class="footer">
      <div class="brand">프라임에셋 140본부<small>보험은 약속입니다</small></div>
      <div class="seal">GA명장 · ${years}년 경력<br>신순주</div>
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
      });
      // networkidle0은 CDN 폰트 스트리밍 때문에 타임아웃될 수 있음 — 폰트 로딩을 직접 대기
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluateHandle("document.fonts.ready");
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
