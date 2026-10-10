-- 007 — 「보험 리모델링 진단」 상담 퍼널 v1 (docs/funnel_v1.md)
-- ⚠️ 아직 적용하지 않았다. 로버트 승인 후 SQL Editor 또는 MCP apply_migration 으로 적용.
--
-- 원칙
--  - 증권·계약 실데이터 컬럼 없음(§2 · §6.1). 파일 업로드 경로 없음.
--  - RLS 켜고 정책 0개 → anon/authenticated 키로는 읽기·쓰기 불가. 서버(service_role)만 접근.
--  - 개인정보는 funnel_leads 에만. funnel_lead_events 는 식별정보 없는 단계 기록 → 파기 후에도 퍼널 통계가 남는다.
--  - 보유기간: 동의문 「수집일로부터 3개월(목적 달성 시 즉시 파기)」 → purge_after 기본 3개월.

create table if not exists public.funnel_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  name text not null check (char_length(name) between 1 and 30),
  phone text not null check (phone ~ '^01[016789][0-9]{7,8}$'),
  age_band text not null check (age_band in ('20대 이하','30대','40대','50대','60대 이상')),
  interests text[] not null check (cardinality(interests) >= 1),
  message text check (message is null or char_length(message) <= 500),

  privacy_collect_agreed boolean not null check (privacy_collect_agreed = true),
  consent_version text not null,

  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  landing_path text,

  status text not null default '신청'
    check (status in ('신청','연락됨','분석완료','상담','계약','불발')),
  status_changed_at timestamptz not null default now(),
  lost_reason text,
  memo text,
  -- 유효 상담 판정(지표): 상담 단계에 실제로 앉았는가. 로버트 9/29 「질 우선」
  is_qualified boolean not null default false,

  purge_after timestamptz not null default (now() + interval '3 months')
);

create index if not exists funnel_leads_created_idx on public.funnel_leads (created_at desc);
create index if not exists funnel_leads_phone_idx on public.funnel_leads (phone, created_at desc);
create index if not exists funnel_leads_purge_idx on public.funnel_leads (purge_after);

alter table public.funnel_leads enable row level security;
-- 정책을 만들지 않는다(의도). 서버 service_role 만 접근.

create table if not exists public.funnel_lead_events (
  id bigserial primary key,
  lead_id uuid not null,              -- FK 없음(의도): 리드 파기 후에도 단계 통계 보존
  created_at timestamptz not null default now(),
  from_status text,
  to_status text not null,
  utm_source text,
  utm_campaign text
);
create index if not exists funnel_lead_events_lead_idx on public.funnel_lead_events (lead_id);
create index if not exists funnel_lead_events_created_idx on public.funnel_lead_events (created_at desc);

alter table public.funnel_lead_events enable row level security;

-- 보유기간 경과분 파기. 스케줄(pg_cron 또는 GitHub Actions 일 1회)은 로버트 결정 후 건다.
-- 「계약」 단계 고객 정보는 이후 보험사·회사 계약 절차로 넘어가므로 여기 남길 이유가 없다 — 동일하게 파기.
create or replace function public.purge_expired_funnel_leads()
returns integer
language sql
security definer
set search_path = public
as $$
  with d as (
    delete from public.funnel_leads where purge_after < now() returning 1
  )
  select count(*)::int from d;
$$;
revoke all on function public.purge_expired_funnel_leads() from public, anon, authenticated;

-- 퍼널 집계(식별정보 없음) — 어드민·보고용
create or replace view public.funnel_stage_counts
with (security_invoker = true) as
select
  date_trunc('week', created_at) as week,
  coalesce(utm_source, '직접') as source,
  coalesce(utm_campaign, '-') as campaign,
  count(distinct lead_id) filter (where to_status = '신청')    as applied,
  count(distinct lead_id) filter (where to_status = '연락됨')  as contacted,
  count(distinct lead_id) filter (where to_status = '분석완료') as analyzed,
  count(distinct lead_id) filter (where to_status = '상담')    as consulted,
  count(distinct lead_id) filter (where to_status = '계약')    as contracted,
  count(distinct lead_id) filter (where to_status = '불발')    as lost
from public.funnel_lead_events
group by 1, 2, 3;
