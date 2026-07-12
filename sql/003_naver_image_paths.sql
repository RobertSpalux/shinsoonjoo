-- 네이버 블로그용 가로 이미지 세트(대표 썸네일·정보 도식·CTA 배너) 경로.
-- render-cards.mjs의 naver 패스가 기록. Storage: card-news/{slug}/naver-0X.png
-- 적용: 2026-07-12 Supabase MCP로 실행 완료 (shin-good-finance / lgbbflolunlseutvqaso)
alter table public.premium_articles
  add column if not exists naver_image_paths text[] default '{}';

comment on column public.premium_articles.naver_image_paths is
  '네이버 블로그용 가로 이미지 세트(썸네일·도식·CTA) Storage 공개 URL — render-cards.mjs naver 패스가 기록';
