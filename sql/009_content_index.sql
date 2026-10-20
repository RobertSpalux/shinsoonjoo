-- 009 — 주간 유입 지수(IX1 2026-10-20). 글마다 「핵심 검색어」 + 주차별 측정 결과.
-- ⚠️ 아직 적용하지 않았다. 관제탑이 SHIN DB(lgbbflolunlseutvqaso)에 SQL Editor 또는 MCP apply_migration 으로 적용.
--
-- 흐름
--  1. premium_articles.main_keyword — 글의 「핵심 검색어」(사람이 정한다). 비어 있으면 측정 스크립트가 제목 앞 3어절로 대신 재고
--     keyword_source='auto' 로 표시한다.
--  2. 로컬 크론(scripts/content_index_weekly.py, 월 08:00 KST)이 지난주(월~일)를 재서 글×주차 1행씩 upsert.
--     측정은 읽기 전용(네이버 공개 검색 GET · GSC · GA4). 쓰는 곳은 이 표 하나뿐이다.
--  3. 어드민 「유입 지수」 탭이 최근 8주를 읽어 글 × 주차 표로 보여준다.
--
-- 원칙
--  - RLS 켜고 정책 0개 → service_role(서버·로컬 크론)만 접근.
--  - 개인정보 없음(검색 순위·집계 숫자뿐).

alter table public.premium_articles add column if not exists main_keyword text;
comment on column public.premium_articles.main_keyword is '핵심 검색어 — 주간 유입 지수(네이버 블로그탭 순위·통합검색 노출)의 기준. 비면 제목 앞 3어절로 자동 측정.';

create table if not exists public.content_index_weekly (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,                        -- 측정 주 월요일(KST)
  article_id uuid references public.premium_articles(id) on delete set null,
  slug text not null,
  keyword text,                                    -- 이번 주 측정에 쓴 검색어
  keyword_source text check (keyword_source in ('main_keyword', 'auto')),
  -- 네이버(insightlab-daily) — 공개 검색 결과 GET
  naver_blog_rank integer,                         -- 블로그탭 순위(우리 블로그 첫 글). null = 30위 밖·미측정
  naver_blog_n integer,                            -- 그 검색에서 센 블로그 글 수(보통 30)
  naver_post_matched boolean,                      -- 잡힌 우리 글이 이 글(게시 URL logNo)인가
  naver_integ_blog boolean,                        -- 통합검색 첫 화면에 블로그 노출
  naver_integ_main boolean,                        -- 통합검색 첫 화면에 goodfinance.kr 노출
  -- 본진(goodfinance.kr/news/<slug>) — GSC
  gsc_from date,
  gsc_to date,
  gsc_impressions integer,
  gsc_clicks integer,
  gsc_position numeric(6, 2),
  gsc_top_queries jsonb,                           -- [{query, impressions, clicks, position}] 상위 5
  -- 본진 — GA4(착지 페이지 기준)
  ga_sessions integer,
  ga_sessions_by_source jsonb,                     -- {"네이버 블로그": n, "검색": n, ...}
  conv_events jsonb,                               -- {"generate_lead": n, "kakao_click": n, "diagnosis_complete": n, "tel_click": n}
  -- 판정(표시용) — 갱신 대상 · 보강 대상 · 제목·설명 개선 대상
  verdicts text[] not null default '{}',
  errors jsonb,                                    -- 조회 실패한 칸 {"naver": "...", "gsc": "..."} — 실패는 0이 아니라 null
  measured_at timestamptz not null default now(),
  unique (week_start, slug)
);

create index if not exists content_index_weekly_week_idx on public.content_index_weekly (week_start desc);

alter table public.content_index_weekly enable row level security;
-- 정책을 만들지 않는다(의도). 서버·로컬 크론 service_role 만 접근.
