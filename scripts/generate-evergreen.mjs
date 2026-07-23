/**
 * 상록수(evergreen) 콘텐츠 주간 생성 — 화(유입)·금(전환) 크론. 커밋 M3.
 *
 * 1. 시드뱅크(scripts/seeds/evergreen-seeds.mjs)에서 미생성 시드 선택
 *    — isHub 최우선, 그다음 intent 일치하는 첫 번째
 * 2. seed.sources(공공 1차 소스)를 fetch → 본문 추출로 groundingText 구성
 *    — 본문을 하나도 못 뽑으면 그 시드는 스킵하고 다음 시드로 (§9: 팩트 없는 원고 금지)
 * 3. /api/factory/generate 를 mode:'evergreen'으로 호출 → 초안 적재
 *    (auto_publish false — 발행은 /admin에서 사람이 1클릭)
 * 4. 네이버/블로그스팟 원고 텔레그램 전송 + 실측 요약 알림(0건이어도 사유 명시)
 *    — 카드뉴스·네이버 이미지 세트는 후속 스텝 render-cards.mjs가 뉴스와 동일하게 처리
 *
 * 실행: node scripts/generate-evergreen.mjs [--intent=유입|전환]
 *   intent 미지정 시 요일 자동(KST): 화=유입, 금=전환 (그 외 요일 수동 실행 기본값은 유입)
 * 필요 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   SITE_URL, FACTORY_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { EVERGREEN_SEEDS } from "./seeds/evergreen-seeds.mjs";
import { buildAnecdoteSection } from "./anecdote-bank.mjs";

const {
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SITE_URL = "https://goodfinance.kr",
  FACTORY_SECRET,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
} = process.env;

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const UA = "Mozilla/5.0 (compatible; GoodFinancePipeline/1.0)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * --seed= 인자 — 특정 시드 1개를 지정해 생성한다(수동 실행 전용).
 * 미지정 시 종전대로 요일·intent 기반 자동 선택(허브 우선 → intent 일치 시드 순).
 */
function resolveSeedKey() {
  return process.argv.find((a) => a.startsWith("--seed="))?.split("=")[1]?.trim() || null;
}

/** --intent= 인자 우선, 없으면 KST 요일 자동 (화=유입, 금=전환, 그 외 수동 실행은 유입) */
function resolveIntent() {
  const arg = process.argv.find((a) => a.startsWith("--intent="))?.split("=")[1];
  if (arg === "유입" || arg === "전환") return arg;
  if (arg) {
    console.warn(`알 수 없는 --intent 값 '${arg}' — 요일 자동으로 대체`);
  }
  const day = new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Seoul" });
  return day === "Fri" ? "전환" : "유입";
}

// ────────────────────────────────────────────────────────────────────
// HTML 파서 — collect-and-generate.mjs(커밋 B)의 파서를 복제해 재사용.
// (원본은 import 시 main()이 실행되는 단독 스크립트라 모듈 공유 불가.
//  ⚠️ 원본 파서를 고치면 여기도 함께 갱신할 것.)
// ────────────────────────────────────────────────────────────────────

