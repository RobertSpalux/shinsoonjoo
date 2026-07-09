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
  "금융뉴스",
  "생활경제",
  "보상꿀팁",
  "판례해설",
  "천안소식",
] as const;

const ARTICLE_COLUMNS =
  "id, title, slug, category, summary, tags, key_points, raw_source_url, raw_source_name, main_website_markdown, faq_json, image_paths, og_image_path, published_at, view_count, created_at";

function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** 발행된 글 목록 (카테고리 필터 옵션) — RLS가 발행 글만 노출 */
export async function getPublishedArticles(
  category?: string,
  limit = 60
): Promise<Article[]> {
  const supabase = publicClient();
  if (!supabase) return [];

  let query = supabase
    .from("premium_articles")
    .select(ARTICLE_COLUMNS)
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

  const { data, error } = await supabase
    .from("premium_articles")
    .select(ARTICLE_COLUMNS)
    .eq("slug", slug)
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
