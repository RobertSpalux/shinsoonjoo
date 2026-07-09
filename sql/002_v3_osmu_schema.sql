-- ============================================================
-- 신순주의 선한 금융 V3.0 — OSMU 자동화 스키마
-- Supabase SQL Editor에서 실행하세요 (create_consultations.sql 이후)
-- ============================================================

-- 1. 콘텐츠 마스터 테이블 (원소스 멀티유즈 통합 관리)
create table if not exists public.premium_articles (
  id uuid primary key default gen_random_uuid(),
  title varchar not null,
  slug varchar not null unique,              -- SEO 친화 URL (/news/[slug])
  category varchar not null,                 -- 생활경제, 금융뉴스, 보상꿀팁, 판례해설, 천안소식
  summary text,                              -- 목록/OG description용 2~3문장 요약
  tags text[] default '{}',

  -- 원천 소스 정보
  raw_source_url text,
  raw_source_name varchar,                   -- 금융감독원, 한국은행 등
  raw_source_excerpt text,                   -- 원문 발췌 (재생성/검증용)

  -- 채널별 최적화 원고 데이터
  main_website_markdown text,                -- 본진 웹사이트용 테크니컬 마크다운
  naver_blog_content text,                   -- 네이버 스마트블록 저격용 공감/Q&A형 원고
  blogspot_content text,                     -- 구글 검색 상위 노출용 개조식 칼럼 원고
  carousel_json jsonb,                       -- 인스타/스레드 카드뉴스용 1~10장 텍스트 배열
  faq_json jsonb,                            -- FAQPage 리치 스니펫용 Q&A 배열

  -- 그래픽 에셋 및 배포 상태
  image_paths text[] default '{}',           -- Puppeteer 생성 1080x1350 카드뉴스 Storage 경로
  og_image_path text,                        -- 대표 OG 이미지
  is_main_published boolean default false,
  is_naver_published boolean default false,
  is_blogspot_published boolean default false,
  is_instagram_published boolean default false,
  published_at timestamptz,                  -- 본진 발행 시각 (JSON-LD datePublished)

  view_count int default 0,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_premium_articles_published
  on public.premium_articles (is_main_published, published_at desc);
create index if not exists idx_premium_articles_category
  on public.premium_articles (category, published_at desc);
create index if not exists idx_premium_articles_slug
  on public.premium_articles (slug);

-- updated_at 자동 갱신
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_premium_articles_updated on public.premium_articles;
create trigger trg_premium_articles_updated
  before update on public.premium_articles
  for each row execute function public.set_updated_at();

-- RLS: 발행된 글만 익명 읽기 허용, 쓰기는 service_role 전용
alter table public.premium_articles enable row level security;

drop policy if exists "Public read published articles" on public.premium_articles;
create policy "Public read published articles"
  on public.premium_articles
  for select
  to anon, authenticated
  using (is_main_published = true);

-- 조회수 증가 RPC (익명 update 권한 없이 안전하게)
create or replace function public.increment_article_view(article_slug varchar)
returns void language sql security definer as $$
  update public.premium_articles
  set view_count = view_count + 1
  where slug = article_slug and is_main_published = true;
$$;

-- 2. 유입 및 자산 진단 고농도 고객 DB 테이블
create table if not exists public.lead_consultings (
  id uuid primary key default gen_random_uuid(),
  name varchar not null,
  phone varchar not null,
  quiz_responses jsonb,                      -- 4단계 자산 방어력 진단 응답
  quiz_score int,                            -- 진단 점수 (리포트/후속 상담 우선순위용)
  lead_source varchar,                       -- instagram, google_seo, naver_blog, direct 등
  kakao_synced boolean default false,        -- 카카오싱크 유입 여부 (2단계 도입 대비)
  privacy_agreed boolean default false not null,
  status varchar default 'new',              -- new, 연락완료, 계약진행, 보류
  memo text,
  created_at timestamptz default now() not null
);

create index if not exists idx_lead_consultings_created
  on public.lead_consultings (created_at desc);
create index if not exists idx_lead_consultings_status
  on public.lead_consultings (status, created_at desc);

-- RLS: 익명 INSERT만 허용 (조회는 service_role 전용)
alter table public.lead_consultings enable row level security;

drop policy if exists "Allow anonymous lead inserts" on public.lead_consultings;
create policy "Allow anonymous lead inserts"
  on public.lead_consultings
  for insert
  to anon
  with check (privacy_agreed = true);

-- 3. 카드뉴스 이미지 Storage 버킷 (public 읽기)
insert into storage.buckets (id, name, public)
values ('card-news', 'card-news', true)
on conflict (id) do nothing;

drop policy if exists "Public read card-news" on storage.objects;
create policy "Public read card-news"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'card-news');
