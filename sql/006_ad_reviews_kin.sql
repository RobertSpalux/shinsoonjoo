-- 제안 — 아직 적용하지 않았다(2026-10-09). 적용은 로버트 승인 뒤 관제탑이 Supabase 마이그레이션으로.
-- 왜: 지식iN 답변은 글(premium_articles)이 아니다. 그런데 ad_reviews.article_id 가 NOT NULL·FK 라
--     channel='kin' 행을 넣을 수 없다(2026-10-09 PostgREST OpenAPI 실측: required 에 article_id).
--     그동안 지식인 심의필은 %LOCALAPPDATA%\SHIN\kin_state.json 에만 남는다 — 만료 관리(§6.3)가 DB 밖에 있게 된다.
-- 무엇을: article_id 를 kin 에 한해 비우고, 대신 kin_answers 를 가리킨다. 다른 채널은 지금과 같다(article_id 필수).
-- 영향: 기존 행 20여 건은 전부 article_id 가 있으므로 체크 제약을 그대로 통과한다.
--       ad_reviews_active_uniq(article_id, channel) 은 article_id 가 NULL 이면 겹치지 않으므로 kin 은 여러 행이 된다(의도).
-- 롤백: alter table public.ad_reviews drop constraint ad_reviews_article_or_kin;
--       alter table public.ad_reviews drop column kin_answer_id;
--       alter table public.ad_reviews alter column article_id set not null;   -- kin 행이 있으면 먼저 지운다

alter table public.ad_reviews alter column article_id drop not null;
alter table public.ad_reviews add column if not exists kin_answer_id uuid references public.kin_answers(id);
alter table public.ad_reviews add constraint ad_reviews_article_or_kin check (
  (channel = 'kin' and kin_answer_id is not null and article_id is null)
  or (channel <> 'kin' and article_id is not null)
);
