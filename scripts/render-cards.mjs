/**
 * 카드뉴스 렌더러 — 8종 타입 시스템. GitHub Actions에서 구동 (비용 제로).
 * premium_articles 중 carousel_json이 있고 image_paths가 비어있는 글을 찾아
 * 1080x1350 타입별 템플릿 HTML → Puppeteer 스냅샷 PNG → Supabase Storage 업로드
 * → image_paths / og_image_path 기록.
 *
 * 타입: hook | points | table | steps | stat | callout | quote | cta (+구형 heading/body 호환)
 * 배경 리듬: hook·stat·quote·cta = 딥그린/크림텍스트, points·table·steps·callout = 크림/차콜.
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

// ── 카드 전용 팔레트 — 웹 globals.css 토큰과 별개(웹 골드는 '속삭임'이지만 카드는 포인트색이 쨍해야 함)
const GREEN = "#1b3a30"; // 딥그린 배경
const CREAM = "#faf9f6"; // 크림 배경/딥그린 위 텍스트
const CHARCOAL = "#221e18"; // 크림 위 헤드 텍스트
const GOLD = "#EEBB33"; // 카드골드 — 배지·하이라이트·강조 숫자·언더라인 (면 사용 허용)
const RED = "#cc3b2f"; // callout ✕ 전용
const MUTED_ON_DARK = "#9db3a8";
const MUTED_ON_LIGHT = "#6b6457";
const LINE_ON_DARK = "#3a5449";
const LINE_ON_LIGHT = "#e0d9cb";
const FAINT_ON_DARK = "#26493c"; // 배경 인덱스 숫자(흐리게)

const DARK_TYPES = new Set(["hook", "stat", "quote", "cta"]);

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 형광펜/골드 강조 — highlight 단어가 텍스트에 리터럴로 있을 때만 첫 1회 감싼다.
 * (본문에 없는 패러프레이즈 highlight 방어 — 없으면 강조 없이 그냥 렌더)
 * 크림 카드 = .hl(골드 형광펜), 딥그린 카드 = .goldtext(카드골드 글자색)
 */
function withHighlight(text, word, { dark = false } = {}) {
  const e = esc(text);
  if (!word || !String(text ?? "").includes(word)) return e;
  const cls = dark ? "goldtext" : "hl";
  return e.replace(esc(word), `<span class="${cls}">${esc(word)}</span>`);
}

/** 구형(heading/body) carousel 호환 — 타입 없는 카드를 위치 기반으로 매핑 */
function normalizeCard(card, index, total) {
  if (card?.type) return card;
  return {
    type: "legacy",
    overline: index === 0 ? "" : index === total - 1 ? "무료 진단" : "확인 포인트",
    _dark: index === 0 || index === total - 1,
    _isCta: index === total - 1,
    heading: card?.heading,
    body: card?.body,
    big_number: card?.big_number,
    highlight: card?.highlight,
  };
}

/** 공통 셸 — 상단 골드바 + ★오버라인 + 타입별 본문 + 푸터(브랜드/페이지·진행 바) */
function shell({ dark, index, total, overline, topRight = "", bgIndex = false, content }) {
  const bg = dark ? GREEN : CREAM;
  const fg = dark ? CREAM : CHARCOAL;
  const muted = dark ? MUTED_ON_DARK : MUTED_ON_LIGHT;
  const line = dark ? LINE_ON_DARK : LINE_ON_LIGHT;
  const overColor = dark ? GOLD : GREEN;
  const pageNum = String(index + 1).padStart(2, "0");
  const progress = Math.round(((index + 1) / total) * 100);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1080px; height:1350px; overflow:hidden; position:relative;
    font-family:'Pretendard', sans-serif;
    background:${bg}; color:${fg};
    display:flex; flex-direction:column;
    letter-spacing:-0.02em; word-break:keep-all;
  }
  .goldbar { height:12px; background:${GOLD}; }
  .top { padding:64px 96px 0; display:flex; justify-content:space-between; align-items:center;
    position:relative; z-index:1; }
  .overline { font-size:32px; font-weight:800; color:${overColor}; letter-spacing:0.12em; }
  .overline .star { color:${GOLD}; margin-right:14px; }
  .badge { background:${GOLD}; color:${CHARCOAL}; font-size:30px; font-weight:800;
    padding:14px 30px; border-radius:999px; }
  .bgindex { position:absolute; top:-30px; right:-30px; font-size:440px; font-weight:800;
    color:${FAINT_ON_DARK}; line-height:1; letter-spacing:-0.05em; z-index:0; }
  .main { flex:1; display:flex; flex-direction:column; justify-content:center;
    padding:40px 96px; position:relative; z-index:1; min-height:0; }
  .goldtext { color:${GOLD}; }
  .hl { background:linear-gradient(transparent 55%, rgba(238,187,51,0.5) 55%); padding:0 4px; }
  .bottom { padding:0 96px 64px; position:relative; z-index:1; }
  .footer { border-top:1px solid ${line}; padding-top:34px; }
  .frow { display:flex; justify-content:space-between; align-items:baseline;
    font-size:28px; font-weight:600; color:${muted}; }
  .fpage { font-variant-numeric:tabular-nums; }
  .ptrack { margin-top:26px; height:6px; background:${line}; border-radius:3px; overflow:hidden; }
  .pfill { width:${progress}%; height:100%; background:${GOLD}; border-radius:3px; }
