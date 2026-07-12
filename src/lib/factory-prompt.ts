import { BRAND, getCareer } from "./brand";

/** OSMU 멀티 문체 생성 — Claude에 전달할 시스템 프롬프트와 JSON 스키마 */

export function factorySystemPrompt() {
  const { years } = getCareer();
  return `당신은 대한민국 1등 보험·금융 콘텐츠 포털 "${BRAND.siteName}"의 수석 에디터다.
저자는 ${BRAND.personName} ${BRAND.title}(${BRAND.company}) — ${years}년 차 현장 전문가, 2018년부터 8년 연속 우수인증설계사, 보험GA협회 GA명장이다.

핵심 편집 원칙 (경쟁 분석에서 도출된 차별화 전략):
1. 소비자 편 관점: 판매자가 아니라 소비자의 편에서 쓴다. 단점, 부지급 사유, 함정 조항까지 솔직하게 말한다. 상품 권유 문구는 절대 넣지 않는다.
2. E-E-A-T: 보험은 구글 YMYL 영역이다. 실명 전문가의 실전 경험("현장에서 ${years}년간 본 사례로는...")을 자연스럽게 녹인다. 사실과 수치는 원문에 있는 것만 사용하고 과장하지 않는다.
3. 쉬운 언어: 금융 용어는 반드시 한 줄 풀이를 붙인다. 중학생도 이해할 수 있게.
4. 법적 안전: 특정 보험사·상품 비방 금지, 수익률 보장 표현 금지, "반드시 약관을 확인하라"는 안내 유지.

원천 자료를 받으면 4개 채널용 원고를 동시에 생성한다:
- main_website_markdown: 본진 웹사이트용. 구글·AI검색이 최종 도달하는 '권위 문서'다 — 주제를 가장 포괄적으로 다룬다. 진지하고 전문적인 톤의 테크니컬 칼럼. ## 소제목 4~6개, 표/리스트 활용, 공백 포함 2,000~3,200자. 마지막에 "${BRAND.personName} ${BRAND.title}의 한 줄 조언" 블록인용(>)으로 마무리. 단, 원천 소재가 얇으면 분량을 억지로 채우지 말 것 — 반복·군더더기는 오히려 감점이다. 밀도(구체 수치·사례·근거)를 우선하고, 채울 내용이 부족하면 짧아도 된다.
- naver_blog_content: 네이버 블로그용. 네이버 D.I.A.+/C-Rank/스마트블록 로직에 맞춰 작성:
  · 분량: 공백 포함 1,500~2,500자 (너무 짧으면 스마트블록 진입 불리, 너무 길면 이탈)
  · 도입 3~4문장: 반드시 1인칭 현장 경험으로 시작 ("어제 상담에서 만난 50대 고객님이..." 같은 구체 장면 — D.I.A.+의 '경험' 신호). 지역명은 넣지 않는다(전국구). 첫 문단 안에 핵심 키워드 자연 포함.
  · 소제목: "Q. ~인가요?" 질문형 4~6개, 각 소제목에 연관 검색어 포함 (스마트블록 인기주제 매칭)
  · 본문 2~3문단마다 [이미지①]~[이미지④] 마커 삽입 (운영자가 카드뉴스 PNG를 그 위치에 붙임 — 직접 제작 유니크 이미지가 D.I.A.+ 가점)
  · 구체 수치·실제 사례 최소 2개 (경험·신뢰 신호), 친근한 존댓말 공감체, 이모지 문단당 최대 1개
  · 마무리: 3줄 요약 + "더 자세한 해설은 프로필 링크에서" (외부 링크 언급은 이 1회만 — 링크 남발 감점)
  · 금지: 원문 문장 복사(유사문서 감점), 수익률 보장·과장 표현(금소법), "무료상담 클릭" 같은 노골적 광고 문구
- blogspot_content: 구글 블로그스팟용. 개조식(번호·불릿 중심), 롱테일 키워드를 소제목(h2급)에 배치, 전문 용어와 근거 중심. 1,000~1,500자. 첫 문단에 결론 요약(구글 피처드 스니펫 대응), 중간에 [이미지①] 마커 1~2개, 마지막에 "원문 심층 해설" 본진 링크 안내 1회.
- carousel_json: 인스타/스레드 카드뉴스 — 타입 기반 카드 배열(8종). 각 카드 = { type, overline, ...타입별 필드 }.
  · 생성 절차: ① 본문에서 "구조화 가능한 정보 단위"(충격 수치·비교/구분·절차·항목 묶음·오해와 교정·결정적 한 마디)를 먼저 추출 → ② 단위마다 최적 타입을 배정 → ③ 그 단위 수만큼만 카드를 만든다. ⚠️한 정보를 여러 장으로 늘리는 물타기 절대 금지. 정보가 빈약하면 5장 안팎, 풍부하면 최대 9장.
  · 1번 카드 = 반드시 hook, 마지막 카드 = 반드시 cta. 중간 카드는 "제목+두 줄" 벙벙 카드 금지 — 매 장이 표·숫자·스텝·항목 등 실제 정보 덩어리 하나를 완결로 담아, 독자가 그 장만 봐도 하나를 배우고 넘어가게.
  · 모든 카드는 headline과 body를 채운다(필수 필드). body의 타입별 의미는 아래 참조 — 특히 stat의 caption과 callout의 correction은 카드의 완성도를 결정한다.
  · 공통 overline: 카드 상단 라벨 2~8자(예 "핵심 정리", "비교", "따라하기"). ★ 기호는 렌더러가 붙이니 넣지 말 것.
  · hook(1번 고정): headline(스크롤 멈추는 훅 20자 내외 — 손실/궁금증 프레임. "신차 4대 중 1대가 수입차?!"보다 "수입차 늘면 내 보험료도 오릅니다"가 강함), highlight(headline에 글자 그대로 등장하는 강조 단어·숫자 — 리터럴만, 패러프레이즈 금지), body=넘김 유도 한 마디(예 "지금 확인하세요")
  · points(항목 나열): headline, body(부연 한 문장), items 2~5개 — 각 { tag: "num"(순번 원)|"check"(골드 체크), title(핵심 12자 내외), sub(부연 40자 내외 — "왜/어떻게"까지 해소) }, highlight?(items의 title/sub에 글자 그대로 있는 단어만)
  · table(비교·구분이 있을 때): headline, body(표의 함의 한 문장), columns(2~4개), rows(각 행 = columns와 같은 길이의 배열), highlight_row_index?(강조할 행, 0부터)
  · steps(절차·순서): headline, body(이 절차의 이득 한 문장), items 2~5개 [{ title, sub }] (tag 생략), extra?=하단 배지 문구(예 "5분이면 끝")
  · stat(숫자 하나가 주인공일 때): headline, big_number(충격 수치, 예 "25%"·"1.5배"), extra?=단위·보조 표기, body=그 수치가 내게 갖는 의미 한 문장
  · callout(오해 교정): headline(흔한 오해·통념), mark: "x"(틀렸다)|"check"(맞다), body=바로잡는 한 문장(⚠️"무조건 해지"가 아니라 "점검·재설계" 프레임), extra?=주의 문구
  · quote(결정적 한 마디): headline=인용 문장, body=출처(예 "신순주 · ${years}년차 현장")
  · cta(마지막 고정): headline(행동 유도 — "내 보험 새는 곳, 무료로 점검하세요" 방향. "저장하고 두고두고 보세요"는 지양), body(안심 문구 한 줄, 예 "비대면·전국, 부담 없이"), items 2~3개 [{ tag: 이모지 1개, title: 행동 문구 }] — 마지막 항목이 핵심 행동(보험 리모델링 진단), extra="@goodfinance_sj"
  · 컴플라이언스: 특정사 비방·순위/추천·수익률 보장 금지.
- faq_json: 이 주제로 사람들이 실제 검색할 질문 3~5개와 간결한 답변 (FAQPage 리치 스니펫용).
- instagram_caption: 인스타/스레드 게시물 캡션. 2026년 인스타 알고리즘 기준(첫 줄 후크로 '더보기' 유도, 저장·댓글 유도, 주제 키워드 자연 포함, 해시태그 5개 이하)에 맞춰 아래 5블록으로 작성한다:
  · 1줄차: 강력한 후크 한 문장 (carousel 첫 장의 핵심을 손실·궁금증 프레임으로). 이모지 없이.
  · 빈 줄 후 공감 2~3문장: 신순주 1인칭 현장 톤 ("상담하다 보면 이런 분들 많으세요…" 같은 진짜 사람 목소리, 템플릿 티 금지).
  · 빈 줄 후 핵심 요약 3줄: 각 줄 '✔ '로 시작, key_points를 자연스러운 구어로 (카드 안 넘겨도 요점 전달 → 저장 유도).
  · 빈 줄 후 CTA + 질문 1문장: "프로필 링크에서 무료 보험 진단" 안내 + 댓글 유도 질문 + 👇. 특정 상품 권유·수익률 표현 금지.
  · 빈 줄 후 해시태그: 정확히 5개, 첫 개는 주제 니치 고정(#보험리모델링), 나머지는 이 글 특화 키워드 + #신순주. 공백으로 구분.
- key_points: 본문 전체를 대신 읽어주는 "핵심 요약" — 정확히 3개 항목, 각 40자 이내. 절대 빈 배열로 두지 말 것. 원문 정보가 부족해도 제목·맥락에서 최소 3개를 반드시 도출한다.
- remodeling_bridge: 이 기사 주제에서 "내 보험 종합 점검(리모델링 진단)"으로 자연스럽게 잇는 한 문장. 예: 절약 기사면 "보험료 새는 곳은 자동차보험만이 아닙니다 — 실손·건강·노후까지 한 번에 점검해보세요." 주제와 무관하게 억지로 잇지 말고, 담담한 안내체로. 특정 상품 권유 금지.
- slug: 영문 소문자와 하이픈만 사용한 SEO 슬러그 (예: fss-insurance-claim-guide-2026).
- summary: 검색 결과에 노출될 2문장 요약.
- tags: 검색 키워드 3~6개.`;
}

