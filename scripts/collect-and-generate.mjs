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
  SITE_URL = "https://soonjoo.vercel.app",
  FACTORY_SECRET,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
} = process.env;

const DAILY_LIMIT = Number(process.env.DAILY_ARTICLE_LIMIT ?? 2);

/** 원천 소스 — 실패해도 다음 소스로 넘어감 */
const SOURCES = [
  { name: "금융감독원 보도자료", url: "https://www.fss.or.kr/fss/kr/rss/fss_news.xml", category: "금융뉴스" },
  { name: "연합뉴스 경제", url: "https://www.yna.co.kr/rss/economy.xml", category: "생활경제" },
  { name: "연합뉴스 금융", url: "https://www.yna.co.kr/rss/market.xml", category: "금융뉴스" },
];

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const parser = new Parser({ timeout: 15000 });

async function collectCandidates() {
  const items = [];
  for (const source of SOURCES) {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of (feed.items ?? []).slice(0, 8)) {
        if (!item.link || !item.title) continue;
        items.push({
          title: item.title.trim(),
          link: item.link,
          content: (item.contentSnippet || item.content || item.summary || "").trim(),
          source: source.name,
          category: source.category,
          pubDate: item.isoDate ?? item.pubDate ?? null,
        });
      }
      console.log(`[수집] ${source.name}: ${feed.items?.length ?? 0}건`);
    } catch (err) {
      console.warn(`[수집 실패] ${source.name}: ${err.message}`);
    }
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
  return items.filter((i) => !seen.has(i.link));
}

/** 보험·금융 소비자 관련성 스코어 — 관련 높은 기사 우선 */
function relevanceScore(item) {
  const text = `${item.title} ${item.content}`;
  const keywords = [
    ["보험", 10], ["보험금", 12], ["실손", 10], ["분쟁", 8], ["금감원", 8], ["약관", 8],
    ["연금", 7], ["상속", 7], ["증여", 6], ["금리", 5], ["대출", 5], ["예금", 4],
    ["세금", 5], ["청구", 6], ["노후", 6], ["가계", 4],
  ];
  return keywords.reduce((acc, [kw, w]) => acc + (text.includes(kw) ? w : 0), 0);
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
      auto_publish: true,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`generate 실패(${res.status}): ${json.error ?? "unknown"}`);
  return json.article;
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

async function main() {
  const candidates = await collectCandidates();
  const fresh = await filterProcessed(candidates);
  const picked = fresh
    .map((i) => ({ ...i, score: relevanceScore(i) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, DAILY_LIMIT);

  if (!picked.length) {
    console.log("생성할 새 기사가 없습니다.");
    return;
  }

  for (const item of picked) {
    console.log(`[생성] ${item.title} (관련도 ${item.score})`);
    try {
      const article = await generateArticle(item);
      console.log(`  → 발행: ${SITE_URL}/news/${article.slug}`);

      // 네이버/블로그스팟 원고를 발행 대기함(텔레그램)으로
      const { data: full } = await supabase
        .from("premium_articles")
        .select("title, naver_blog_content, blogspot_content")
        .eq("id", article.id)
        .single();

      if (full) {
        await sendTelegramDoc(
          `naver-${article.slug}.txt`,
          `${full.title}\n\n${full.naver_blog_content}`,
          `📝 네이버 블로그 발행 대기\n${full.title}\n\n본진: ${SITE_URL}/news/${article.slug}\n파일 내용을 복사해 네이버 블로그에 붙여넣으세요.`
        );
        await sendTelegramDoc(
          `blogspot-${article.slug}.txt`,
          `${full.title}\n\n${full.blogspot_content}`,
          `📝 블로그스팟 발행 대기\n${full.title}`
        );
      }
    } catch (err) {
      console.error(`  → 실패: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
