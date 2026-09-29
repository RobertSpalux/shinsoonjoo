-- 기록용 — 이미 적용됨: 2026-09-30 08:3x 관제탑이 Supabase 마이그레이션 `ad_reviews_threads_multi` 로 적용
-- (lgbbflolunlseutvqaso, 행 20 유지). 다시 실행하지 않는다.
-- 스레드는 한 글에서 원글이 여러 개 나온다(6호 간병: 7550 + 0929 간병가족) — 활성 행 1개 제약에서 뺀다.
-- 본진·네이버·블로그스팟·인스타는 지금처럼 (article_id, channel) 당 활성 행 1개.
-- 이전 정의(롤백용):
--   CREATE UNIQUE INDEX ad_reviews_active_uniq ON public.ad_reviews USING btree (article_id, channel)
--   WHERE (status = ANY (ARRAY['draft'::text, 'submitted'::text, 'under_review'::text, 'approved'::text]))
drop index if exists public.ad_reviews_active_uniq;
create unique index ad_reviews_active_uniq on public.ad_reviews (article_id, channel)
  where status in ('draft', 'submitted', 'under_review', 'approved') and channel <> 'threads';
