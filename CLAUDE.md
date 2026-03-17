**Markdown

# Project: 신순주 지점장 프리미엄 웹사이트 (Premium Insurance PB Website)

## 1. Project Overview

- 24년 차 업계 상위 1% 보험 전문가(지점장)를 위한 하이엔드 개인 웹사이트.
- 단순 영업사원이 아닌 '프라이빗 뱅커(PB)' 수준의 신뢰감과 권위를 시각화.
- 유지보수 비용 최소화 (Serverless & Free tier 위주 아키텍처).

## 2. Tech Stack

- **Framework:** Next.js (App Router)
- **Styling:** Tailwind CSS
- **Animation:** Framer Motion (스크롤 애니메이션, 숫자 카운팅 틱 효과 필수)
- **Database:** Supabase (상담 예약 폼 DB)
- **AI/Automation:** Gemini 1.5 Flash API (뉴스 자동 요약 파이프라인)
- **Notification:** Telegram Bot API (상담 접수 시 즉각 알림)
- **Analytics:** Vercel Analytics 또는 GA4

## 3. Design System & UI/UX Rules

- **Tone & Manner:** 에디토리얼(잡지) 스타일, 미니멀리즘, 여백의 미(Padding/Margin 여유 있게).
- **Color Palette:** - Main Background: 깊이 있는 다크 네이비 (`bg-slate-900` 등)

  - Text: 퓨어 화이트 (`text-white`), 라이트 그레이 (`text-slate-300`)
  - Accent/Point: 샴페인 골드 또는 부드러운 베이지 계열 (프리미엄 느낌)
- **Typography:** 제목은 크고 무게감 있게, 본문은 가독성 높고 세련되게 처리.
- **Images:** 대형 프로필 사진 지양. 정돈된 크기의 프레임 안에 모노톤/흑백 이미지로 세련되게 배치.

## 4. Coding Conventions & Error Handling

- 모든 컴포넌트는 함수형 컴포넌트로 작성하고, 명확하게 분리할 것.
- 모바일 퍼스트(Mobile-first) 반응형 디자인을 기본으로 적용할 것 (`md:`, `lg:` 적극 활용).
- 코드를 작성할 때 항상 '고급스러움'과 '부드러운 트랜지션'을 염두에 둘 것.
- **Error Fallback:** Gemini API 등 외부 통신 실패 시, 하드코딩된 '시그니처 칼럼' 등 Fallback UI가 자연스럽게 노출되도록 에러 핸들링 필수.
- **Security:** 상담 폼에는 반드시 개인정보 수집 동의 체크 및 보안 안내 문구 포함.

## 5. SEO & Organic Traffic (자연 검색 유입 최적화)

- **Server-Side Rendering (SSR):** 자동화 블로그의 기사 목록과 상세 페이지는 크롤러가 읽을 수 있도록 Next.js Server Components를 사용할 것.
- **Metadata API:** 모든 페이지에 Next.js `generateMetadata`를 사용하여 Title, Description, Open Graph(OG) 동적 생성.
- **Semantic HTML:** `<article>`, `<section>`, `<h1>`~`<h6>` 등 시맨틱 태그를 엄격하게 사용할 것.
- **Sitemap & Robots.txt:** Next.js의 기능을 활용하여 동적 블로그 글 색인 자동화.
- **Schema Markup (JSON-LD):** 블로그 포스트에 `Article` 구조화된 데이터(JSON-LD)를 삽입하여 리치 스니펫 노출 유도.

**
