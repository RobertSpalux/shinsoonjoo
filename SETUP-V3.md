# V3.0 「신순주의 선한 금융」 가동 가이드

코드는 전부 배포되어 있고, 아래 **3가지 스위치**만 켜면 완전 자동화가 시작됩니다.

## 1단계 — Supabase SQL 실행 (1회, 5분)

[Supabase 대시보드](https://supabase.com/dashboard) → SHIN 프로젝트(`etmfglemasyggyeyprre`) → SQL Editor에서
`sql/002_v3_osmu_schema.sql` 파일 내용을 통째로 붙여넣고 실행.

생성되는 것: `premium_articles`(콘텐츠 마스터), `lead_consultings`(진단 리드), `card-news` 스토리지 버킷, RLS 정책, 조회수 RPC.

## 2단계 — Vercel 환경변수 추가

Vercel 프로젝트 → Settings → Environment Variables에 추가:

| 키 | 값 | 어디서 얻나 |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | 서비스 롤 키 | Supabase → Settings → API → `service_role` (비밀!) |
| `ANTHROPIC_API_KEY` | Claude API 키 | console.anthropic.com → API Keys |
| `FACTORY_SECRET` | 아무 긴 랜덤 문자열 | 직접 생성 (예: 비밀번호 생성기 64자) |

기존 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `TELEGRAM_*`은 그대로 유지.

## 3단계 — GitHub Secrets 등록 (자동화 크론용)

GitHub 레포 → Settings → Secrets and variables → Actions → **Secrets**:

- `NEXT_PUBLIC_SUPABASE_URL` (Vercel과 동일)
- `SUPABASE_SERVICE_ROLE_KEY`
- `FACTORY_SECRET` (Vercel과 동일 값)
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`

**Variables** (선택): `SITE_URL`(기본 https://soonjoo.vercel.app), `DAILY_ARTICLE_LIMIT`(기본 2)

등록 후 Actions 탭 → "Daily OSMU Content Factory" → **Run workflow** 버튼으로 즉시 테스트 가능.
이후 매일 06:00 KST에 자동 실행됩니다.

## 매일 아침 일어나는 일 (전자동)

1. 금감원 보도자료·경제 뉴스 수집 → 보험 관련성 높은 기사 2건 선별
2. Claude가 4개 채널 원고 동시 생성 (웹 칼럼 / 네이버 공감체 / 블로그스팟 개조식 / 카드뉴스 10장 + FAQ)
3. 본진 사이트(`/news`) 즉시 자동 발행 — sitemap·JSON-LD·llms.txt 자동 갱신
4. 카드뉴스 1080×1350 PNG 자동 렌더링 → Supabase Storage 저장
5. 텔레그램으로 도착: 네이버용 원고 파일 + 블로그스팟용 원고 파일 + 완료 알림

## 사람이 하는 일 (하루 5분)

- 텔레그램에 온 네이버 원고를 복사 → 네이버 블로그에 붙여넣기 (네이버는 공식 발행 API가 없어 이 단계만 수동)
- Supabase Storage → `card-news` 폴더의 이미지를 인스타/스레드에 업로드
- 진단 리드·상담 신청은 기존처럼 텔레그램으로 실시간 도착

## 남은 확장 옵션 (준비되면 요청)

- **카카오싱크**: 사업자 인증 카카오 비즈 앱 + 카톡 채널 개설 후 → 진단 폼을 카카오 로그인으로 교체
- **인스타 완전 자동 업로드**: Meta 비즈니스 계정 + Graph API 앱 심사 후 연동
- **구글 블로그스팟 자동 발행**: Google Cloud OAuth 클라이언트 생성 후 Blogger API 연동
- **구글 서치콘솔**: 배포 후 sitemap(https://soonjoo.vercel.app/sitemap.xml) 제출
