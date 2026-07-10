/**
 * 일회성(작업 후 삭제) — 수입차 기사 1건만 대상.
 * raw_source_excerpt를 입력으로 factory-prompt의 실제 시스템 프롬프트/스키마(커밋 J 반영)로
 * Claude 재생성 → carousel_json·key_points·remodeling_bridge·instagram_caption만 뽑아 UPDATE.
 * ⚠️ 새 INSERT 절대 금지, 기존 행 UPDATE만. image_paths도 비워 render-cards가 재렌더하게 함.
 * 실행: npx tsx scripts/_oneoff-regen.ts  (env는 워크플로가 주입)
 */
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { factorySystemPrompt, FACTORY_OUTPUT_SCHEMA } from "../src/lib/factory-prompt";

const SLUG = "imported-car-market-share-auto-insurance-impact";
const MODEL = process.env.FACTORY_CLAUDE_MODEL ?? "claude-sonnet-5";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase 환경변수 없음");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // 1) 기존 기사 로드 (excerpt 입력)
  const { data: art, error: selErr } = await supabase
    .from("premium_articles")
    .select("id, title, category, raw_source_excerpt, raw_source_name, raw_source_url")
    .eq("slug", SLUG)
    .maybeSingle();
  if (selErr || !art) throw new Error(`기사 로드 실패: ${selErr?.message ?? "not found"}`);

  const excerpt = (art.raw_source_excerpt ?? "").trim();
  if (!excerpt) throw new Error("raw_source_excerpt가 비어 있습니다.");
  console.log(`대상: ${art.id} / ${art.title}`);
  console.log(`raw_source_excerpt 길이: ${excerpt.length}`);

  // 2) Claude — 실제 factory 시스템 프롬프트 + 전체 스키마
  const anthropic = new Anthropic(); // ANTHROPIC_API_KEY (워크플로 주입)
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: factorySystemPrompt(),
    output_config: {
      format: { type: "json_schema", schema: FACTORY_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [
      {
        role: "user",
        content: [
          "다음 원천 자료로 4개 채널 원고를 생성하라.",
          `제안 제목: ${art.title}`,
          `카테고리 힌트: ${art.category}`,
          art.raw_source_name ? `출처: ${art.raw_source_name}` : "",
          art.raw_source_url ? `원문 URL: ${art.raw_source_url}` : "",
          "",
          "--- 원천 자료 ---",
          excerpt.slice(0, 30000),
        ].filter(Boolean).join("\n"),
      },
    ],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("생성 거부됨");
  if (message.stop_reason === "max_tokens") throw new Error("출력 잘림");
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("빈 응답");
  const article = JSON.parse(textBlock.text);

  // 3) 관측 로그 — carousel 장수 + big_number/highlight 담김 여부
  const cards: Array<{ heading: string; body: string; big_number?: string; highlight?: string }> =
    Array.isArray(article.carousel_json) ? article.carousel_json : [];
  const bigCount = cards.filter((c) => c.big_number).length;
  const hlCount = cards.filter((c) => c.highlight).length;
  console.log(`\n=== 새 carousel: ${cards.length}장 | big_number ${bigCount}개 | highlight ${hlCount}개 ===`);
  cards.forEach((c, i) => {
    const tag = i === 0 ? "훅 " : i === cards.length - 1 ? "CTA" : String(i).padStart(2, "0");
    const extra = c.big_number ? `  [big_number: ${c.big_number}]` : c.highlight ? `  [highlight: ${c.highlight}]` : "";
    console.log(`(${tag}) ${c.heading}${extra}`);
    console.log(`      ${c.body}`);
  });
  console.log(`\nkey_points: ${(article.key_points ?? []).length}개`);
  console.log(`remodeling_bridge: ${article.remodeling_bridge ? "있음" : "없음"}`);
  console.log(`instagram_caption: ${article.instagram_caption ? `있음(${article.instagram_caption.length}자)` : "없음"}`);
  console.log(`tokens: in ${message.usage.input_tokens} / out ${message.usage.output_tokens}`);

  // 4) UPDATE만 (INSERT 금지) — 선택 필드 + image_paths 비우기
  const { error: updErr } = await supabase
    .from("premium_articles")
    .update({
      carousel_json: article.carousel_json,
      key_points: article.key_points ?? [],
      remodeling_bridge: article.remodeling_bridge ?? null,
      instagram_caption: article.instagram_caption ?? null,
      image_paths: [],
      og_image_path: null,
      is_instagram_published: false,
    })
    .eq("id", art.id);
  if (updErr) throw new Error(`UPDATE 실패: ${updErr.message}`);
  console.log("\n✅ UPDATE 완료 — carousel/key_points/bridge/caption 교체 + image_paths 비움");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
