/**
 * 상록수(evergreen) 시드뱅크 — 커밋 M3.
 * 키워드 소유용 기획 콘텐츠의 기획서. 한 시드 = 한 편 (DB seed_key unique로 이중 생성 방지).
 *
 * ⚠️ sources는 CONTENT-STRATEGY §9-2 표의 공공 1차 소스 URL만 (민간 매체 재가공 금지 — §9-1).
 * category는 팩토리 스키마의 6-카테고리 enum 문자열과 정확히 일치해야 한다.
 * 배열 순서 = 발행 우선순위 (선정: 미생성 중 intent 일치 첫 번째, isHub는 intent 무관 최우선).
 */

// CONTENT-STRATEGY §9-2 그라운딩 소스 (재가공 O)
// ⚠️ 2026-07-12 실측: 게시판(list.do) 5종은 파싱·키워드 검색까지 정상.
//    반면 금감원 안내 페이지 3종(is007.jsp·isintro.jsp·/fss/lifeplan)은 사이트 개편으로
//    에러 페이지 반환 — 스크립트 방어 로직이 자동 스킵하므로 복구 대비로 값은 유지하되,
//    모든 시드는 반드시 살아있는 게시판 소스를 최소 1개 함께 갖는다.
//    consumer.insure.or.kr(생보협회)는 JS 포털이라 메뉴 텍스트만 추출됨(오염 위험) → 사용 제외.
const SRC = {
  /** 금융꿀팁 200선 (파인) — 절약·청구·실손 ✓살아있음 */
  KKULTIP: "https://fine.fss.or.kr/fine/bbs/B0000340/list.do?menuNo=900014",
  /** 생활금융톡톡 (파인) — 전반 ✓살아있음 */
  TALKTALK: "https://fine.fss.or.kr/fine/bbs/B0000341/list.do?menuNo=900023",
  /** 민원사례 (파인) — 청구·보상 익명 실사례 ✓살아있음 */
  MINWON: "https://fine.fss.or.kr/fine/bbs/B0000343/list.do?menuNo=900025",
  /** 금융소비자경보 (금감원) — 사기예방·신선 ✓살아있음 */
  ALERT: "https://www.fss.or.kr/fss/bbs/B0000175/list.do?menuNo=200204",
  /** 보험 표준약관 (금감원) — 실손·보장성 사실검증 ✓살아있음 */
  TERMS: "https://www.fss.or.kr/fss/bbs/B0000115/list.do?menuNo=200504",
  /** 거래단계별 핵심정보(보험) ⚠️죽음(에러 페이지) — 복구 대비 유지 */
  INS_INTRO: "https://www.fss.or.kr/main/prc/is/isintro.jsp",
  /** 내보험 다보여/찾아줌 ⚠️죽음(에러 페이지) — 복구 대비 유지 */
  MY_INSURANCE: "https://www.fss.or.kr/main/prc/is/sub/is007.jsp",
  /** 통합연금포털 ⚠️죽음(도메인 통합 안내만) — 복구 대비 유지 */
  LIFEPLAN: "https://www.fss.or.kr/fss/lifeplan",
};

