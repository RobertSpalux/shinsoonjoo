/**
 * 매일 새벽 원천 뉴스 수집 → OSMU 팩토리 호출 → 텔레그램 발행 대기함 전송.
 *
 * 1. 금융감독원 보도자료·경제 뉴스 RSS에서 최신 기사 수집
 * 2. 이미 처리한 URL(raw_source_url) 제외 후 상위 N건 선택
 * 3. 사이트의 /api/factory/generate 호출 (Claude 멀티 문체 생성 + DB 적재 + 자동 발행)
 * 4. 네이버 블로그용 원고를 텔레그램으로 전송 (복사-붙여넣기 발행 대기함)
 *
 * 필요 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   SITE_URL, FACTORY_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
import Parser from "rss-parser";
import { createClient } from "@supabase/supabase-js";

const {
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SITE_URL = "https://goodfinance.kr",
  FACTORY_SECRET,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
} = process.env;

const DAILY_LIMIT = Number(process.env.DAILY_ARTICLE_LIMIT ?? 2);

/**
 * 원천 소스 — 실패해도 다음 소스로 넘어감. 소스 규칙은 CONTENT-STRATEGY §9(공공 1차 소스만 재가공,
 * 민간 보험 매체 금지). 금감원·파인 게시판은 RSS가 없어 목록 HTML 파싱(구 RSS는 죽어 HTML 에러 페이지 반환).
 * boost: 선정 순서에서 보험 특화 소스를 상위로 (게이트 점수에는 불포함 — RELEVANCE_MIN 판정은 원점수).
 * category: 팩토리에 주는 분류 힌트 (최종 분류는 모델의 6-카테고리 enum).
 */
const SOURCES = [
  // 보험 특화 공공 소스 (인증키 불필요 · 공개 게시판)
  { name: "금융꿀팁 200선", type: "board", url: "https://www.fss.or.kr/fss/bbs/B0000173/list.do?menuNo=200498", category: "보험료 절약·꿀팁", boost: 6 },
  { name: "금융소비자경보", type: "board", url: "https://www.fss.or.kr/fss/bbs/B0000175/list.do?menuNo=200204", category: "보험금 청구·보상", boost: 6 },
  { name: "파인 생활금융톡톡", type: "board", url: "https://fine.fss.or.kr/fine/bbs/B0000341/list.do?menuNo=900023", category: "보험료 절약·꿀팁", boost: 5 },
  { name: "파인 민원사례", type: "board", url: "https://fine.fss.or.kr/fine/bbs/B0000343/list.do?menuNo=900025", category: "보험금 청구·보상", boost: 5 },
  { name: "금감원 보도자료", type: "board", url: "https://www.fss.or.kr/fss/bbs/B0000188/list.do?menuNo=200218", category: "금융·경제 뉴스", boost: 4 },
  // 커밋 O10-B — 정찰(O10-A) '붙인다' 판정 2종. 손보협회·보험연구원은 보류(O9 통과율 관찰 후),
  // 생보협회(JS POST·월 0~1건)·건보공단(robots가 /nhis/ 전체 Disallow)은 탈락 확정.
  // ⚠️ 복지부는 의료 제도·의료비 기사 원료 — 검수 배율 원칙(의료 수치 = 사람검수 필수) 적용 대상.
  //    RSS description이 1,400자대 실본문(2026-07-13 실측). robots에 이 RSS 경로가 명시 허용됨.
  { name: "복지부 보도자료", type: "rss", url: "https://www.mohw.go.kr/rss/board.es?mid=a10503000000&bid=0027", category: "보험료 절약·꿀팁", boost: 1 },
  // 금융위: 상세 HTML 본문 직수확(실측 2,291~8,132자), 짧으면 PDF 폴백(O3). 소비자 정책 발원지 —
  // 무관 기사(MOU·총회·인사)는 O9 게이트가 거른다. 카드뉴스(no040101)는 보도자료 안착 후 검토.
  { name: "금융위 보도자료", type: "fsc-board", url: "https://www.fsc.go.kr/no010101", category: "금융·경제 뉴스", boost: 2 },
  // 일반 경제 RSS (신선도용 — 보험 소스보다 후순위)
  { name: "연합뉴스 경제", type: "rss", url: "https://www.yna.co.kr/rss/economy.xml", category: "금융·경제 뉴스", boost: 0 },
  { name: "연합뉴스 금융", type: "rss", url: "https://www.yna.co.kr/rss/market.xml", category: "금융·경제 뉴스", boost: 0 },
];

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const parser = new Parser({ timeout: 15000 });

