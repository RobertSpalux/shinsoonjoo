-- Supabase SQL Editor에서 실행하세요
-- consultations 테이블 생성

create table if not exists public.consultations (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now() not null,
  name text not null,
  phone text not null,
  category text not null,
  message text,
  privacy_agreed boolean default false not null,
  status text default '접수완료' not null
);

-- RLS(Row Level Security) 활성화
alter table public.consultations enable row level security;

-- 익명 사용자가 INSERT만 가능하도록 정책 설정
create policy "Allow anonymous inserts"
  on public.consultations
  for insert
  to anon
  with check (true);

-- 인덱스: 최신순 조회 최적화
create index if not exists idx_consultations_created_at
  on public.consultations (created_at desc);
