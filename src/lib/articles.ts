import { createClient } from "@supabase/supabase-js";

export interface Article {
  id: string;
  title: string;
  slug: string;
  category: string;
  summary: string | null;
  tags: string[];
  key_points: string[] | null;
  raw_source_url: string | null;
  raw_source_name: string | null;
  main_website_markdown: string | null;
  faq_json: { question: string; answer: string }[] | null;
  image_paths: string[];
  og_image_path: string | null;
  published_at: string | null;
  view_count: number;
  created_at: string;
}

export const CATEGORIES = [
  "전체",
  "보험료 절약·꿀팁",
  "보험금 청구·보상",
  "실손·보장성 가이드",
  "연금·노후·세테크",
  "보험 리모델링",
  "금융·경제 뉴스",
] as const;

const ARTICLE_COLUMNS =
  "id, title, slug, category, summary, tags, key_points, raw_source_url, raw_source_name, main_website_markdown, faq_json, image_paths, og_image_path, published_at, view_count, created_at";

function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * 발행된 글 목록 (카테고리 필터 옵션).
 * 발행 게이트: is_main_published = true AND published_at <= now().
 * → 초안(false)은 숨김. 예약발행(published_at 미래)은 그 시각까지 자동으로 숨음(크론 불필요).
 * (RLS도 is_main_published를 막지만, published_at 게이트는 여기서만 걸므로 명시적으로 둔다.)
 */
export async function getPublishedArticles(
  category?: string,
  limit = 60
): Promise<Article[]> {
  const supabase = publicClient();
  if (!supabase) return [];

  const now = new Date().toISOString();
  let query = supabase
    .from("premium_articles")
    .select(ARTICLE_COLUMNS)
    .eq("is_main_published", true)
    .lte("published_at", now)
    .order("published_at", { ascending: false })
    .limit(limit);

  if (category && category !== "전체") {
    query = query.eq("category", category);
  }

  const { data, error } = await query;
  if (error) {
    console.error("getPublishedArticles error:", error.message);
    return [];
  }
  return (data as Article[]) ?? [];
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const supabase = publicClient();
  if (!supabase) return null;

  // 발행 게이트 — 초안·예약(미발행) 글은 직접 URL로도 열리지 않음(→ notFound)
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("premium_articles")
    .select(ARTICLE_COLUMNS)
    .eq("slug", slug)
    .eq("is_main_published", true)
    .lte("published_at", now)
    .maybeSingle();

  if (error) {
    console.error("getArticleBySlug error:", error.message);
    return null;
  }
  return data as Article | null;
}

/** 조회수 증가 (실패해도 무시 — 페이지 렌더를 막지 않음) */
export async function incrementViewCount(slug: string) {
  const supabase = publicClient();
  if (!supabase) return;
  await supabase.rpc("increment_article_view", { article_slug: slug }).then(
    () => undefined,
    () => undefined
  );
}