const UA = "Mozilla/5.0 (compatible; GoodFinancePipeline/1.0)";
const PER_SOURCE_LIMIT = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** HTML 엔티티 최소 디코드 (게시판 제목·본문용) */
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

/**
 * 깨진 RSS 방어 — ① HTML 에러 페이지 응답 감지(구 금감원 RSS 사례) ② 파싱 실패 시
 * 불량 엔티티(& 미이스케이프)를 sanitize 후 1회 재파싱. 그래도 실패하면 throw → 소스 "실패" 기록.
 */
async function fetchRssItems(url) {
  const raw = await fetchText(url);
  if (/^\s*(<!DOCTYPE\s+html|<html)/i.test(raw)) {
    throw new Error("RSS 대신 HTML 응답(피드 사망/에러 페이지)");
  }
  try {
    return (await parser.parseString(raw)).items ?? [];
  } catch {
    const sanitized = raw.replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g, "&amp;");
    return (await parser.parseString(sanitized)).items ?? [];
  }
}

/**
 * 금감원/파인 게시판 목록 파싱 — <td class="title"><a href="…view.do?nttId=…">제목</a></td>
 * + 행 뒤쪽의 YYYY-MM-DD를 날짜로. 본문은 나중에(hydrate) 상세 페이지에서 채움.
 */