</style></head>
<body>
  <div class="goldbar"></div>
  ${bgIndex ? `<div class="bgindex">${pageNum}</div>` : ""}
  <div class="top">
    <span class="overline">${overline ? `<span class="star">★</span>${esc(overline)}` : ""}</span>
    ${topRight}
  </div>
  <div class="main">${content}</div>
  <div class="bottom">
    <div class="footer">
      <div class="frow">
        <span>신순주 · GA명장&nbsp;&nbsp;|&nbsp;&nbsp;비대면·전국</span>
        <span class="fpage">${index + 1} / ${total}</span>
      </div>
      <div class="ptrack"><div class="pfill"></div></div>
    </div>
  </div>
</body></html>`;
}

/* ── 타입별 본문 빌더 ───────────────────────────────────────── */

// hook: 딥그린. 거대 헤드라인(highlight 카드골드) + 저장각 배지 + swipe cue(body)
function buildHook(c) {
  const swipe = c.swipe_cue ?? c.body;
  return {
    topRight: `<span class="badge">저장각</span>`,
    content: `
      <style>
        .hook-h { font-size:110px; font-weight:800; line-height:1.24; letter-spacing:-0.03em; }
        .swipe { margin-top:88px; font-size:38px; font-weight:700; color:${GOLD}; }
        .swipe .arrow { margin-left:16px; }
      </style>
      <h1 class="hook-h">${withHighlight(c.headline, c.highlight, { dark: true })}</h1>
      ${swipe ? `<div class="swipe">${esc(swipe)}<span class="arrow">→</span></div>` : ""}`,
  };
}

// points: 크림. num=딥그린 원+번호 / check=골드 체크, title+sub 세로 나열
// (items는 points·steps·cta 공용 스키마 — points에선 tag가 "num"|"check")
function buildPoints(c) {
  const items = Array.isArray(c.items) ? c.items : [];
  const rows = items
    .map((it, i) => {
      const marker =
        it.tag === "check"
          ? `<span class="mk mk-check">✓</span>`
          : `<span class="mk mk-num">${i + 1}</span>`;
      const hlWord = it.highlight ?? c.highlight; // 카드 레벨 highlight가 items 텍스트에 적용됨
      return `<div class="item">${marker}
        <div class="itext">
          <div class="ititle">${withHighlight(it.title, hlWord)}</div>
          ${it.sub ? `<div class="isub">${withHighlight(it.sub, hlWord)}</div>` : ""}
        </div></div>`;
    })
    .join("");
  return {
    content: `
      <style>
        .pt-h { font-size:66px; font-weight:800; line-height:1.3; }
        .pt-sub { margin-top:24px; font-size:34px; font-weight:500; line-height:1.5; color:${MUTED_ON_LIGHT}; }
        .pt-wrap { margin-bottom:64px; }
        .item { display:flex; gap:36px; align-items:flex-start; }
        .item + .item { margin-top:52px; }
        .mk { flex:none; width:72px; height:72px; border-radius:50%; display:flex;
          align-items:center; justify-content:center; font-weight:800; }
        .mk-num { background:${GREEN}; color:${CREAM}; font-size:38px; }
        .mk-check { background:${GOLD}; color:${CHARCOAL}; font-size:44px; border-radius:18px; }
        .ititle { font-size:46px; font-weight:800; line-height:1.35; padding-top:6px; }
        .isub { margin-top:14px; font-size:34px; font-weight:500; line-height:1.5; color:${MUTED_ON_LIGHT}; }
      </style>
      <div class="pt-wrap"><h2 class="pt-h">${esc(c.headline)}</h2>
      ${c.body ? `<p class="pt-sub">${esc(c.body)}</p>` : ""}</div>
      <div>${rows}</div>`,
  };
}

// table: 크림. 헤더행 딥그린/크림, highlight_row 카드골드 배경
function buildTable(c) {
  const cols = Array.isArray(c.columns) ? c.columns : [];
  const rows = Array.isArray(c.rows) ? c.rows : [];
  const head = cols.map((h) => `<th>${esc(h)}</th>`).join("");
  const body = rows
    .map((r, ri) => {
      const cells = (Array.isArray(r) ? r : [])
        .map((cell, ci) => `<td class="${ci === 0 ? "first" : ""}">${esc(cell)}</td>`)
        .join("");
      return `<tr class="${ri === c.highlight_row_index ? "hlrow" : ""}">${cells}</tr>`;
    })
    .join("");
  return {
    content: `
      <style>
        .tb-h { font-size:66px; font-weight:800; line-height:1.3; }
        .tb-sub { margin-top:24px; font-size:34px; font-weight:500; line-height:1.5; color:${MUTED_ON_LIGHT}; }
        .tb-wrap { margin-bottom:56px; }
        table { width:100%; border-collapse:collapse; }
        th { background:${GREEN}; color:${CREAM}; font-size:34px; font-weight:800;
          padding:30px 24px; text-align:center; }
        th:first-child { border-radius:16px 0 0 0; } th:last-child { border-radius:0 16px 0 0; }
        td { font-size:34px; font-weight:600; padding:32px 24px; text-align:center;
          border-bottom:1px solid ${LINE_ON_LIGHT}; line-height:1.4; }
        td.first { text-align:left; font-weight:800; }
        .hlrow td { background:${GOLD}; color:${CHARCOAL}; font-weight:800;
          border-bottom:1px solid ${GOLD}; }
      </style>
      <div class="tb-wrap"><h2 class="tb-h">${esc(c.headline)}</h2>
      ${c.body ? `<p class="tb-sub">${esc(c.body)}</p>` : ""}</div>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
  };
}