export const EVERGREEN_SEEDS = [
  // ── 0. 허브 (반드시 첫 편 — intent 무관 최우선) ──────────────────────
  {
    key: "remodeling-hub",
    title: "보험 리모델링 완벽 가이드 — 새는 보험, 어디서 어떻게 잡는가",
    category: "보험 리모델링",
    intent: "전환",
    isHub: true,
    keywords: ["보험 리모델링", "보험 점검", "새는 보험", "보험 재설계", "내보험다보여"],
    sources: [SRC.MY_INSURANCE, SRC.ALERT, SRC.KKULTIP],
  },

  // ── 유입: 보험료 절약·꿀팁 (CONTENT-STRATEGY §3 — 절약·청구 먼저) ──────
  {
    key: "car-insurance-savings",
    title: "자동차보험료 아끼는 법 — 할인특약부터 마일리지까지",
    category: "보험료 절약·꿀팁",
    intent: "유입",
    keywords: ["자동차보험료 할인", "자동차보험 특약", "마일리지 특약", "자동차보험료 아끼기"],
    sources: [SRC.KKULTIP, SRC.TALKTALK],
  },
  {
    key: "insurance-discounts-total",
    title: "몰라서 못 받는 보험료 할인 총정리",
    category: "보험료 절약·꿀팁",
    intent: "유입",
    keywords: ["보험료 할인", "보험료 절약", "할인 특약", "건강체 할인"],
    sources: [SRC.KKULTIP, SRC.TALKTALK],
  },
  {
    key: "premium-waiver-guide",
    title: "보험료 납입면제, 제대로 알고 활용하는 법",
    category: "보험료 절약·꿀팁",
    intent: "유입",
    keywords: ["납입면제", "납입면제 조건", "보험료 면제", "납입면제 특약"],
    sources: [SRC.KKULTIP, SRC.INS_INTRO, SRC.TERMS],
  },
  {
    key: "hospital-cost-support",
    title: "병원비 아끼는 국가 지원제도 총정리",
    category: "보험료 절약·꿀팁",
    intent: "유입",
    keywords: ["병원비 지원", "본인부담상한제", "재난적 의료비", "의료비 지원제도"],
    sources: [SRC.TALKTALK, SRC.KKULTIP],
  },

  // ── 유입: 보험금 청구·보상 ──────────────────────────────────────────
  {
    key: "silson-claim-guide",
    title: "실손보험 청구 완벽 가이드 — 서류부터 실손24까지",
    category: "보험금 청구·보상",
    intent: "유입",
    keywords: ["실손보험 청구", "실손 청구 서류", "실손24", "보험금 청구 방법"],
    sources: [SRC.KKULTIP, SRC.MINWON],
  },
  {
    key: "claim-docs-by-amount",
    title: "보험금 청구 금액별 필요서류 한눈에 정리",
    category: "보험금 청구·보상",
    intent: "유입",
    keywords: ["보험금 청구 서류", "진단서", "진료비 세부내역서", "소액 청구"],
    sources: [SRC.KKULTIP, SRC.TERMS],
  },
  {
    key: "hidden-insurance-money",
    title: "숨은 보험금 찾기 — 내보험찾아줌 사용법",
    category: "보험금 청구·보상",
    intent: "유입",
    keywords: ["숨은 보험금", "내보험찾아줌", "휴면보험금", "미청구 보험금"],
    sources: [SRC.MY_INSURANCE, SRC.KKULTIP],
  },
  {
    key: "parents-claim-proxy",
    title: "부모님 실비 대리청구, 이렇게 하세요",
    category: "보험금 청구·보상",
    intent: "유입",
    keywords: ["실손 대리청구", "부모님 보험금 청구", "지정대리청구인"],
    sources: [SRC.KKULTIP, SRC.MINWON],
  },
  {
    key: "claim-denial-top5",
    title: "보험금 부지급 대표 사유 5가지와 대응법",
    category: "보험금 청구·보상",
    intent: "유입",
    keywords: ["보험금 부지급", "보험금 거절", "고지의무 위반", "부지급 사유"],
    sources: [SRC.MINWON, SRC.ALERT],
  },

  // ── 유입: 실손·보장성 가이드 ────────────────────────────────────────
  {
    key: "silson-generations",
    title: "실손보험 1~5세대 차이 총정리 — 내 실손은 몇 세대인가",
    category: "실손·보장성 가이드",
    intent: "유입",
    keywords: ["실손보험 세대", "실손 세대 확인", "4세대 실손", "실손 전환"],
    sources: [SRC.TERMS, SRC.INS_INTRO],
  },
  {
    key: "three-major-coverage",
    title: "3대 질병 보장(암·뇌·심장) 제대로 이해하기",
    category: "실손·보장성 가이드",
    intent: "유입",
    keywords: ["3대 질병 보험", "암 진단비", "뇌혈관질환 보장", "허혈성 심장질환"],
    sources: [SRC.TERMS, SRC.KKULTIP],
  },
  {
    key: "child-insurance-guide",
    title: "자녀보험 가입 전 반드시 확인할 것들",
    category: "실손·보장성 가이드",
    intent: "유입",
    keywords: ["자녀보험", "어린이보험", "태아보험", "자녀보험 가입 시기"],
    sources: [SRC.KKULTIP, SRC.TALKTALK],
  },
  {
    key: "care-dementia-insurance",
    title: "간병·치매 보험, 무엇을 보고 골라야 하나",
    category: "실손·보장성 가이드",
    intent: "유입",
    keywords: ["간병보험", "치매보험", "장기요양", "간병비"],
    sources: [SRC.TERMS, SRC.TALKTALK],
  },

  // ── 유입: 연금·노후·세테크 ─────────────────────────────────────────
  {
    key: "pension-irp-isa",
    title: "연금저축 vs IRP vs ISA — 무엇부터 채워야 하나",
    category: "연금·노후·세테크",
    intent: "유입",
    keywords: ["연금저축", "IRP", "ISA", "노후 준비 순서"],
    sources: [SRC.LIFEPLAN, SRC.KKULTIP],
  },
  {
    key: "pension-tax-credit",
    title: "연금 세액공제 한도와 활용 전략",
    category: "연금·노후·세테크",
    intent: "유입",
    keywords: ["연금 세액공제", "연금저축 세액공제", "IRP 세액공제 한도"],
    sources: [SRC.LIFEPLAN, SRC.KKULTIP],
  },
  {
    key: "retirement-cost-planning",
    title: "노후 생활비, 얼마나 어떻게 준비해야 하나",
    category: "연금·노후·세테크",
    intent: "유입",
    keywords: ["노후 생활비", "노후 자금 계산", "연금 수령"],
    sources: [SRC.LIFEPLAN, SRC.TALKTALK],
  },

  // ── 전환: 보험 리모델링 ────────────────────────────────────────────
  {
    key: "remodeling-checklist-7",
    title: "보험 리모델링 체크리스트 7 — 스스로 점검하는 법",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["보험 점검", "보험 리모델링 체크리스트", "보험 진단", "보장 분석"],
    sources: [SRC.MY_INSURANCE, SRC.KKULTIP, SRC.MINWON],
  },
  {
    key: "renewal-vs-level",
    title: "갱신형 vs 비갱신형 — 내 보험은 어느 쪽이 맞나",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["갱신형 비갱신형", "갱신 보험료 인상", "갱신형 전환"],
    sources: [SRC.TERMS, SRC.KKULTIP],
  },
  {
    key: "leaky-insurance-patterns",
    title: "새는 보험의 3대 패턴 — 중복 가입·과한 설계·부족한 보장",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["중복 가입", "과잉 설계", "보장 공백", "새는 보험"],
    sources: [SRC.MY_INSURANCE, SRC.MINWON],
  },
  {
    key: "before-switching-4",
    title: "보험 갈아타기 전 반드시 확인할 4가지",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["승환계약", "보험 갈아타기", "면책기간", "건강고지"],
    sources: [SRC.ALERT, SRC.MINWON],
  },
  {
    key: "family-insurance-audit",
    title: "가족 보험 한 번에 점검하는 법",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["가족 보험 점검", "보험 정리", "보험 통합 관리"],
    sources: [SRC.MY_INSURANCE, SRC.KKULTIP],
  },
];