async function fetchBoardItems(source) {
  const html = await fetchText(source.url);
  const origin = new URL(source.url).origin;
  const items = [];
  const re = /<td class="title">\s*<a href="([^"]*view\.do[^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>/g;
  let m;
  while ((m = re.exec(html)) !== null && items.length < PER_SOURCE_LIMIT) {
    const href = decodeEntities(m[1]);
    const title = decodeEntities(m[2].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
    if (!title) continue;
    const dateMatch = html.slice(m.index, m.index + 800).match(/\d{4}-\d{2}-\d{2}/);
    items.push({
      title,
      link: href.startsWith("http") ? href : `${origin}${href}`,
      content: "", // hydrate 단계에서 상세 본문 채움 (신규 항목만 — 요청 절약)
      needsDetail: true,
      source: source.name,
      category: source.category,
      boost: source.boost,
      pubDate: dateMatch ? dateMatch[0] : null,
    });
  }
  if (!items.length) throw new Error("목록에서 게시글을 찾지 못함(페이지 구조 변경?)");
  return items;
}

/**
 * 금융위 보도자료 목록 파싱 (커밋 O10-B) — 금감원 계열(view.do?nttId=)과 달리
 * 상세 링크가 경로형(/no010101/{id})이라 파서를 분기한다.
 * 링크의 쿼리(srchCtgry·curPage 등)는 비식별 파라미터 — 제거하고 경로만 남겨 URL을 정규화
 * (raw_source_url 중복제거·blocked_sources 대조가 실행마다 흔들리지 않게).
 */
async function fetchFscBoardItems(source) {
  const html = await fetchText(source.url);
  const origin = new URL(source.url).origin;
  const basePath = new URL(source.url).pathname; // /no010101
  const items = [];
  const seen = new Set();
  const re = new RegExp(`<a[^>]+href="(${basePath}/(\\d+)[^"]*)"[^>]*>([\\s\\S]{0,250}?)</a>`, "g");
  let m;
  while ((m = re.exec(html)) !== null && items.length < PER_SOURCE_LIMIT) {
    const id = m[2];
    const title = decodeEntities(m[3].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
    if (title.length < 10 || seen.has(id)) continue; // 첨부파일명 앵커 등 잡음 제외
    seen.add(id);
    const dateMatch = html.slice(m.index, m.index + 3000).match(/\d{4}-\d{2}-\d{2}/);
    items.push({
      title,
      link: `${origin}${basePath}/${id}`, // 쿼리 제거한 정규화 URL
      content: "",
      needsDetail: true,
      fscDetail: true, // hydrate에서 금융위 전용 본문 추출로 분기
      source: source.name,
      category: source.category,
      boost: source.boost,
      pubDate: dateMatch ? dateMatch[0] : null,
    });
  }
  if (!items.length) throw new Error("목록에서 게시글을 찾지 못함(페이지 구조 변경?)");
  return items;
}

/**
 * 금융위 상세 본문 — HTML 직수확 (커밋 O10-B, 정찰 실측 2,291~8,132자).
 * 본문 구간: 페이지 텍스트에서 마지막 "인쇄하기"(공유 툴바 끝) 이후 ~ 첨부/목록 블록 이전.
 * 마커가 없으면 전체 텍스트로 폴백. 300자 미만이면 첨부 PDF 폴백(O3 공용) 시도.
 */
async function fetchFscBody(link) {
  const html = await fetchText(link);
  const full = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

  const start = full.lastIndexOf("인쇄하기");
  let scoped = start >= 0 ? full.slice(start + "인쇄하기".length) : full;
  let end = scoped.length;
  for (const marker of ["첨부파일 (", "목록으로", "콘텐츠 내용에 만족하셨나요"]) {
    const i = scoped.indexOf(marker);
    if (i > 0 && i < end) end = i;
  }
  const body = scoped.slice(0, end).trim().slice(0, 4000);

  if (body.length < 300) {
    const pdf = await extractPdfAttachment(html, link);
    if (pdf) return pdf;
    return body.length >= 80 ? body : ""; // fetchBoardBody와 동일한 80자 스텁 하한 — 미달이면 noBody 스킵
  }
  return body;
}

/**
 * 게시글 상세 본문 추출 — <div class="dbdata"> 내부 텍스트 + img alt 폴백 (커밋 O2).
 * 파인 게시판(톡톡·민원사례·꿀팁)은 이미지형이지만 img alt에 전문이 들어 있다(2026-07-12 실측,
 * CONTENT-STRATEGY §9-2). 텍스트 본문이 최소 길이 미달일 때만 alt를 폴백으로 수확한다.
 * ⚠️ 장식용 alt('이미지'·'사진' 등)는 20자 필터로 걸러지며, 그래도 짧으면 빈 문자열 반환
 * → 호출부에서 스킵(폴백 금지 원칙 — 팩트 없는 원고 방지). PDF 첨부형(alt도 없음)은 여전히 스킵.
 * ⚠️ generate-evergreen.mjs의 fetchBoardBody와 같은 로직 — 한쪽을 고치면 함께 갱신할 것.
 * (금감원 오픈API는 2026-07-13 실측 결과 contentsKor가 비어 있어 본문 소스로 쓸 수 없음)
 */
async function fetchBoardBody(link) {
  const html = await fetchText(link);
  const start = html.indexOf('class="dbdata"');
  if (start === -1) return "";
  const chunk = html.slice(start, start + 60000); // 이미지형은 dbdata div가 여러 개 이어짐
  const end = chunk.search(/class="bd-view-nav"|담당부서/);
  const scoped = end > 0 ? chunk.slice(0, end) : chunk;

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

  // 텍스트 본문이 충분하면 그대로, 미달이면 img alt 수확 폴백 (소스 1건당 ~2,000자 실측)
  let text = stripped;
  if (stripped.length < 300) {
    const altTexts = [...scoped.matchAll(/<img[^>]*\salt=["']([^"']+)["']/gi)]
      .map((m) => decodeEntities(m[1]).replace(/\s+/g, " ").trim())
      .filter((t) => t.length >= 20);
    text = [stripped, ...altTexts].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  text = text.slice(0, 4000);

  // 스텁 판정: 사실상 "첨부파일 보세요"뿐인 본문 → 3차 폴백(PDF 첨부)으로 마지막 시도
  if (text.length < 80 || (/첨부\s*파일.*(참고|참조)/.test(text) && text.length < 200)) {
    return await extractPdfAttachment(html, link);
  }
  return text;
}

/**
 * 3차 폴백 (커밋 O3): 상세 페이지의 .pdf 첨부에서 텍스트 추출 — 보도자료(PDF 첨부형) 회수.
 * O2-B 실측: 보도자료 PDF는 텍스트 레이어 존재(2건 4,753~5,677자, 스캔 아님).
 * - .pdf만 선별 (HWP/HWPX 스킵 — 꿀팁200선은 이 경로로 회수 불가, 별도 난제)
 * - 첨부 여러 개면 라벨의 파일크기 힌트로 가장 큰 PDF 1개만 (보도자료 본문이 보통 최대 파일)
 * - 다운로드 10초 / 파싱 10초 타임아웃 — 초과 시 스킵하고 다음 건으로
 * - 300자 미만이면 여전히 '본문없음' 처리 (폴백 금지 원칙)
 * - 자간 문제로 일부 공백이 붙지만 LLM 그라운딩 원료로는 지장 없어 정규화하지 않는다
 * ⚠️ raw_source_url은 게시글 URL 그대로다(호출부 불변) — 중복제거·차단목록이 계속 작동한다.
 */
async function extractPdfAttachment(detailHtml, pageUrl) {
  // fileDown.do = 금감원 계열 / /comm/getFile = 금융위 (커밋 O10-B)
  const anchors = [...detailHtml.matchAll(/href="([^"]*(?:fileDown\.do|\/comm\/getFile)[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => ({
      href: decodeEntities(m[1]),
      label: decodeEntities(m[2].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(),
    }))
    .filter((a) => /\.pdf\b/i.test(a.label));
  if (!anchors.length) return "";

  // 라벨의 "파일크기 : n KB/MB" 힌트로 최대 PDF 선택 (힌트 없으면 첫 번째)
  const sizeOf = (label) => {
    const m = label.match(/파일크기\s*:?\s*([\d.,]+)\s*(KB|MB|GB)?/i);
    if (!m) return 0;
    const n = parseFloat(m[1].replace(/,/g, ""));
    const unit = (m[2] ?? "").toUpperCase();
    return n * (unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : unit === "KB" ? 1024 : 1);
  };
  anchors.sort((a, b) => sizeOf(b.label) - sizeOf(a.label));
  const pdfUrl = new URL(anchors[0].href, pageUrl).toString();

  let timer;
  let parser;
  try {
    const res = await fetch(pdfUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return "";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.subarray(0, 5).toString() !== "%PDF-") return "";
    // pdf-parse v2 API (PDFParse 클래스) — 워크플로에서 pdf-parse@2로 버전 고정
    const { PDFParse } = await import("pdf-parse");
    parser = new PDFParse({ data: new Uint8Array(buf) });
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error("PDF 파싱 10초 초과")), 10000);
    });
    const parsed = await Promise.race([parser.getText(), timeout]);
    const text = String(parsed.text ?? "").replace(/\s+/g, " ").trim().slice(0, 4000);
    if (text.length < 300) return ""; // 팩트 부족 — 본문없음 유지
    console.log(`  [PDF 폴백 ✓] ${anchors[0].label.slice(0, 40)} (${text.length}자)`);
    return text;
  } catch (err) {
    console.warn(`  [PDF 폴백 실패] ${pageUrl}: ${err.message}`);
    return "";
  } finally {
    clearTimeout(timer);
    await parser?.destroy?.().catch(() => undefined);
  }
}

async function collectCandidates() {
  const items = [];
  const sourceStats = []; // 관측용: 소스별 수집 건수·실패 (텔레그램 요약에 실림)
  for (const source of SOURCES) {
    try {
      let collected = [];
      if (source.type === "board") {
        collected = await fetchBoardItems(source);
      } else if (source.type === "fsc-board") {
        collected = await fetchFscBoardItems(source);
      } else {
        const feedItems = await fetchRssItems(source.url);
        for (const item of feedItems.slice(0, PER_SOURCE_LIMIT)) {
          if (!item.link || !item.title) continue;
          collected.push({
            title: item.title.trim(),
            link: item.link,
            content: (item.contentSnippet || item.content || item.summary || "").trim(),
            needsDetail: false,
            source: source.name,
            category: source.category,
            boost: source.boost,
            pubDate: item.isoDate ?? item.pubDate ?? null,
          });
        }
      }
      items.push(...collected);
      sourceStats.push({ name: source.name, count: collected.length, failed: false });
      console.log(`[수집] ${source.name}: ${collected.length}건`);
      await sleep(300); // 소스 간 딜레이 (공공 사이트 예의)
    } catch (err) {
      sourceStats.push({ name: source.name, count: 0, failed: true });
      console.warn(`[수집 실패] ${source.name}: ${err.message}`);
    }
  }
  return { items, sourceStats };
}

/**
 * 게시판 항목 본문 채우기 — 기처리·중복 제거 후 남은 신규 항목만 (요청 최소화 + 딜레이).
 * 본문 확보 실패(첨부형·이미지형·오류)한 항목은 noBody 마킹 → 후보에서 제외(호출부).
 */
async function hydrateBoardItems(items) {
  for (const item of items) {
    if (!item.needsDetail) continue;
    try {
      const body = item.fscDetail ? await fetchFscBody(item.link) : await fetchBoardBody(item.link);
      if (body) {
        item.content = body;
      } else {
        item.noBody = true;
        console.warn(`[본문 없음 → 스킵] ${item.title} (첨부/이미지형)`);
      }
    } catch (err) {
      item.noBody = true;
      console.warn(`[본문 실패 → 스킵] ${item.title}: ${err.message}`);
    }
    await sleep(400); // 상세 요청 간 딜레이
  }
  return items;
}

async function filterProcessed(items) {
  const urls = items.map((i) => i.link);
  const { data } = await supabase
    .from("premium_articles")
    .select("raw_source_url")
    .in("raw_source_url", urls);
  const seen = new Set((data ?? []).map((r) => r.raw_source_url));

  // 소스 차단목록 (커밋 O1) — 기사를 삭제해도 재생성되지 않게 하는 영구 차단.
  // raw_source_url 대조는 행 삭제 시 부활하는 버그가 있어(부당승환 재생성 사고) 별도 테이블로 막는다.
  const { data: blocked, error: blockedErr } = await supabase
    .from("blocked_sources")
    .select("url")
    .in("url", urls);
  if (blockedErr) {
    console.warn(`blocked_sources 조회 실패(차단 없이 진행): ${blockedErr.message}`);
  }
  let blockedCount = 0;
  for (const b of blocked ?? []) {
    if (!seen.has(b.url)) blockedCount++;
    seen.add(b.url);
  }
  if (blockedCount > 0) console.log(`[차단목록] ${blockedCount}건 제외`);

  return items.filter((i) => !seen.has(i.link));
}

/** 관련성 하한선 — 이 점수 미만이면 발행하지 않는다 (없는 날은 적게 나가게) */
const RELEVANCE_MIN = Number(process.env.RELEVANCE_MIN ?? 10);

/**
 * 보험·금융 소비자 관련성 스코어 — 3축 재구성 (커밋 O9).
 * 실측 결함: '보험' 토큰만으로 통과 → "상생보험·은행대리업 지역금융"이 33점 통과
 * (전국구 위반 + 소비자 접점 없음). M3-1의 불용 토큰 원리를 뉴스 게이트에도 적용.
 *
 * A) 불용 토큰 — 보험·금융·가입·계약·상품·안내·시행·발표는 단독으로 점수를 받지 못한다(목록 제외).
 * B) 소비자 접점 가점 — 기준: "소비자가 자기 계약·자기 돈에 대해 행동하거나 알아야 할 내용인가".
 *    6개 카테고리 전부 커버(리모델링만 통과시키면 문을 스스로 좁힌다).
 *    ⚠️ 소비자 접점 토큰 최소 1개 매치 필수 — 미달 시 컷(감독·금리 문맥 점수만으로는 통과 불가).
 * C) 감점 — off-topic + 지역 고정(전국구 원칙, 지역명은 제목 기준) + 공급자 내부 관점(인사·MOU·시상·실적).
 *    (O1 금지소재 하드 게이트와 별개 축 — O1은 컴플라이언스, 이것은 관련성)
 */

// B) 소비자 접점 토큰 — 카테고리별 그룹. 여기 1개도 안 걸리면 컷.
const CONSUMER_TOKENS = [
  // 보험료 절약·꿀팁
  ["보험료", 10], ["할인", 6], ["절약", 6], ["꿀팁", 6], ["납입면제", 8],
  ["인상", 5], ["인하", 5], ["병원비", 6],
  // 보험금 청구·보상
  ["보험금", 12], ["청구", 8], ["지급", 6], ["부지급", 10], ["환급", 7],
  ["소비자경보", 10], ["사기", 7], ["민원", 5], ["피해", 5],
  // 실손·보장성 가이드
  ["실손", 10], ["보장", 8], ["약관", 8], ["갱신", 7], ["특약", 7], ["면책", 7],
  ["해지", 7], ["자기부담", 7], ["자동차보험", 9], ["진단비", 8], ["암보험", 8],
  // 연금·노후·세테크
  ["연금", 7], ["노후", 6], ["IRP", 7], ["ISA", 6], ["세액공제", 7],
  ["상속", 6], ["증여", 5], ["공시이율", 8],
  // 보험 리모델링
  ["리모델링", 10], ["중복가입", 9], ["갈아타기", 8], ["승환", 8],
  // 공통 소비자 신호
  ["소비자", 5], ["분쟁", 7], ["가입자", 5],
];

// 문맥 보조 토큰 — 점수는 주되 '소비자 접점' 요건은 충족 못 함 (감독기관·시장 문맥)
const CONTEXT_TOKENS = [
  ["금감원", 8], ["금융감독", 8], ["보험사", 6], ["손해율", 6],
  ["기준금리", 5], ["금리", 4], ["대출", 4], ["예금", 3], ["가계", 3],
];

// C-1) off-topic 감점 (기존 유지)
const OFFTOPIC_PENALTIES = [
  ["주가", 6], ["증시", 6], ["코스피", 6], ["코스닥", 6], ["상장", 5],
  ["코인", 6], ["가상자산", 6], ["부동산", 4], ["아파트", 4], ["분양", 4],
  ["와인", 8], ["편의점", 5], ["게임", 5], ["연예", 8], ["스포츠", 8],
];

// C-2) 지역 고정 강감점 — 전국구 원칙. 본문의 지역 언급은 흔하므로(전국 제도의 지역 시행 사례)
// 지역명은 '제목 기준'으로만 판단, 지역금융·상생·지자체류는 전문 기준.
const REGION_NAMES = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
];
const REGIONAL_PENALTIES = [
  ["지역금융", 10], ["상생", 8], ["지자체", 8], ["지역경제", 8],
];