// steps: 크림. 단계 박스 + 사이 ↓ 골드 화살표 + footer_badge (items 공용 스키마: title/sub)
function buildSteps(c) {
  const steps = Array.isArray(c.items) ? c.items : Array.isArray(c.steps) ? c.steps : [];
  const badge = c.footer_badge ?? c.extra;
  const boxes = steps
    .map(
      (s, i) => `${i > 0 ? `<div class="down">↓</div>` : ""}
      <div class="step">
        <span class="snum">${i + 1}</span>
        <div>
          <div class="stitle">${esc(s.title)}</div>
          ${s.sub ? `<div class="ssub">${esc(s.sub)}</div>` : ""}
        </div>
      </div>`
    )
    .join("");
  return {
    content: `
      <style>
        .st-h { font-size:66px; font-weight:800; line-height:1.3; }
        .st-sub { margin-top:24px; font-size:34px; font-weight:500; line-height:1.5; color:${MUTED_ON_LIGHT}; }
        .st-wrap { margin-bottom:56px; }
        .step { background:#ffffff; border:2px solid ${LINE_ON_LIGHT}; border-radius:24px;
          padding:36px 44px; display:flex; gap:36px; align-items:center; }
        .snum { flex:none; width:64px; height:64px; border-radius:50%; background:${GREEN};
          color:${CREAM}; font-size:34px; font-weight:800; display:flex;
          align-items:center; justify-content:center; }
        .stitle { font-size:42px; font-weight:800; line-height:1.35; }
        .ssub { margin-top:10px; font-size:32px; font-weight:500; line-height:1.45; color:${MUTED_ON_LIGHT}; }
        .down { text-align:center; font-size:44px; font-weight:800; color:${GOLD}; padding:14px 0; }
        .fbadge { margin-top:52px; align-self:center; background:${GOLD}; color:${CHARCOAL};
          font-size:32px; font-weight:800; padding:18px 44px; border-radius:999px; }
      </style>
      <div class="st-wrap"><h2 class="st-h">${esc(c.headline)}</h2>
      ${c.body ? `<p class="st-sub">${esc(c.body)}</p>` : ""}</div>
      ${boxes}
      ${badge ? `<div class="fbadge">${esc(badge)}</div>` : ""}`,
  };
}