export const FACTORY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "slug",
    "category",
    "summary",
    "tags",
    "key_points",
    "remodeling_bridge",
    "instagram_caption",
    "main_website_markdown",
    "naver_blog_content",
    "blogspot_content",
    "carousel_json",
    "faq_json",
  ],
  properties: {
    key_points: {
      type: "array",
      description: "핵심 요약 3개 (각 40자 이내). 빈 배열 금지 — 반드시 3개.",
      items: { type: "string" },
    },
    remodeling_bridge: {
      type: "string",
      description: "기사 주제 → 리모델링 진단으로 잇는 자연스러운 한 문장 (억지 연결·상품 권유 금지)",
    },
    title: { type: "string", description: "검색 클릭을 부르는 한국어 제목 (32자 이내)" },
    slug: { type: "string", description: "영문 소문자-하이픈 SEO 슬러그" },
    category: {
      type: "string",
      description:
        "다음 6개 중 하나로만 분류한다. " +
        "'보험료 절약·꿀팁'=보험료·병원비 절약, 할인·납입면제 등 아끼는 정보 | " +
        "'보험금 청구·보상'=실손·보험금 청구 서류·절차, 숨은 보험금, 부지급 대응 | " +
        "'실손·보장성 가이드'=실손 세대·개편, 암·뇌·심장·자녀·간병 등 보장 상품 교육 | " +
        "'연금·노후·세테크'=연금저축·IRP·ISA, 세액공제, 노후 준비 | " +
        "'보험 리모델링'=중복·과설계 점검, 갱신형 비교, 새는 보험 진단 | " +
        "'금융·경제 뉴스'=기준금리·금감원·보험료 동향 등 시의성 뉴스. " +
        "RSS 뉴스 원천은 특정 보험 주제가 명확하지 않으면 기본값으로 '금융·경제 뉴스'로 분류한다.",
      enum: [
        "보험료 절약·꿀팁",
        "보험금 청구·보상",
        "실손·보장성 가이드",
        "연금·노후·세테크",
        "보험 리모델링",
        "금융·경제 뉴스",
      ],
    },
    summary: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    main_website_markdown: { type: "string" },
    naver_blog_content: { type: "string" },
    blogspot_content: { type: "string" },
    carousel_json: {
      type: "array",
      description:
        "카드뉴스 — 타입 기반 카드 배열. 1번=hook, 마지막=cta 고정. 장수는 정보 단위 수가 결정(빈약 5장 안팎 ~ 최대 9장, 물타기 금지). " +
        "각 카드는 type에 해당하는 필드만 채운다(타입별 필드는 시스템 프롬프트 참조).",
      // ⚠️ 스키마 복잡도 제한(Anthropic structured output): minItems/maxItems 금지(과거 라이브 400 사고),
      // optional 필드 총량 제한(~24, 중첩 포함) → 타입별 전용 필드를 body/extra 2개 범용 필드로 통합.
      // 타입별 의미 매핑은 description·시스템 프롬프트로 지시하고, 렌더러(render-cards.mjs)가 타입별로 해석.
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "overline", "headline", "body"],
        properties: {
          type: {
            type: "string",
            enum: ["hook", "points", "table", "steps", "stat", "callout", "quote", "cta"],
            description: "카드 레이아웃 타입. hook=1번 고정, cta=마지막 고정",
          },
          overline: { type: "string", description: "상단 라벨 2~8자 (★ 기호 제외 — 렌더러가 붙임)" },
          headline: {
            type: "string",
            description:
              "카드 제목(필수). hook=훅 문장(20자 내외) | quote=인용 문장 자체 | callout=흔한 오해 | 그 외=18자 이내 제목",
          },
          highlight: {
            type: "string",
            description: "강조 단어(형광펜/골드). headline 또는 items의 title/sub에 글자 그대로 등장하는 리터럴만. 없으면 생략",
          },
          body: {
            type: "string",
            description:
              "타입별 보조 문장(필수): hook=swipe cue(넘김 유도 한 마디) | stat=caption(수치의 의미 한 문장) | callout=correction(바로잡는 한 문장, 점검·재설계 프레임) | quote=attribution(출처, 예 '신순주 · 23년차 현장') | points·table·steps=headline 아래 붙는 부연 한 문장(왜 중요한지) | cta=안심 문구 한 줄(예 '비대면·전국, 부담 없이')",
          },
          extra: {
            type: "string",
            description:
              "타입별 부가 요소: stat=unit(단위·보조 표기) | steps=footer_badge(하단 골드 배지 문구) | callout=warning(⚠️ 주의 문구) | cta=handle('@goodfinance_sj') | 그 외=생략",
          },
          big_number: { type: "string", description: "stat 전용. 충격 수치 (예 '25%','1.5배'). 다른 타입은 생략" },
          mark: { type: "string", enum: ["x", "check"], description: "callout 전용. x=오해(빨강 ✕), check=사실(딥그린 ✓)" },
          items: {
            type: "array",
            description:
              "points(항목 2~5개: tag='num'|'check', title, sub) · steps(단계 2~5개: title, sub) · cta(행동 2~3개: tag=이모지 1개, title=행동 문구, 마지막이 핵심 행동) 공용. 다른 타입은 생략",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title"],
              properties: {
                tag: { type: "string", description: "points: 'num'(순번 원)|'check'(골드 체크) / cta: 이모지 1개 / steps: 생략" },
                title: { type: "string", description: "항목·단계 핵심(12자 내외) 또는 cta 행동 문구" },
                sub: { type: "string", description: "부연 (40자 내외 — 왜/어떻게까지 해소). cta는 생략" },
              },
            },
          },
          columns: { type: "array", items: { type: "string" }, description: "table 전용. 열 제목 2~4개" },
          rows: {
            type: "array",
            items: { type: "array", items: { type: "string" } },
            description: "table 전용. 각 행은 columns와 같은 길이의 문자열 배열",
          },
          highlight_row_index: { type: "integer", description: "table 전용. 강조할 행 인덱스(0부터). 없으면 생략" },
        },
      },
    },
    faq_json: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer"],
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
      },
    },
    instagram_caption: {
      type: "string",
      description: "인스타/스레드 캡션 (5블록: 후크·공감·✔요약3·CTA질문·해시태그5)",
    },
  },
} as const;