// C-3) 공급자 내부 관점 강감점 — 기관 인사·조직·행사·실적. 소비자가 행동할 내용이 없다.
// ⚠️ '수상'은 넣지 않는다 — 소비자경보 단골 표현 "수상한 거래/전화"에 오탐(시상·공모전으로 충분).
const SUPPLIER_PENALTIES = [
  ["취임", 8], ["임명", 6], ["위촉", 6], ["이사회", 6], ["조직개편", 8],
  ["업무협약", 8], ["MOU", 8], ["포럼", 6], ["세미나", 5], ["간담회", 5],
  ["시상", 7], ["공모전", 6], ["채용", 6], ["출범", 5],
];

function relevanceScore(item) {
  const text = `${item.title} ${item.content}`;
  const title = String(item.title ?? "");

  const sum = (tokens, target) => tokens.reduce((acc, [kw, w]) => acc + (target.includes(kw) ? w : 0), 0);
  const consumerScore = sum(CONSUMER_TOKENS, text);
  const contextScore = sum(CONTEXT_TOKENS, text);
  const penalty =
    sum(OFFTOPIC_PENALTIES, text) +
    sum(REGIONAL_PENALTIES, text) +
    sum(SUPPLIER_PENALTIES, text) +
    (REGION_NAMES.some((r) => title.includes(r)) ? 8 : 0); // 지역명은 제목 기준

  const score = consumerScore + contextScore - penalty;

  // B) 소비자 접점 0개 = 무조건 컷 — '보험/금감원/금리' 문맥만으로는 통과 불가 (O9 핵심)
  if (consumerScore === 0) return Math.min(score, RELEVANCE_MIN - 1);
  return score;
}

