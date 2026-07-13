/**
 * 신규 소스 정찰 프로브 — 커밋 O10-A. 소스 배선(O10-B) 전 "본문 확보 가능한가"를 실측 판정.
 * 코드 배선·DB 변경 없음 — 읽기 전용 정찰 도구 (--score-only와 같은 상비 계열).
 *
 * 실행: node scripts/probe-sources.mjs [목록URL ...]
 *   인자 없으면 내장 후보 목록(2026-07-13 O10-A 정찰 대상)을 돈다.
 *
 * 소스당 확인: 목록 정적 파싱 가능 여부·charset / 상세 본문 유형(HTML 텍스트·img alt·
 * PDF/HWP 첨부) / 본문 실측 글자수(최신 2~3건) / 최근 30일 게시 수 / robots.txt.
 *
 * 2026-07-13 실측 요지 (상세 판정은 PROGRESS/보고 참조):
 * - 금융위 fsc.go.kr/no010101: HTML 본문 직수확 가능(최대 8천자) + PDF 병행 · robots 전체 허용 · 활발 → 붙인다
 * - 복지부 mohw.go.kr: 상세는 HWP 첨부형이나 RSS(/rss/board.es?mid=a10503000000&bid=0027)가
 *   robots 명시 허용 + description 1,400자대 → RSS 경로로 붙인다
 * - 손보협회 knia.or.kr/data/news: 정적 목록(content?index=) but 본문 없음(HWP+PDF 첨부형)
 *   → PDF 폴백(O3)으로만 확보 가능 · 협회 활동 위주 · 월 1~4건 → 조건부
 * - 보험연구원 kiri.or.kr reportList.do?docId=: HTML 요약 + PDF 전문 → 기술적 가능하나
 *   연구·산업 관점 위주(소비자 접점 희박) → 조건부(후순위)
 * - 생보협회 klia.or.kr board: 상세가 JS POST(fn_goView) → 직파싱 불가 + 월 0~1건 → 탈락
 * - 건보공단 nhis.or.kr: robots가 /nhis/ 전체 Disallow(게시판 포함) → 탈락(크롤링 비허용)
 */

const UA = "Mozilla/5.0 (compatible; GoodFinancePipeline/1.0)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_TARGETS = [
  "https://www.knia.or.kr/data/news",
  "https://www.klia.or.kr/board/2/list.do",
  "https://www.kiri.or.kr/report/reportList.do?catId=52",
  "https://www.nhis.or.kr/nhis/together/wbhaea01000m01.do",
  "https://www.mohw.go.kr/menu.es?mid=a10503010000",
  "https://www.fsc.go.kr/no010101",
];

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "";
  let charset = (ct.match(/charset=([\w-]+)/i)?.[1] ?? "").toLowerCase();
  if (!charset) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 3000));
    charset = (head.match(/charset=["']?([\w-]+)/i)?.[1] ?? "utf-8").toLowerCase();
  }
  let text;
  try {
    text = new TextDecoder(charset).decode(buf);
  } catch {
    text = new TextDecoder("utf-8").decode(buf);
  }
  return { status: res.status, finalUrl: res.url, charset, text };
}

const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(?:nav|header|footer)[\s\S]*?<\/(?:nav|header|footer)>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-zA-Z#0-9]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * 상세 링크 후보 — 사이트별 실측 패턴 통합:
 * content?index=(knia) · docId=(kiri) · board.es?...&list_no=(정부 .es) ·
 * /noNNNNNN/ID(fsc) · view.do·nttId(금감원 계열) · 일반 view/detail/seq/idx
 */
function extractDetailLinks(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const label = m[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (label.length < 10 || label.length > 90) continue;
    if (
      !/content\?index=|docId=|list_no=|nttId|boardSeq|articleId|bbsSeq|view|View|detail|Detail|seq=|idx=|\/no\d{6}\/\d+/.test(
        href
      )
    )
      continue;
    if (/로그인|회원|검색|이전|다음|목록|더보기/.test(label)) continue;
    let abs;
    try {
      abs = href.startsWith("http") ? href : new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ title: label, link: abs });
  }
  return out;
}