// stat: 딥그린. 초대형 카드골드 big_number + unit + caption
function buildStat(c) {
  const unit = c.unit ?? c.extra;
  const caption = c.caption ?? c.body;
  return {
    bgIndex: true,
    content: `
      <style>
        .sa-h { font-size:56px; font-weight:800; line-height:1.35; }
        .num-wrap { margin:72px 0; display:flex; align-items:baseline; gap:24px; flex-wrap:wrap; }
        .bignum { font-size:300px; font-weight:800; color:${GOLD}; line-height:1; letter-spacing:-0.04em;
          font-variant-numeric:tabular-nums; }
        .unit { font-size:56px; font-weight:700; color:${MUTED_ON_DARK}; }
        .cap { font-size:42px; font-weight:600; line-height:1.55; color:${CREAM}; }
      </style>
      <h2 class="sa-h">${esc(c.headline)}</h2>
      <div class="num-wrap"><span class="bignum">${esc(c.big_number)}</span>${unit ? `<span class="unit">${esc(unit)}</span>` : ""}</div>
      ${caption ? `<p class="cap">${esc(caption)}</p>` : ""}`,
  };
}

// callout: 크림. mark(✕빨강/✓딥그린) + headline + correction 박스 + warning
function buildCallout(c) {
  const isX = c.mark !== "check";
  const correction = c.correction ?? c.body;
  const warning = c.warning ?? c.extra;
  return {
    content: `
      <style>
        .co-mark { font-size:96px; font-weight:800; line-height:1;
          color:${isX ? RED : GREEN}; margin-bottom:40px; }
        .co-h { font-size:66px; font-weight:800; line-height:1.32; margin-bottom:64px; }
        .co-box { background:#ffffff; border:3px solid ${GREEN}; border-radius:24px;
          padding:52px 56px; font-size:44px; font-weight:700; line-height:1.5; }
        .co-warn { margin-top:44px; border:3px solid ${GOLD}; border-radius:18px;
          padding:36px 44px; font-size:32px; font-weight:600; line-height:1.5; color:${MUTED_ON_LIGHT}; }
      </style>
      <div class="co-mark">${isX ? "✕" : "✓"}</div>
      <h2 class="co-h">${esc(c.headline)}</h2>
      ${correction ? `<div class="co-box">${esc(correction)}</div>` : ""}
      ${warning ? `<div class="co-warn">⚠️ ${esc(warning)}</div>` : ""}`,
  };
}

// quote: 딥그린. 거대 골드 인용부호 + 크림 대문 + 골드 attribution
function buildQuote(c) {
  const quote = c.quote ?? c.headline;
  const attribution = c.attribution ?? c.body;
  return {
    bgIndex: true,
    content: `
      <style>
        .q-mark { font-size:220px; font-weight:800; color:${GOLD}; line-height:0.6;
          margin-bottom:56px; font-family:Georgia, serif; }
        .q-text { font-size:80px; font-weight:800; line-height:1.4; letter-spacing:-0.03em; }
        .q-attr { margin-top:72px; font-size:38px; font-weight:700; color:${GOLD}; text-align:right; }
      </style>
      <div class="q-mark">&ldquo;</div>
      <p class="q-text">${esc(quote)}</p>
      <div class="q-attr">${attribution ? `— ${esc(attribution)}` : ""}</div>`,
  };
}

// cta: 딥그린. 행동 행 나열(마지막 행 카드골드) + handle 강조 (items 공용 스키마: tag=이모지, title=행동 문구)
function buildCta(c) {
  const actions = Array.isArray(c.items) ? c.items : Array.isArray(c.actions) ? c.actions : [];
  const rows = actions
    .map(
      (a, i) => `<div class="act ${i === actions.length - 1 ? "act-hero" : ""}">
        <span class="aicon">${esc(a.tag ?? a.icon)}</span><span>${esc(a.title ?? a.text)}</span>
      </div>`
    )
    .join("");
  return {
    content: `
      <style>
        .cta-h { font-size:86px; font-weight:800; line-height:1.28; letter-spacing:-0.03em; }
        .cta-sub { margin-top:28px; margin-bottom:72px; font-size:36px; font-weight:500;
          color:${MUTED_ON_DARK}; }
        .act { display:flex; align-items:center; gap:30px; font-size:42px; font-weight:700;
          color:${CREAM}; border:2px solid ${LINE_ON_DARK}; border-radius:20px;
          padding:34px 44px; }
        .act + .act { margin-top:26px; }
        .act-hero { background:${GOLD}; border-color:${GOLD}; color:${CHARCOAL}; font-weight:800; }
        .aicon { font-size:48px; }
        .handle { margin-top:64px; font-size:46px; font-weight:800; color:${GOLD}; }
      </style>
      <h1 class="cta-h">${esc(c.headline)}</h1>
      ${c.body ? `<div class="cta-sub">${esc(c.body)}</div>` : `<div style="height:80px"></div>`}
      ${rows}
      <div class="handle">${esc(c.handle || c.extra || "@goodfinance_sj")}</div>`,
  };
}