/** 같은 배치 안의 URL·제목 중복 제거 (DB엔 없지만 이번 수집분끼리 겹치는 경우) */
function dedupeBatch(items) {
  const seenUrl = new Set();
  const seenTitle = new Set();
  const out = [];
  for (const it of items) {
    // ⚠️ 게시판 링크는 쿼리(nttId)가 곧 식별자 — 쿼리 전체를 버리면 게시판당 1건만 남는 버그.
    // pageIndex 같은 비식별 파라미터만 제거하고 나머지는 유지한다.
    const urlKey = (() => {
      try {
        const u = new URL(it.link);
        u.searchParams.delete("pageIndex");
        u.searchParams.sort();
        return `${u.origin}${u.pathname}?${u.searchParams.toString()}`;
      } catch {
        return (it.link || "").trim();
      }
    })();
    const titleKey = (it.title || "").replace(/\s+/g, "").slice(0, 40);
    if (seenUrl.has(urlKey) || seenTitle.has(titleKey)) continue;
    seenUrl.add(urlKey);
    seenTitle.add(titleKey);
    out.push(it);
  }
  return out;
}

async function generateArticle(item) {
  const res = await fetch(`${SITE_URL}/api/factory/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-factory-secret": FACTORY_SECRET,
    },
    body: JSON.stringify({
      title: item.title,
      category: item.category,
      source_url: item.link,
      source_name: item.source,
      content: `${item.title}\n\n${item.content}`,
      // 발행 통제: 자동 수집·생성분은 초안으로만 적재. 발행은 /admin에서 사람 검수 후 1클릭.
      auto_publish: false,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`generate 실패(${res.status}): ${json.error ?? "unknown"}`);
  // carousel_warning: 카드 검증 가드(route.ts)가 재시도 후에도 실패하면 사유를 실어 보냄
  // high_risk_topics / review_reasons: 고위험 주제·사람 검수 게이트 관측용
  return {
    article: json.article,
    carousel_warning: json.carousel_warning ?? null,
    needs_human_review: json.needs_human_review === true,
    review_reasons: json.review_reasons ?? null,
    high_risk_topics: json.high_risk_topics ?? null,
  };
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

/** 파이프라인 요약 알림 — 매일 아침 이것만 보고 "왜 글이 없는지/소스가 부실한지" 판단 가능해야 함 */
function buildSummary({ sourceStats, collected, alreadyProcessed, batchDupes, noBodySkipped, passed, picked, cut, results, failures }) {
  const today = new Date().toLocaleDateString("ko-KR", {
    month: "numeric", day: "numeric", timeZone: "Asia/Seoul",
  });
  const lines = [];

  if (results.length > 0) {
    lines.push(`✅ OSMU 파이프라인 (${today}) — 기사 ${results.length}건 생성(초안)`);
  } else if (picked.length > 0) {
    lines.push(`⚠️ OSMU 파이프라인 (${today}) — 게이트 통과 ${picked.length}건 전부 생성 실패`);
  } else {
    lines.push(`⚠️ OSMU 파이프라인 (${today}) — 오늘 적합 기사 없음(소스 부실). 기사 0건`);
  }

  const srcLine = sourceStats
    .map((s) => `${s.name.replace(/^연합뉴스 /, "연합")} ${s.failed ? "실패" : s.count}`)
    .join(" · ");
  lines.push(`📥 수집: ${collected}건 (${srcLine})`);
  lines.push(
    `🚧 게이트(하한 ${RELEVANCE_MIN}점): 통과 ${passed.length} → 선정 ${picked.length}(한도 ${DAILY_LIMIT}) / 컷 ${cut.length}` +
      ` — 제외 ${alreadyProcessed + batchDupes + noBodySkipped}건(기처리 ${alreadyProcessed}·중복 ${batchDupes}·본문없음 ${noBodySkipped})`
  );
  if (cut.length) {
    lines.push(`✂️ 컷 상위 ${Math.min(cut.length, 5)}건:`);
    cut.slice(0, 5).forEach((i) => lines.push(` · ${i.score}점 — ${i.title.slice(0, 45)}`));
  }
  if (results.length) {
    lines.push(`📝 생성:`);
    results.forEach((r) => {
      lines.push(
        ` · [${r.category}] ${r.title.slice(0, 40)} (관련도 ${r.score}, 카드 ${r.cards}장)` +
          (r.warning ? `\n   ⚠️ 카드 검증: ${r.warning}` : "") +
          // 고위험 주제(분쟁·판례·세법·의료) — 발행 전 원문 대조 필수
          (r.riskTopics?.length ? `\n   ⚖️ 고위험 주제: ${r.riskTopics.join("·")} — 원문 대조 후 발행` : "") +
          (r.needsReview ? `\n   🔴 사람 검수 필수: ${r.reviewReasons ?? "needs_human_review=true"}` : "")
      );
    });
    lines.push(`발행 대기: ${SITE_URL}/admin 에서 검수 후 [발행]`);
  }
  if (failures.length) {
    lines.push(`❌ 생성 실패 ${failures.length}건:`);
    failures.forEach((f) => lines.push(` · ${f.title.slice(0, 40)} — ${f.error.slice(0, 80)}`));
  }
  return lines.join("\n");
}

async function main() {
  const { items: candidates, sourceStats } = await collectCandidates();
  const fresh = await filterProcessed(candidates);
  const deduped = dedupeBatch(fresh);
  const alreadyProcessed = candidates.length - fresh.length; // DB에 이미 있는 URL
  const batchDupes = fresh.length - deduped.length; // 이번 배치 내 URL·제목 중복
  // 게시판 항목은 여기서 상세 본문을 채운다 (중복 제거 후 신규만 → 요청 최소화, 스코어는 본문 포함으로)
  await hydrateBoardItems(deduped);
  const usable = deduped.filter((i) => !i.noBody);
  const noBodySkipped = deduped.length - usable.length; // 첨부/이미지형 — 본문 없어 생성 불가
  const scoredAll = usable.map((i) => ({ ...i, score: relevanceScore(i) }));

  // 게이트 판정은 원점수(RELEVANCE_MIN) — boost는 통과분의 '선정 순서'에만 반영(보험 특화 소스 우선)
  const passed = scoredAll
    .filter((i) => i.score >= RELEVANCE_MIN)
    .sort((a, b) => (b.score + (b.boost ?? 0)) - (a.score + (a.boost ?? 0)));
  const picked = passed.slice(0, DAILY_LIMIT);
  if (passed.length) {
    console.log(`[게이트 통과] ${passed.length}건 (오늘 한도 ${DAILY_LIMIT}건 선정):`);
    passed.forEach((i) => console.log(`  · ${i.score}점 [${i.source}] ${i.title}`));
  }

  // 관측용 로그: 컷된 것도 남겨 임계값 튜닝에 활용
  const cut = scoredAll
    .filter((i) => i.score < RELEVANCE_MIN)
    .sort((a, b) => b.score - a.score);
  if (cut.length) {
    console.log(`[관련성 컷] ${cut.length}건 (하한 ${RELEVANCE_MIN}):`);
    cut.slice(0, 5).forEach((i) => console.log(`  · ${i.score}점  ${i.title}`));
  }

  // --score-only: 게이트 튜닝용 드라이런 (커밋 O9) — 채점표만 출력, 생성·저장·텔레그램 없음
  if (process.argv.includes("--score-only")) {
    console.log(`\n[--score-only] 신규 ${scoredAll.length}건 채점표 (하한 ${RELEVANCE_MIN} · 생성 없음):`);
    for (const i of [...scoredAll].sort((a, b) => b.score - a.score)) {
      console.log(` ${String(i.score).padStart(4)}점 ${i.score >= RELEVANCE_MIN ? "통과" : "컷 "} [${i.source}] ${i.title}`);
    }
    return;
  }

  const results = []; // 생성 성공 (제목·카테고리·카드 장수·검증 경고)
  const failures = []; // 생성 실패 (0건은 에러가 아님 — 실패는 게이트 통과분의 생성 오류만)

  for (const item of picked) {
    console.log(`[생성] ${item.title} (관련도 ${item.score})`);
    try {
      const { article, carousel_warning, needs_human_review, review_reasons, high_risk_topics } =
        await generateArticle(item);
      console.log(`  → 초안 적재: ${SITE_URL}/news/${article.slug}`);
      if (carousel_warning) console.warn(`  → ⚠️ 카드 검증 경고: ${carousel_warning}`);
      if (needs_human_review) console.warn(`  → 🔴 사람 검수 필수: ${review_reasons ?? "-"}`);

      // 네이버/블로그스팟 원고를 발행 대기함(텔레그램)으로 + 카드 장수 집계
      const { data: full } = await supabase
        .from("premium_articles")
        .select("title, naver_title, blogspot_title, category, naver_blog_content, blogspot_content, carousel_json")
        .eq("id", article.id)
        .single();

      results.push({
        title: article.title,
        category: full?.category ?? article.category ?? "-",
        score: item.score,
        cards: Array.isArray(full?.carousel_json) ? full.carousel_json.length : 0,
        warning: carousel_warning ?? null,
        needsReview: needs_human_review,
        reviewReasons: review_reasons,
        riskTopics: high_risk_topics,
      });

      if (full) {
        await sendTelegramDoc(
          `naver-${article.slug}.txt`,
          `${full.naver_title ?? full.title}\n\n${full.naver_blog_content}`,
          `📝 네이버 블로그 발행 대기\n${full.naver_title ?? full.title}\n\n본진: ${SITE_URL}/news/${article.slug}\n파일 내용을 복사해 네이버 블로그에 붙여넣으세요.`
        );
        await sendTelegramDoc(
          `blogspot-${article.slug}.txt`,
          `${full.blogspot_title ?? full.title}\n\n${full.blogspot_content}`,
          `📝 블로그스팟 발행 대기\n${full.blogspot_title ?? full.title}`
        );
      }
    } catch (err) {
      console.error(`  → 실패: ${err.message}`);
      failures.push({ title: item.title, error: err.message });
    }
  }

  if (!picked.length) console.log("생성할 새 기사가 없습니다. (관련성 게이트 정상 동작 — 실패 아님)");

  // 실측 요약 알림 — 0건이어도 반드시 보낸다 (엔진이 보이게)
  const summary = buildSummary({
    sourceStats,
    collected: candidates.length,
    alreadyProcessed,
    batchDupes,
    noBodySkipped,
    passed,
    picked,
    cut,
    results,
    failures,
  });
  console.log(`\n──── 파이프라인 요약 ────\n${summary}`);
  await sendTelegramMessage(summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
