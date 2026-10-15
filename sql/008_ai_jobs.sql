-- 008 — AI 생성 작업 큐(API2 2026-10-15). 어드민 「초안 생성」·팩토리 생성을 Vercel 서버가 아니라 로컬 PC 가 한다.
-- ⚠️ 아직 적용하지 않았다. 관제탑이 SHIN DB(lgbbflolunlseutvqaso)에 SQL Editor 또는 MCP apply_migration 으로 적용.
--
-- 흐름
--  1. route(/api/admin/kin · /api/factory/generate)가 입력을 검사하고 queued 행을 넣은 뒤 job id 를 돌려준다.
--  2. 로컬 러너(scripts/ai_job_runner.py)가 queued 를 running 으로 집어(status=queued 조건부 갱신 — 한 대만 집는다)
--     scripts/ai_job_worker.mts 로 생성(`claude -p` 구독)하고 done/error 와 result 를 기록한다.
--  3. 어드민 화면·크론 스크립트가 /api/admin/ai-jobs/<id> · /api/factory/jobs/<id> 로 상태를 폴링한다.
--
-- 원칙
--  - RLS 켜고 정책 0개 → service_role(서버·로컬 러너)만 접근.
--  - result = 종전 route 응답 본문 그대로(kin: {success, answer} · factory: {success, article, ...}).
--    result_status = 종전 HTTP 상태(200·409·422…) — 호출자가 종전과 같은 분기를 하도록.
--  - payload 에 주민번호·계약 실데이터는 들어오지 않는다(지식iN 질문 원문·뉴스 원문뿐, §6.1).

create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('kin_draft', 'factory_generate')),
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  result jsonb,
  result_status integer,
  error text,
  attempts integer not null default 0,
  runner text,                         -- 집어 간 PC 이름(관측용)
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_jobs_queue_idx on public.ai_jobs (status, created_at);

create or replace function public.ai_jobs_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_ai_jobs_updated_at on public.ai_jobs;
create trigger trg_ai_jobs_updated_at
  before update on public.ai_jobs
  for each row execute function public.ai_jobs_touch_updated_at();

alter table public.ai_jobs enable row level security;
-- 정책을 만들지 않는다(의도). 서버·로컬 러너 service_role 만 접근.
