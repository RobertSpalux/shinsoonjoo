-- ⚠️ 적용하지 않았다(2026-10-01 관제탑 지시 20261001-0315 1번 — 「마이그레이션 파일(적용 금지)」). 적용은 로버트 결정.
--    적용할 때: Supabase(lgbbflolunlseutvqaso) 마이그레이션 이름 `reply_reviews` 로 이 파일 전체를 한 번.
--
-- 스레드 답글 댓글심의 기록 — 답글 전용 표.
--   왜 ad_reviews 가 아닌가: ad_reviews 는 article_id(NOT NULL·FK)로 글에 묶여 있다. 답글 한 건은 글이 아니라
--   「우리 스레드 원글에 달린 남의 댓글」에 붙는다. FK 를 비틀지 않고 따로 둔다(관제탑 판정).
--   왜 필요한가: 댓글·답글은 방향 무관 전부 PAMS 댓글심의 대상이다(CLAUDE.md §6.6). 승인 기록 없이 답글이 나가면
--   미심의 광고다(집중 모니터링 ③). 게시 쪽(robert-os reply_bot.답글보내기)은 이 표를 보고서만 보낸다.
--
-- 상태 이름은 robert-os reply_bot 의 말을 정본으로 쓴다(관제탑 판정).
--   초안 → 심의대기 → 승인 → 답함   (반송 · 취소 는 옆길)
--   reply_bot 의 「답함」 = 게시 완료. 새 이름(「게시」)을 만들지 않았다 — 같은 뜻에 이름이 둘이 되면 또 어긋난다.
--
-- 🔴 심의본 = 게시본: reply_sha256 은 트리거가 reply_text 에서 계산한다(사람이 넣지 않는다).
--    심의대기 이후에는 reply_text 를 바꿀 수 없다(원안 변경 금지 — 바꾸려면 새 행 = 신규 심의).
--    답함 으로 바꿀 때는 posted_sha256(실제로 보낸 글의 해시)이 reply_sha256 과 같아야 한다.

create table if not exists public.reply_reviews (
  id                 uuid primary key default gen_random_uuid(),
  account            text not null default 'goodfinance',
  root_post_id       text not null,                 -- 뿌리글 = 우리 스레드 원글 id(그래프 API)
  root_post_url      text,
  comment_id         text not null,                 -- 답글을 다는 댓글 id(남이 쓴 것 — 경계는 reply_bot 이 검사)
  comment_url        text,
  reply_text         text not null,                 -- 답글 원고 = 심의본(PAMS 에 넣은 글자 그대로)
  reply_sha256       text not null default '',      -- 트리거가 채운다
  status             text not null default '초안',
  gate_findings      jsonb,                         -- 금지표현 게이트(scripts/check_reply.mts) 결과
  pams_submitted_at  timestamptz,
  pams_approved_at   timestamptz,
  review_no          text,                          -- 번호만(예 2026-10-1234) — ad_reviews 와 같은 형식
  review_from        date,
  review_to          date,
  notice_text        text,                          -- 승인 뒤 PAMS 가 자동 생성한 [안내문구]+[필수안내사항] 원문
  posted_reply_id    text,
  posted_url         text,
  posted_sha256      text,                          -- 실제로 보낸 답글 본문(필수안내 제외)의 해시
  posted_at          timestamptz,
  url_registered_at  timestamptz,                   -- PAMS 게시위치 등록
  rejected_reason    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint reply_reviews_status_chk
    check (status in ('초안', '심의대기', '승인', '반송', '답함', '취소')),
  constraint reply_reviews_review_no_fmt
    check (review_no is null or review_no ~ '^[0-9]{4}-[0-9]{2}-[0-9]{1,5}$'),
  constraint reply_reviews_approved_needs_review
    check (status not in ('승인', '답함') or (review_no is not null and review_from is not null and review_to is not null
                                               and review_from <= review_to and notice_text is not null)),
  constraint reply_reviews_posted_matches
    check (status <> '답함' or (posted_sha256 is not null and posted_sha256 = reply_sha256 and posted_at is not null)),
  constraint reply_reviews_one_text_per_comment unique (comment_id, reply_sha256)
);

-- 한 댓글에 살아 있는 답글 원고는 하나(반송·취소는 여럿 남아도 된다 — 이력)
create unique index if not exists reply_reviews_active_uniq on public.reply_reviews (comment_id)
  where status in ('초안', '심의대기', '승인', '답함');
create index if not exists reply_reviews_status_idx on public.reply_reviews (status);

create or replace function public.reply_reviews_guard() returns trigger
language plpgsql as $$
begin
  new.reply_sha256 := encode(sha256(convert_to(new.reply_text, 'UTF8')), 'hex');
  if tg_op = 'UPDATE' then
    if old.status in ('심의대기', '승인', '답함') and new.reply_text is distinct from old.reply_text then
      raise exception 'reply_reviews: 심의 접수 뒤에는 답글 원고를 바꿀 수 없다(원안 변경 금지 — 새 행으로 신규 심의)';
    end if;
    if old.status = '답함' and new.status <> '답함' then
      raise exception 'reply_reviews: 게시(답함)된 기록은 되돌리지 않는다';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists reply_reviews_guard_trg on public.reply_reviews;
create trigger reply_reviews_guard_trg before insert or update on public.reply_reviews
  for each row execute function public.reply_reviews_guard();

-- 서버 키(service role)만 읽고 쓴다 — 공개 정책 없음
alter table public.reply_reviews enable row level security;

comment on table public.reply_reviews is
  '스레드 답글 댓글심의 기록(CLAUDE.md §6.6). 상태 = reply_bot 정본(초안→심의대기→승인→답함). 답함은 posted_sha256 = reply_sha256 일 때만.';

-- 롤백: drop table if exists public.reply_reviews; drop function if exists public.reply_reviews_guard();