/** 목록 페이지의 날짜 토큰 → 최근 30일 게시 수 (죽은 게시판 걸러내기) */
function recentPostCount(html, now = new Date()) {
  const dates = [...html.matchAll(/20\d{2}[-./]\s?\d{1,2}[-./]\s?\d{1,2}/g)].map((m) =>
    m[0].replace(/\s/g, "").replace(/[./]/g, "-")
  );
  const cutoff = new Date(now.getTime() - 30 * 86400000);
  const recent = dates.filter((d) => {
    const t = new Date(d);
    return !isNaN(t) && t >= cutoff && t <= now;
  });
  return { total: dates.length, recent30d: recent.length };
}

/** 상세 페이지 본문 유형 분석 — HTML 직수확 / img alt(O2) / PDF·HWP 폴백(O3) 판별 근거 */
function analyzeDetail(html) {
  const bodyText = strip(html);
  const altTexts = [...html.matchAll(/<img[^>]*\salt=["']([^"']{10,})["']/gi)].map((m) => m[1]);
  return {
    chars: bodyText.length,
    altChars: altTexts.join(" ").replace(/\s+/g, " ").length,
    altCount: altTexts.length,
    pdfSignals: (html.match(/\.pdf/gi) ?? []).length,
    hwpSignals: (html.match(/\.hwpx?/gi) ?? []).length,
    sample: bodyText.slice(0, 140),
  };
}

const robotsCache = new Map();
async function robotsInfo(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  let info;
  try {
    const { status, text } = await fetchText(`${origin}/robots.txt`);
    if (status !== 200) info = `robots HTTP ${status}`;
    else {
      const lines = text
        .split(/\r?\n/)
        .filter((l) => /^(user-agent|disallow|allow)/i.test(l.trim()))
        .slice(0, 12);
      info = lines.join(" | ") || "빈 파일(전체 허용)";
    }
  } catch (e) {
    info = `조회 실패(${e.message})`;
  }
  robotsCache.set(origin, info);
  return info;
}

async function probe(listUrl) {
  console.log(`\n════════ ${listUrl}`);
  try {
    const { status, finalUrl, charset, text } = await fetchText(listUrl);
    const freq = recentPostCount(text);
    console.log(
      `목록: HTTP ${status} · charset=${charset} · HTML ${text.length.toLocaleString()}자 · 날짜토큰 ${freq.total}개(최근30일 ${freq.recent30d})`
    );
    if (text.length < 3000) {
      console.log(`  ⚠️ JS 렌더/리다이렉트 의심 — 첫 200자: ${text.slice(0, 200).replace(/\s+/g, " ")}`);
    }
    const items = extractDetailLinks(text, finalUrl);
    console.log(`상세 링크 후보 ${items.length}건${items.length ? " — 상위 3건 프로브:" : " (0건이면 행 마크업이 JS/POST형인지 수동 확인)"}`);
    for (const it of items.slice(0, 3)) {
      await sleep(400);
      try {
        const d = await fetchText(it.link);
        const a = analyzeDetail(d.text);
        console.log(`  · 「${it.title.slice(0, 45)}」`);
        console.log(
          `    텍스트 ${a.chars.toLocaleString()}자 · img alt ${a.altCount}개(${a.altChars}자) · PDF ${a.pdfSignals} · HWP ${a.hwpSignals}`
        );
        console.log(`    샘플: ${a.sample}`);
      } catch (e) {
        console.log(`  · 「${it.title.slice(0, 45)}」 상세 실패: ${e.message}`);
      }
    }
    console.log(`robots: ${await robotsInfo(new URL(finalUrl).origin)}`);
  } catch (e) {
    console.log(`목록 실패: ${e.message}`);
  }
}

const targets = process.argv.slice(2).filter((a) => a.startsWith("http"));
for (const t of targets.length ? targets : DEFAULT_TARGETS) {
  await probe(t);
  await sleep(500);
}
