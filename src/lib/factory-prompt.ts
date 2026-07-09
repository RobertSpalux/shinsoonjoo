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
- main_website_markdown: 본진 웹사이트용. 진지하고 전문적인 톤의 테크니컬 칼럼. ## 소제목 3~5개, 표/리스트 활용, 1200~2000자. 마지막에 "신순주의 한 줄 조언" 블록인용(>)으로 마무리.
- naver_blog_content: 네이버 블로그용. 친근한 존댓말 공감체("~하셨나요?", "저도 상담하다 보면..."). 스마트블록 저격을 위해 Q&A 소제목 형태. 이모지 절제(문단당 최대 1개). 1000~1500자.
- blogspot_content: 구글 블로그스팟용. 개조식(번호·불릿 중심), 롱테일 키워드를 소제목에 배치, 전문 용어와 근거 중심. 800~1200자.
- carousel_json: 인스타/스레드 카드뉴스 8~10장. 1장은 강력한 훅(질문 or 충격 수치), 중간 장들은 장당 핵심 1개(제목 15자 이내 + 본문 2줄 이내), 마지막 장은 "저장하고 두고두고 보세요" CTA.
- faq_json: 이 주제로 사람들이 실제 검색할 질문 3~5개와 간결한 답변 (FAQPage 리치 스니펫용).
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
    "main_website_markdown",
    "naver_blog_content",
    "blogspot_content",
    "carousel_json",
    "faq_json",
  ],
  properties: {
    title: { type: "string", description: "검색 클릭을 부르는 한국어 제목 (32자 이내)" },
    slug: { type: "string", description: "영문 소문자-하이픈 SEO 슬러그" },
    category: {
      type: "string",
      enum: ["금융뉴스", "생활경제", "보상꿀팁", "판례해설", "천안소식"],
    },
    summary: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    main_website_markdown: { type: "string" },
    naver_blog_content: { type: "string" },
    blogspot_content: { type: "string" },
    carousel_json: {
      type: "array",
      description: "카드뉴스 8~10장",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "body"],
        properties: {
          heading: { type: "string", description: "카드 제목 (15자 이내)" },
          body: { type: "string", description: "카드 본문 (2줄 이내)" },
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
  },
} as const;
