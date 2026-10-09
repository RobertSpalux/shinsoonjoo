-- 제안 — 아직 적용하지 않았다(2026-10-09 SH4 보완). 적용은 관제탑이 Supabase 마이그레이션으로.
-- 왜: 지식iN 답변은 글(premium_articles)이 아니다. 그런데 ad_reviews.article_id 가 NOT NULL·FK 라
--     channel='kin' 행을 넣을 수 없다(2026-10-09 PostgREST OpenAPI 실측: required 에 article_id).
--     그동안 지식인 심의필은 %LOCALAPPDATA%\SHIN\kin_state.json 에만 남는다 — 만료 관리(§6.3)가 DB 밖에 있게 된다.
--
-- 식별 키 통일(SH4): 지식iN 행은 **channel = 'kin'** 하나로 가른다(체크 제약·코드 필터 NOT_KIN 전부 이 값).
--   review_type 은 PAMS 심의유형 축이라 따로 둔다 — 기존 허용값 'jisikin' 을 쓴다(새 값 안 만든다).
--   kin 행은 review_type = 'jisikin' 으로 묶는다(아래 ad_reviews_article_or_kin). 다른 채널의 review_type 은 그대로.
--
-- 🔴 적용 전 확인(관제탑) — 이 세션은 DB 를 읽지 못해(MCP 권한 없음) 정의를 짐작으로 적은 곳이 둘 있다:
--   1. 현 채널 체크 정의: select pg_get_constraintdef(oid) from pg_constraint where conname = 'ad_reviews_channel_check';
--      → 'main','naver','blogspot','instagram','threads' 외 값이 있으면 아래 목록에 더한다(SH4 지시서 실측값으로 적었다).
--   2. 뷰 ad_reviews_expiring: select pg_get_viewdef('public.ad_reviews_expiring', true);
--      → premium_articles 와 inner join 이면 kin 행은 뷰에서 빠진다(어드민 만료 배지도 .neq('channel','kin') 로 뺐다).
--        left join 이면 kin 행이 title·slug 없이 들어오지만 어드민이 걸러 깨지지 않는다. 뷰는 고치지 않는다.
-- 코드 쪽 준비(같은 PR): ad_reviews 를 글 기준으로 읽는 곳 전부 channel=neq.kin — 점검표는 docs/KIN-PIPELINE.md.
--   이 PR 이 머지·배포되기 **전에** 006 을 적용하면 kin 행 1건으로 publish_approved 가 멈춘다(sorted() 에 None).
--
-- 영향: 기존 행 20여 건은 전부 article_id 가 있고 channel <> 'kin' 이라 새 체크를 그대로 통과한다.
--       ad_reviews_active_uniq(article_id, channel) 은 article_id 가 NULL 이면 겹치지 않으므로 kin 은 여러 행이 된다(의도).
--       has_valid_review·enforce_publish_gate 는 (article, channel) 로 찾으므로 kin 행과 만나지 않는다.
-- 롤백(kin 행이 있으면 먼저 지운다):
--   alter table public.ad_reviews drop constraint ad_reviews_article_or_kin;
--   drop index if exists public.ad_reviews_kin_answer_uniq;
--   alter table public.ad_reviews drop column kin_answer_id;
--   alter table public.ad_reviews alter column article_id set not null;
--   alter table public.ad_reviews drop constraint ad_reviews_channel_check;
--   alter table public.ad_reviews add constraint ad_reviews_channel_check
--     check (channel in ('main','naver','blogspot','instagram','threads'));

begin;

alter table public.ad_reviews drop constraint if exists ad_reviews_channel_check;
alter table public.ad_reviews add constraint ad_reviews_channel_check
  check (channel in ('main','naver','blogspot','instagram','threads','kin'));

alter table public.ad_reviews alter column article_id drop not null;
alter table public.ad_reviews add column if not exists kin_answer_id uuid references public.kin_answers(id);

alter table public.ad_reviews add constraint ad_reviews_article_or_kin check (
  (channel = 'kin' and kin_answer_id is not null and article_id is null and review_type = 'jisikin')
  or (channel <> 'kin' and article_id is not null and kin_answer_id is null)
);

-- 답변 1건 = 심의필 1개(반송되면 kin_pipeline 은 새 원고·새 kin_answers 행으로 신규 신청한다 — 재심의 없음, §6.4)
create unique index if not exists ad_reviews_kin_answer_uniq on public.ad_reviews (kin_answer_id)
  where kin_answer_id is not null;

commit;