// legacy: 구형 heading/body 카드 호환 (기존 단일 템플릿과 유사한 담백 레이아웃)
function buildLegacy(c) {
  return {
    content: `
      <style>
        .lg-h { font-size:${c._dark ? 104 : 92}px; font-weight:800; line-height:1.24; letter-spacing:-0.03em; }
        .lg-b { margin-top:56px; font-size:44px; font-weight:500; line-height:1.6;
          color:${c._dark ? MUTED_ON_DARK : "#48423a"}; white-space:pre-line; }
        .lg-btn { display:inline-flex; margin-top:64px; background:${GOLD}; color:${CHARCOAL};
          font-size:40px; font-weight:800; padding:28px 52px; border-radius:14px; width:fit-content; }
      </style>
      ${c.big_number ? `<div style="position:absolute;top:0;right:-40px;font-size:420px;font-weight:800;color:${c._dark ? FAINT_ON_DARK : "#efe9dd"};line-height:1;z-index:0;">${esc(c.big_number)}</div>` : ""}
      <h1 class="lg-h" style="position:relative;">${withHighlight(c.heading, c.highlight, { dark: c._dark })}</h1>
      ${c._isCta ? `<div class="lg-btn">프로필 링크 →</div>` : c.body ? `<p class="lg-b" style="position:relative;">${withHighlight(c.body, c.highlight, { dark: c._dark })}</p>` : ""}`,
  };
}

const BUILDERS = {
  hook: buildHook,
  points: buildPoints,
  table: buildTable,
  steps: buildSteps,
  stat: buildStat,
  callout: buildCallout,
  quote: buildQuote,
  cta: buildCta,
  legacy: buildLegacy,
};

function cardHtml(rawCard, index, total) {
  const card = normalizeCard(rawCard, index, total);
  const dark = card.type === "legacy" ? !!card._dark : DARK_TYPES.has(card.type);
  const builder = BUILDERS[card.type] ?? buildLegacy;
  const { content, topRight = "", bgIndex = false } = builder(card, index);
  return shell({
    dark,
    index,
    total,
    overline: card.overline,
    topRight,
    // 배경 인덱스 숫자는 딥그린 중간 카드(stat·quote)에만 — 훅·CTA는 요소가 많아 생략
    bgIndex: dark && bgIndex,
    content,
  });
}

/** 카드 객체의 모든 문자열을 모아 폰트 서브셋 로드 텍스트로 사용 */
function collectText(v) {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(collectText).join("");
  if (v && typeof v === "object") return Object.values(v).map(collectText).join("");
  return "";
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
      const html = cardHtml(cards[i], i, cards.length);
      // 한글 tofu(□) 방지. Pretendard static CSS는 unicode-range로 한글을 여러 서브셋으로 쪼개므로,
      // fonts.load()에 실제 렌더 텍스트(한글 포함)를 인자로 넘겨 필요한 서브셋을 강제 로드해야 한다.
      // waitUntil:"load"로 스타일시트/@import 완료(=@font-face 등록) 보장 후, weight별로 로드하고 fonts.ready까지 await.
      // (networkidle0은 CDN 서브셋 스트리밍에서 idle 미도달 → 60s 타임아웃이라 사용 불가)
      const uiText = "신순주GA명장비대면전국저장각무료진단확인포인트프로필링크★✓✕⚠→↓—";
      const cardText = `${collectText(cards[i])}${article.category ?? ""}${uiText}0123456789/`;
      await page.setContent(html, { waitUntil: "load", timeout: 60000 });
      await page.evaluate(async (text) => {
        const weights = ["500", "600", "700", "800"];
        await Promise.all(weights.map((w) => document.fonts.load(`${w} 44px Pretendard`, text)));
        await document.fonts.ready;
      }, cardText);
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