/** charset 대응 fetch — 금감원/파인 일부 페이지는 EUC-KR (res.text()로 읽으면 한글 깨짐) */
async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "";
  let charset = (ct.match(/charset=([\w-]+)/i)?.[1] ?? "").toLowerCase();
  if (!charset) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 2000));
    charset = (head.match(/charset=["']?([\w-]+)/i)?.[1] ?? "utf-8").toLowerCase();
  }
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

/** HTML 엔티티 최소 디코드 */
function decodeEntities(s) {
  const named = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
    middot: "·", rarr: "→", hellip: "…",
  };
  return String(s ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (_, name) => named[name] ?? `&${name};`);
}

/** 금감원/파인 게시판 목록 파싱 — <td class="title"><a href="…view.do?…">제목</a></td> */
function parseBoardList(html, origin, limit = 8) {
  const items = [];
  const re = /<td class="title">\s*<a href="([^"]*view\.do[^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>/g;
  let m;
  while ((m = re.exec(html)) !== null && items.length < limit) {
    const href = decodeEntities(m[1]);
    const title = decodeEntities(m[2].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
    if (!title) continue;
    items.push({ title, link: href.startsWith("http") ? href : `${origin}${href}` });
  }
  return items;
}

/**
 * 게시글 상세 본문 — <div class="dbdata"> 스코프. 첨부/이미지형 스텁은 빈 문자열.
 * ⚠️ 원본(collect-and-generate.mjs) 대비 보강: 파인 게시판(꿀팁200선·톡톡 등)은
 * 이미지형이지만 img alt에 전문이 들어 있다(2026-07-12 실측) → alt 텍스트도 수확.
 */
async function fetchBoardBody(link) {
  const html = await fetchText(link);
  const start = html.indexOf('class="dbdata"');
  if (start === -1) return "";
  const chunk = html.slice(start, start + 60000); // 이미지형은 dbdata div가 여러 개 이어짐
  const end = chunk.search(/class="bd-view-nav"|담당부서/);
  const scoped = end > 0 ? chunk.slice(0, end) : chunk;

  const altTexts = [...scoped.matchAll(/<img[^>]*\salt=["']([^"']+)["']/gi)]
    .map((m) => decodeEntities(m[1]).replace(/\s+/g, " ").trim())
    .filter((t) => t.length >= 20);

  const stripped = decodeEntities(
    scoped
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+/g, " ")
    .replace(/^class="dbdata">\s*/, "")
    .replace(/\s*목록\s*$/, "")
    .trim();

  const text = [stripped, ...altTexts].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 4000);
  if (text.length < 80 || (/첨부\s*파일.*(참고|참조)/.test(text) && text.length < 200)) return "";
  return text;
}

// ────────────────────────────────────────────────────────────────────
// 그라운딩 — 시드 소스에서 사실 본문 확보
// ────────────────────────────────────────────────────────────────────

/** 게시판 검색 URL (egov 표준 파라미터 — 미지원이면 서버가 무시하고 기본 목록 반환) */
function withBoardSearch(listUrl, keyword) {
  const u = new URL(listUrl);
  u.searchParams.set("searchCnd", "1"); // 제목 검색
  u.searchParams.set("searchWrd", keyword);
  return u.toString();
}

/**
 * 불용 토큰 — 단독으로는 주제 정합 근거가 못 되는 범용 토큰 (M3-1 실측 결함:
 * 리모델링 시드 키워드가 죄다 "…보험"이라 '보험' 토큰이 만능 매치가 되어
 * 펫보험·일상생활배상책임보험 게시글이 통과, 허브 글에 무관 사실 3건이 섞임).
 */
const STOP_TOKENS = new Set(["보험", "가입", "계약", "상품", "금융", "안내", "정보", "유익"]);

/** 시드의 특이 토큰 — keywords 공백 분해 + searchTerms, 중복 제거(Set), 불용 토큰 제외 */
function specificTokens(seed) {
  const raw = [...seed.keywords.flatMap((k) => k.split(/\s+/)), ...(seed.searchTerms ?? [])];
  return [...new Set(raw)].filter((t) => t.length >= 2 && !STOP_TOKENS.has(t));
}

/** 게시판 검색어 — 시드가 searchTerms로 직접 지정, 미지정 시 특이 토큰 사용 */
function boardSearchTerms(seed) {
  const terms = seed.searchTerms?.length ? seed.searchTerms : specificTokens(seed);
  return terms.slice(0, 6);
}

/**
 * 특이 토큰이 제목에 최소 1개 매치되어야 통과 — 0개면 탈락.
 * 불용 토큰만 맞은 게시글(예: 제목에 '보험'만)은 근거가 되지 못한다.
 */
function pickRelevantPosts(items, seed, n = 3) {
  const tokens = specificTokens(seed);
  return items
    .map((it) => ({ it, s: tokens.reduce((a, t) => a + (it.title.includes(t) ? 1 : 0), 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.it);
}

/**
 * 게시판 목록 소스: searchTerms 검색(최대 4개) → 특이 토큰 스코어링 → 관련 글 최대 3건 본문 확보.
 * ⚠️ 최신글 폴백 없음(M3-1) — 검색·스코어링 통과 게시글이 0건이면 이 소스는 실패.
 * 무관한 최신글로 그라운딩하는 오염이 팩트 없는 원고보다 나쁘다(§9).
 */
async function extractBoardSource(url, seed) {
  const origin = new URL(url).origin;
  const terms = boardSearchTerms(seed);
  const seen = new Set();
  const items = [];
  const addAll = (list) => {
    for (const it of list) {
      if (!seen.has(it.link)) {
        seen.add(it.link);
        items.push(it);
      }
    }
  };

  for (const term of terms) {
    try {
      addAll(parseBoardList(await fetchText(withBoardSearch(url, term)), origin));
    } catch {
      /* 개별 검색 실패는 무시 — 다음 검색어로 */
    }
    if (items.length >= 8) break;
    await sleep(300);
  }
  if (!items.length) throw new Error(`게시판 검색 결과 0건(검색어: ${terms.join("·")})`);

  const picked = pickRelevantPosts(items, seed);
  if (!picked.length) throw new Error("주제 정합 게시글 없음(특이 토큰 미매치)");

  const texts = [];
  for (const it of picked) {
    try {
      const body = await fetchBoardBody(it.link);
      if (body) texts.push(`「${it.title}」 ${body}`);
    } catch {
      /* 개별 글 실패는 무시 */
    }
    await sleep(400);
  }
  if (!texts.length) throw new Error("게시글 본문을 하나도 확보하지 못함(첨부/이미지형)");
  return texts.join("\n\n");
}

/** 일반 안내 페이지 소스: 본문 영역 텍스트 추출 (에러 페이지·스크립트 페이지 방어) */
async function extractPageSource(url) {
  const html = await fetchText(url);
  const scoped = (() => {
    const i = html.indexOf('class="dbdata"');
    if (i !== -1) return html.slice(i, i + 20000);
    const main = html.match(/<(?:main|article)[\s\S]*?<\/(?:main|article)>/i);
    if (main) return main[0];
    const body = html.match(/<body[\s\S]*?<\/body>/i);
    return body ? body[0] : html;
  })();
  const text = decodeEntities(
    scoped
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<(?:nav|header|footer)[\s\S]*?<\/(?:nav|header|footer)>/gi, "")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
  if (text.length < 300) {
    throw new Error(`본문이 너무 짧음(${text.length}자 — 에러/스크립트 페이지 가능성)`);
  }
  return text;
}

/**
 * 시드의 소스 전체를 그라운딩 텍스트로. 소스별 확보 여부(sourceStats)는 텔레그램 요약용.
 * 한 소스라도 확보하면 진행 — 전부 실패 시 groundingText는 빈 문자열(호출부가 시드 스킵).
 */
async function buildGrounding(seed) {
  const parts = [];
  const sourceStats = [];
  for (const url of seed.sources) {
    try {
      const text = url.includes("list.do")
        ? await extractBoardSource(url, seed)
        : await extractPageSource(url);
      parts.push(`[근거 소스: ${url}]\n${text}`);
      sourceStats.push({ url, ok: true, chars: text.length });
      console.log(`  [그라운딩 ✓] ${url} (${text.length}자)`);
    } catch (err) {
      sourceStats.push({ url, ok: false, reason: err.message });
      console.warn(`  [그라운딩 ✗] ${url} — ${err.message}`);
    }
    await sleep(400);
  }
  return { groundingText: parts.join("\n\n────\n\n").slice(0, 26000), sourceStats };
}

// ────────────────────────────────────────────────────────────────────
// 생성 호출 + 텔레그램
// ────────────────────────────────────────────────────────────────────

export const HUB_SEED_KEY = "remodeling-hub";

/**
 * 허브글 내부링크 결정적 삽입(M4-2) — 시드 기사 → 허브글 토피컬 어소리티 클러스터.
 * 모델 프롬프트에 맡기지 않고 저장된 원고를 후처리로 고친다(N6 CTA 마커 철학 —
 * 모델에게 맡기면 누락·변형된다). 첫 H2(## ) 직전에 연작 안내 블록을 넣고,
 * H2가 없으면(비정상) 본문 맨 앞에 넣는다. 이미 같은 slug 링크가 본문에 있으면
 * null 반환(멱등 — 재실행해도 중복 삽입 없음). 링크는 상대경로 /news/… (본진 전용).
 *
 * ⚠️ 채널 원고(naver_blog_content/blogspot_content)에는 삽입하지 않는다:
 *  - 네이버: 본문 링크 과다 = 스팸 판정 위험 (링크 첨부는 toNaverText 변환기가 말미에 최소로)
 *  - 블로그스팟: toBlogspotHtml 변환기의 본진 앵커 원칙이 이미 커버
 */
export function injectHubLink(markdown, hubSlug) {
  const md = String(markdown ?? "");
  const href = `/news/${hubSlug}`;
  if (md.includes(href)) return null;
  const block = [
    `> 📌 이 글은 [보험 리모델링 완벽 가이드](${href}) 연작입니다.`,
    `> 전체 그림이 필요하시면 가이드부터 읽어보세요.`,
  ].join("\n");
  const firstH2 = md.match(/^##\s/m);
  if (!firstH2) return `${block}\n\n${md}`;
  return `${md.slice(0, firstH2.index)}${block}\n\n${md.slice(firstH2.index)}`;
}

/**
 * @param content 모델 입력 = 그라운딩 원문 + 일화뱅크 주입분
 * @param sourceFulltext 검수 대조용 원문 전문 = 일화 주입분을 뺀 순수 그라운딩 원문
 */
async function generateEvergreen(seed, content, sourceFulltext) {
  const res = await fetch(`${SITE_URL}/api/factory/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-factory-secret": FACTORY_SECRET },
    // undici 기본 헤더 타임아웃(300초)이 서버 한도와 같아, 서버가 300초에 죽으며 보내는
    // 504(FUNCTION_INVOCATION_TIMEOUT)를 받기도 전에 클라이언트가 먼저 끊겼다
    // (실측: run 29299705372 — UND_ERR_HEADERS_TIMEOUT, 원인 불명 에러로만 보임).
    // 서버보다 넉넉히 길게 잡아 504 본문을 받아 원인이 로그에 남게 한다.
    signal: AbortSignal.timeout(840_000),
    body: JSON.stringify({
      mode: "evergreen",
      seed: {
        key: seed.key,
        title: seed.title,
        category: seed.category,
        intent: seed.intent,
        keywords: seed.keywords,
        sources: seed.sources,
        description: seed.description,
        isHub: seed.isHub === true,
      },
      source_url: seed.sources[0],
      source_name: "금감원·파인 공공 1차 소스",
      content,
      // 검수 대조용 원문 전문 — 일화뱅크 주입분을 뺀 순수 그라운딩 원문만(원문 대조의 기준이어야 함)
      source_fulltext: sourceFulltext ?? content,
      // 발행 통제: 초안으로만 적재(커밋 D 발행 게이트). 발행은 /admin에서 사람 검수 후 1클릭.
      auto_publish: false,
    }),
  });
  // Vercel 함수 타임아웃/에러 페이지는 JSON이 아닌 텍스트를 반환 (실측: "An error occurred…")
  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    // 진단용: status·Vercel 에러 헤더·본문 전문 (일시 오류/타임아웃 원인 식별)
    console.error(
      `[generate 비JSON 응답] HTTP ${res.status} · x-vercel-error: ${res.headers.get("x-vercel-error") ?? "-"} · x-vercel-id: ${res.headers.get("x-vercel-id") ?? "-"}`
    );
    console.error(raw);
    const err = new Error(`generate 응답이 JSON 아님(HTTP ${res.status}): ${raw.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`generate 실패(${res.status}): ${json.error ?? "unknown"}`);
    err.status = res.status;
    throw err;
  }
  return json; // { article, carousel_warning?, markdown_warning?, needs_human_review?, review_reasons?, high_risk_topics?, usage }
}

/** ⏱️ 라인 — 2단계 분리 후 각 단계가 300초 한도 안에 들어오는지 한눈에 보이게 */
function fmtTiming(t) {
  const s = (ms) => Math.round((ms ?? 0) / 1000);
  const retried = (t.retried_stages ?? []).length ? `재생성 ${t.retried_stages.join("·")}` : "재생성 없음";
  return (
    `⏱️ 생성 ${s(t.total_ms)}초 — 1차 ${s(t.stage1_ms)}초` +
    (t.stage1_retry_ms ? `(+재생성 ${s(t.stage1_retry_ms)}초)` : "") +
    ` · 2차 ${s(t.stage2_ms)}초` +
    (t.stage2_retry_ms ? `(+재생성 ${s(t.stage2_retry_ms)}초)` : "") +
    ` · ${retried} · 단계별 한도 300초`
  );
}

/** ✍️ 문체 라인 — 위반 0이면 "정상", 있으면 첫 위반 필드·비율·샘플 1개. */
function fmtStyle(vs) {
  if (!vs || vs.length === 0) return "✍️ 문체 정상";
  const v = vs[0];
  const more = vs.length > 1 ? ` 외 ${vs.length - 1}` : "";
  const sample = v.samples?.[0] ? ` — "${v.samples[0]}"` : "";
  return `✍️ 문체 위반: ${v.field} ${Math.round((v.ratio ?? 0) * 100)}%${more}${sample}`;
}

/** 📚 근거 라인 — 위반 0이면 "정상"(관측 durable 건수 표기), 있으면 code별 건수 + 샘플 1개. */
function fmtEvidence(issues) {
  const all = issues || [];
  const vs = all.filter((i) => i.level === "violation");
  if (vs.length === 0) {
    const durable = all.filter((i) => i.code === "stale_but_durable").length;
    return `📚 근거 정상${durable ? ` (durable ${durable})` : ""}`;
  }
  const counts = {};
  for (const i of vs) counts[i.code] = (counts[i.code] || 0) + 1;
  const codeStr = Object.entries(counts).map(([c, n]) => `${c} ${n}`).join(" · ");
  const sample = vs[0].claim ? ` — "${String(vs[0].claim).slice(0, 30)}"` : "";
  return `📚 근거 위반: ${codeStr}${sample}`;
}

async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000) }),
  }).catch((e) => console.warn("텔레그램 전송 실패:", e.message));
}

