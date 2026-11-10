-- 011 — 네이버 글 → 카카오톡 채널 클릭 집계 (LK1, 2026-11-10 · src/app/go/kakao/route.ts)
-- ⚠️ 아직 적용하지 않았다. 관제탑·로버트 승인 후 SQL Editor 또는 MCP apply_migration 으로 적용.
--    적용 전에 route 가 배포돼도 insert 만 실패하고 카카오 채팅으로 이동은 된다.
--
-- 원칙
--  - 개인정보 없음: 글 slug · 유입 출처 · 리퍼러 호스트 · 봇 여부만. IP·UA 원문 저장 안 함.
--  - RLS 켜고 정책 0개 → 서버(service_role)만 읽기·쓰기.

create table if not exists public.link_clicks (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  target text not null check (target in ('kakao')),
  ref text check (ref is null or ref ~ '^[a-z0-9-]{1,120}$'),     -- 글 slug
  src text check (src is null or src ~ '^[a-z_]{1,30}$'),         -- naver(기본) 등
  referer_host text,
  is_bot boolean not null default false
);
create index if not exists link_clicks_created_idx on public.link_clicks (created_at desc);
create index if not exists link_clicks_ref_idx on public.link_clicks (ref, created_at desc);

alter table public.link_clicks enable row level security;
-- 정책을 만들지 않는다(의도). 서버 service_role 만 접근.

-- 주간 집계(봇 제외) — 보고용
create or replace view public.link_clicks_weekly
with (security_invoker = true) as
select date_trunc('week', created_at) as week, target, coalesce(src, '-') as src, ref, count(*) as clicks
from public.link_clicks
where not is_bot
group by 1, 2, 3, 4;
