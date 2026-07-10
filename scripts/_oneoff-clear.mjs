// 일회성(작업 후 삭제) — 수입차 기사 image_paths 비우기(render-cards 재렌더 유도). env는 워크플로 주입.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env 없음"); process.exit(1); }
const supabase = createClient(url, key, { auth: { persistSession: false } });

const SLUG = "imported-car-market-share-auto-insurance-impact";
const { data, error } = await supabase
  .from("premium_articles")
  .update({ image_paths: [], og_image_path: null })
  .eq("slug", SLUG)
  .select("id, image_paths");
if (error) { console.error("UPDATE 실패:", error.message); process.exit(1); }
if (!data?.length) { console.error("대상 기사 없음:", SLUG); process.exit(1); }
console.log(`✅ image_paths 비움: ${data[0].id} (now ${JSON.stringify(data[0].image_paths)})`);