async function sendTelegramDoc(filename, text, caption) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const form = new FormData();
  form.append("chat_id", TELEGRAM_CHAT_ID);
  form.append("caption", caption.slice(0, 1000));
  form.append("document", new Blob([text], { type: "text/plain" }), filename);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
  }).catch((e) => console.warn("텔레그램 전송 실패:", e.message));
}

const shortUrl = (u) => {
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./, "") + x.pathname;
  } catch {
    return u;
  }
};

const todayLabel = () =>
  new Date().toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });

// ────────────────────────────────────────────────────────────────────

async function main() {
  const intent = resolveIntent();
  const seedKey = resolveSeedKey();
  console.log(`[상록수] intent=${intent}${seedKey ? ` · seed=${seedKey}(수동 지정)` : ""}`);

  // 허브글 slug — 시드글 내부링크 대상(M4-2). 미발행/삭제면 삽입만 생략(생성은 계속).
  const { data: hubRow, error: hubErr } = await supabase
    .from("premium_articles")
    .select("slug")
    .eq("seed_key", HUB_SEED_KEY)
    .eq("is_main_published", true)
    .limit(1)
    .maybeSingle();
  const hubSlug = hubRow?.slug ?? null;
  if (!hubSlug) {
    console.warn(
      `[허브링크] 허브 발행본 없음${hubErr ? `(조회 실패: ${hubErr.message})` : ""} — 내부링크 생략`
    );
  }

  // 미생성 시드 = 시드뱅크 − DB에 이미 있는 seed_key
  const { data: doneRows, error: doneErr } = await supabase
    .from("premium_articles")
    .select("seed_key")
    .not("seed_key", "is", null);
  if (doneErr) throw new Error(`seed_key 조회 실패: ${doneErr.message}`);
  const done = new Set((doneRows ?? []).map((r) => r.seed_key));

  const remaining = EVERGREEN_SEEDS.filter((s) => !done.has(s.key));

  // --seed 지정 시 그 시드 하나만 — 허브 우선·intent 필터를 모두 건너뛴다(수동 실행의 의도가 우선)
  let candidates;
  if (seedKey) {
    const target = EVERGREEN_SEEDS.find((s) => s.key === seedKey);
    if (!target) {
      const msg = `❌ 상록수 파이프라인 — 알 수 없는 시드 키 '${seedKey}' (시드뱅크에 없음)`;
      console.error(msg);
      await sendTelegramMessage(msg);
      process.exitCode = 1;
      return;
    }
    if (done.has(seedKey)) {
      const msg = `⚠️ 상록수 파이프라인 — 시드 '${seedKey}'는 이미 생성됨(seed_key 중복). 생성 0건`;
      console.warn(msg);
      await sendTelegramMessage(msg);
      return;
    }
    candidates = [target];
    console.log(`[시드] --seed 지정 — ${target.key} (${target.intent}) 단독 실행`);
  } else {
    const hub = remaining.find((s) => s.isHub);
    candidates = [
      ...(hub ? [hub] : []),
      ...remaining.filter((s) => !s.isHub && s.intent === intent),
    ];
    console.log(`[시드] 전체 ${EVERGREEN_SEEDS.length} · 생성됨 ${done.size} · 오늘 후보 ${candidates.length}`);
  }

  if (!candidates.length) {
    const others = remaining.length;
    const msg = [
      `⚠️ 상록수 파이프라인 (${todayLabel()} · ${intent}) — 생성 0건`,
      others > 0
        ? `사유: '${intent}' 시드 소진 (다른 intent 시드 ${others}개 남음 — --intent로 수동 실행 가능)`
        : "사유: 시드뱅크 전체 소진 — evergreen-seeds.mjs에 시드 추가 필요",
    ].join("\n");
    console.log(msg);
    await sendTelegramMessage(msg);
    return;
  }

  // 그라운딩 실패 시드는 스킵하고 다음 시드로 (§9: 팩트 없는 원고 금지)
  const skipped = []; // { seed, sourceStats }
  for (const seed of candidates) {
    console.log(`[시드 선택] ${seed.key} — ${seed.title}${seed.isHub ? " [허브]" : ""}`);
    const { groundingText, sourceStats } = await buildGrounding(seed);

    if (!groundingText) {
      console.warn(`[스킵] ${seed.key} — 모든 소스 본문 추출 실패`);
      skipped.push({ seed, sourceStats });
      continue;
    }

    // 일화뱅크 — 검증된 실제 상담 패턴만 재료로 주입. 매칭 0건이면 '일화 사용 금지' 지시
    // (모델이 일화를 지어내지 않도록 — CLAUDE.md 일화 날조 금지). 근거 자료 뒤에 붙여
    // route.ts의 사용자 메시지("구체적 사실은 이 안에 있는 것만")에 함께 실린다.
    const anecdote = buildAnecdoteSection(seed.key);
    const contentWithAnecdotes = `${groundingText}\n\n────\n\n${anecdote.section}`;

    let gen;
    try {
      console.log(
        `[생성] groundingText ${groundingText.length}자 + 일화 ${anecdote.count}건으로 팩토리 호출`
      );
      gen = await generateEvergreen(seed, contentWithAnecdotes, groundingText);
    } catch (err) {
      if (err.status === 409) {
        // 시드 중복(경합 등) — 소모된 것으로 보고 다음 시드로
        console.warn(`[스킵] ${seed.key} — ${err.message}`);
        skipped.push({ seed, sourceStats, reason: err.message });
        continue;
      }
      const msg = `❌ 상록수 파이프라인 (${todayLabel()} · ${intent}) — 생성 실패\n시드: ${seed.key} — ${seed.title}\n${err.message}`;
      console.error(msg);
      await sendTelegramMessage(msg);
      throw err;
    }

    // 실측 지표 — 저장된 행 기준 (글자수·H2·카드·FAQ·verify_claims)
    const { data: full } = await supabase
      .from("premium_articles")
      .select(
        "title, naver_title, blogspot_title, category, main_website_markdown, carousel_json, faq_json, naver_blog_content, blogspot_content, needs_human_review, verify_claims"
      )
      .eq("id", gen.article.id)
      .single();

    // 허브 내부링크 삽입(M4-2) — 허브글 자신은 제외. 실측 지표·발행 대기함이 삽입본 기준이 되도록
    // 지표 계산 전에 수행하고, 성공 시 full.main_website_markdown을 삽입본으로 교체한다.
    let hubLinkNote = "";
    if (seed.key !== HUB_SEED_KEY && full) {
      if (!hubSlug) {
        hubLinkNote = "⚠️ 허브 미발행 — 내부링크 생략";
      } else {
        const injected = injectHubLink(full.main_website_markdown, hubSlug);
        if (injected === null) {
          hubLinkNote = `🔗 허브 내부링크 이미 있음(/news/${hubSlug}) — 삽입 생략`;
        } else {
          const { error: linkErr } = await supabase
            .from("premium_articles")
            .update({ main_website_markdown: injected })
            .eq("id", gen.article.id);
          if (linkErr) {
            hubLinkNote = `⚠️ 허브 내부링크 UPDATE 실패: ${linkErr.message}`;
          } else {
            full.main_website_markdown = injected;
            hubLinkNote = `🔗 허브 내부링크 삽입(/news/${hubSlug})`;
          }
        }
      }
      console.log(`[허브링크] ${hubLinkNote}`);
    }

    const md = full?.main_website_markdown ?? "";
    const h2 = (md.match(/^##\s/gm) ?? []).length;
    const cards = Array.isArray(full?.carousel_json) ? full.carousel_json.length : 0;
    const faqs = Array.isArray(full?.faq_json) ? full.faq_json.length : 0;
    const claims = Array.isArray(full?.verify_claims) ? full.verify_claims : [];
    const lowClaims = claims.filter((c) => c?.confidence === "low").length;

    const lines = [
      `✅ 상록수 파이프라인 (${todayLabel()} · ${intent}) — 1건 생성(초안)`,
      `🌲 시드: ${seed.key}${seed.isHub ? " [허브]" : ""} — ${gen.article.title}`,
      `📚 그라운딩:`,
      ...sourceStats.map((s) =>
        s.ok ? ` · ✓ ${shortUrl(s.url)} (${s.chars.toLocaleString()}자)` : ` · ✗ ${shortUrl(s.url)} — ${s.reason}`
      ),
      `📝 본문 ${md.length.toLocaleString()}자 · H2 ${h2}개 · 카드 ${cards}장 · FAQ ${faqs}개 · verify_claims ${claims.length}건${lowClaims ? ` (low ${lowClaims}건⚠️)` : ""}`,
    ];
    if (hubLinkNote) lines.push(hubLinkNote);
    lines.push(anecdote.count ? `🧾 일화: ${anecdote.count}건 주입` : "🧾 일화: 없음(금지 지시)");
    if (gen.carousel_warning) lines.push(`⚠️ 카드 검증: ${gen.carousel_warning}`);
    if (gen.markdown_warning) lines.push(`⚠️ 원고 검증: ${gen.markdown_warning}`);
    // 고위험 주제(분쟁·판례·세법·의료) — 발행 전 원문 대조 필수
    if (gen.high_risk_topics?.length) {
      lines.push(`⚖️ 고위험 주제: ${gen.high_risk_topics.join("·")} — 원문 대조 후 발행`);
    }
    // ⏱️ 단계별 소요 — 300초(Hobby 함수 한도) 대비 여유와, 어느 단계가 재생성을 부르는지 관측
    if (gen.timing) lines.push(fmtTiming(gen.timing));
    // 💾 캐시 적중 — 0/0이면 캐싱 미작동 신호이므로 숨기지 않는다
    if (gen.usage) {
      const w = gen.usage.cache_creation_input_tokens ?? 0;
      const r = gen.usage.cache_read_input_tokens ?? 0;
      lines.push(
        `💾 캐시: 쓰기 ${w.toLocaleString()} · 읽기 ${r.toLocaleString()} 토큰` +
          (w === 0 && r === 0 ? " ⚠️ 캐싱 미작동" : "")
      );
    }
    // ✍️ 문체 관측 — 항상 출력(위반 0이면 '정상'). 조용하면 게이트 작동 여부를 알 수 없으므로.
    lines.push(fmtStyle(gen.style_violations));
    // 📚 근거 관측 — 항상 출력(위반 0이면 '정상').
    lines.push(fmtEvidence(gen.evidence_issues));
    lines.push(
      full?.needs_human_review
        ? `🔴 사람 검수 필수: ${gen.review_reasons ?? "needs_human_review=true"}`
        : `🟢 하드 룰 트리거 없음 (그래도 발행 전 1회 검수)`
    );
    for (const s of skipped) {
      lines.push(`⏭️ 스킵된 시드: ${s.seed.key} — ${s.reason ?? "모든 소스 본문 추출 실패"}`);
    }
    lines.push(`심의 대기: ${SITE_URL}/admin 에서 검수 → 광고심의 신청 → 승인 후 발행`);
    const summary = lines.join("\n");
    console.log(`\n──── 상록수 요약 ────\n${summary}`);
    await sendTelegramMessage(summary);

    // 네이버/블로그스팟 발행 대기함 (뉴스 파이프라인과 동일 포맷)
    if (full) {
      await sendTelegramDoc(
        `naver-${gen.article.slug}.txt`,
        `${full.naver_title ?? full.title}\n\n${full.naver_blog_content}`,
        `📝 [상록수] 네이버 블로그 발행 대기\n${full.naver_title ?? full.title}\n\n본진: ${SITE_URL}/news/${gen.article.slug}\n파일 내용을 복사해 네이버 블로그에 붙여넣으세요.`
      );
      await sendTelegramDoc(
        `blogspot-${gen.article.slug}.txt`,
        `${full.blogspot_title ?? full.title}\n\n${full.blogspot_content}`,
        `📝 [상록수] 블로그스팟 발행 대기\n${full.blogspot_title ?? full.title}`
      );
    }
    return; // 주 2회 리듬 — 실행당 1편
  }

  // 후보 전부 스킵 — 0건 + 사유 명시 (커밋 G 관측성 포맷)
  const lines = [
    `⚠️ 상록수 파이프라인 (${todayLabel()} · ${intent}) — 생성 0건 (후보 ${candidates.length}건 전부 그라운딩 실패)`,
  ];
  for (const s of skipped) {
    lines.push(`⏭️ ${s.seed.key} — ${s.reason ?? "모든 소스 본문 추출 실패"}:`);
    for (const st of s.sourceStats) {
      lines.push(st.ok ? ` · ✓ ${shortUrl(st.url)}` : ` · ✗ ${shortUrl(st.url)} — ${st.reason}`);
    }
  }
  lines.push("→ 소스 URL 구조 변경 여부 확인 필요 (evergreen-seeds.mjs)");
  const summary = lines.join("\n");
  console.log(`\n──── 상록수 요약 ────\n${summary}`);
  await sendTelegramMessage(summary);
}

// 직접 실행일 때만 main 구동 — injectHubLink를 import해도 파이프라인이 돌지 않게(검증용)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
