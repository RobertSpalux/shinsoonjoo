/**
 * 상록수(evergreen) 시드뱅크 — 커밋 M3.
 * 키워드 소유용 기획 콘텐츠의 기획서. 한 시드 = 한 편 (DB seed_key unique로 이중 생성 방지).
 *
 * ⚠️ sources는 CONTENT-STRATEGY §9-2 표의 공공 1차 소스 URL만 (민간 매체 재가공 금지 — §9-1).
 * category는 팩토리 스키마의 6-카테고리 enum 문자열과 정확히 일치해야 한다.
 * 배열 순서 = 발행 우선순위 (선정: 미생성 중 intent 일치 첫 번째, isHub는 intent 무관 최우선).
 * searchTerms(M3-1): 게시판 검색용 단일 토큰 — 시드가 직접 지정한다(키워드 자동 유추 금지).
 *   검색·스코어링 통과 게시글이 없으면 그 소스는 실패 처리(최신글 폴백 없음 — 오염 차단).
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
    // 점검 앵글 검색어를 앞에 — 그라운딩이 승환 경보 일변도가 되지 않게 근거 다변화 (M3-2)
    searchTerms: ["리모델링", "중복가입", "비례보상", "보장분석", "승환", "고지의무"],
    description:
      "리모델링 = 전 계약을 담보 단위로 펼쳐 중복·과설계·보장 공백을 찾는 '점검'. 승환 경고문이 아니라 점검 가이드를 쓴다. 결론의 대부분은 '유지'다.",
    sources: [SRC.MY_INSURANCE, SRC.ALERT, SRC.KKULTIP],
  },

  // ── 유입: 보험료 절약·꿀팁 (CONTENT-STRATEGY §3 — 절약·청구 먼저) ──────
  {
    key: "car-insurance-savings",
    title: "자동차보험료 아끼는 법 — 할인특약부터 마일리지까지",
    category: "보험료 절약·꿀팁",
    intent: "유입",
    keywords: ["자동차보험료 할인", "자동차보험 특약", "마일리지 특약", "자동차보험료 아끼기"],
    searchTerms: ["자동차보험", "마일리지", "운전자"],
    sources: [SRC.KKULTIP, SRC.TALKTALK],
  },
  {
    key: "insurance-discounts-total",
    title: "몰라서 못 받는 보험료 할인 총정리",
    category: "보험료 절약·꿀팁",
    intent: "유입",
    keywords: ["보험료 할인", "보험료 절약", "할인 특약", "건강체 할인"],
    searchTerms: ["할인", "보험료", "절약"],
    sources: [SRC.KKULTIP, SRC.TALKTALK],
  },
  {
    key: "premium-waiver-guide",
    title: "보험료 납입면제, 제대로 알고 활용하는 법",
    category: "보험료 절약·꿀팁",
    intent: "유입",
    keywords: ["납입면제", "납입면제 조건", "보험료 면제", "납입면제 특약"],
    searchTerms: ["납입면제", "납입", "면제"],
    sources: [SRC.KKULTIP, SRC.INS_INTRO, SRC.TERMS],
  },
  {
    key: "hospital-cost-support",
    title: "병원비 아끼는 국가 지원제도 총정리",
    category: "보험료 절약·꿀팁",
    intent: "유입",
    keywords: ["병원비 지원", "본인부담상한제", "재난적 의료비", "의료비 지원제도"],
    searchTerms: ["병원비", "의료비", "본인부담"],
    sources: [SRC.TALKTALK, SRC.KKULTIP],
  },

  // ── 유입: 보험금 청구·보상 ──────────────────────────────────────────
  {
    key: "silson-claim-guide",
    title: "실손보험 청구 완벽 가이드 — 서류부터 실손24까지",
    category: "보험금 청구·보상",
    intent: "유입",
    keywords: ["실손보험 청구", "실손 청구 서류", "실손24", "보험금 청구 방법"],
    searchTerms: ["실손", "청구", "실손24"],
    sources: [SRC.KKULTIP, SRC.MINWON],
  },
  {
    key: "claim-docs-by-amount",
    title: "보험금 청구 금액별 필요서류 한눈에 정리",
    category: "보험금 청구·보상",
    intent: "유입",
    keywords: ["보험금 청구 서류", "진단서", "진료비 세부내역서", "소액 청구"],
    searchTerms: ["청구", "진단서", "보험금"],
    sources: [SRC.KKULTIP, SRC.TERMS],
  },
  {
    key: "hidden-insurance-money",
    title: "숨은 보험금 찾기 — 내보험찾아줌 사용법",
    category: "보험금 청구·보상",
    intent: "유입",
    keywords: ["숨은 보험금", "내보험찾아줌", "휴면보험금", "미청구 보험금"],
    searchTerms: ["숨은", "내보험찾아줌", "휴면"],
    sources: [SRC.MY_INSURANCE, SRC.KKULTIP],
  },
  {
    key: "parents-claim-proxy",
    title: "부모님 실비 대리청구, 이렇게 하세요",
    category: "보험금 청구·보상",
    intent: "유입",
    keywords: ["실손 대리청구", "부모님 보험금 청구", "지정대리청구인"],
    searchTerms: ["대리청구", "지정대리", "청구"],
    sources: [SRC.KKULTIP, SRC.MINWON],
  },
  {
    key: "claim-denial-top5",
    title: "보험금 부지급 대표 사유 5가지와 대응법",
    category: "보험금 청구·보상",
    intent: "유입",
    keywords: ["보험금 부지급", "보험금 거절", "고지의무 위반", "부지급 사유"],
    searchTerms: ["부지급", "고지의무", "보험금"],
    sources: [SRC.MINWON, SRC.ALERT],
  },

  // ── 유입: 실손·보장성 가이드 ────────────────────────────────────────
  {
    key: "silson-generations",
    title: "실손보험 1~5세대 차이 총정리 — 내 실손은 몇 세대인가",
    category: "실손·보장성 가이드",
    intent: "유입",
    keywords: ["실손보험 세대", "실손 세대 확인", "4세대 실손", "실손 전환"],
    searchTerms: ["실손", "실손의료보험"],
    sources: [SRC.TERMS, SRC.INS_INTRO],
  },
  {
    key: "three-major-coverage",
    title: "3대 질병 보장(암·뇌·심장) 제대로 이해하기",
    category: "실손·보장성 가이드",
    intent: "유입",
    keywords: ["3대 질병 보험", "암 진단비", "뇌혈관질환 보장", "허혈성 심장질환"],
    searchTerms: ["진단비", "암보험", "질병"],
    sources: [SRC.TERMS, SRC.KKULTIP],
  },
  {
    key: "child-insurance-guide",
    title: "자녀보험 가입 전 반드시 확인할 것들",
    category: "실손·보장성 가이드",
    intent: "유입",
    keywords: ["자녀보험", "어린이보험", "태아보험", "자녀보험 가입 시기"],
    searchTerms: ["어린이", "자녀", "태아"],
    sources: [SRC.KKULTIP, SRC.TALKTALK],
  },
  {
    key: "care-dementia-insurance",
    title: "간병·치매 보험, 무엇을 보고 골라야 하나",
    category: "실손·보장성 가이드",
    intent: "유입",
    keywords: ["간병보험", "치매보험", "장기요양", "간병비"],
    searchTerms: ["치매", "간병", "장기요양"],
    sources: [SRC.TERMS, SRC.TALKTALK],
  },

  // ── 유입: 연금·노후·세테크 ─────────────────────────────────────────
  {
    key: "pension-irp-isa",
    title: "연금저축 vs IRP vs ISA — 무엇부터 채워야 하나",
    category: "연금·노후·세테크",
    intent: "유입",
    keywords: ["연금저축", "IRP", "ISA", "노후 준비 순서"],
    searchTerms: ["연금저축", "IRP", "ISA"],
    sources: [SRC.LIFEPLAN, SRC.KKULTIP],
  },
  {
    key: "pension-tax-credit",
    title: "연금 세액공제 한도와 활용 전략",
    category: "연금·노후·세테크",
    intent: "유입",
    keywords: ["연금 세액공제", "연금저축 세액공제", "IRP 세액공제 한도"],
    searchTerms: ["세액공제", "연금저축", "절세"],
    sources: [SRC.LIFEPLAN, SRC.KKULTIP],
  },
  {
    key: "retirement-cost-planning",
    title: "노후 생활비, 얼마나 어떻게 준비해야 하나",
    category: "연금·노후·세테크",
    intent: "유입",
    keywords: ["노후 생활비", "노후 자금 계산", "연금 수령"],
    searchTerms: ["노후", "은퇴", "연금"],
    sources: [SRC.LIFEPLAN, SRC.TALKTALK],
  },

  // ── 전환: 보험 리모델링 ────────────────────────────────────────────
  {
    key: "remodeling-checklist-7",
    title: "보험 리모델링 체크리스트 7 — 스스로 점검하는 법",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["보험 점검", "보험 리모델링 체크리스트", "보험 진단", "보장 분석"],
    searchTerms: ["리모델링", "중복가입", "갱신", "해지환급"],
    sources: [SRC.MY_INSURANCE, SRC.KKULTIP, SRC.MINWON],
  },
  {
    key: "renewal-vs-level",
    title: "갱신형 vs 비갱신형 — 내 보험은 어느 쪽이 맞나",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["갱신형 비갱신형", "갱신 보험료 인상", "갱신형 전환"],
    searchTerms: ["갱신", "갱신형", "비갱신"],
    sources: [SRC.TERMS, SRC.KKULTIP],
  },
  {
    key: "leaky-insurance-patterns",
    title: "새는 보험의 3대 패턴 — 중복 가입·과한 설계·부족한 보장",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["중복 가입", "과잉 설계", "보장 공백", "새는 보험"],
    searchTerms: ["중복", "비례보상", "실손"],
    sources: [SRC.MY_INSURANCE, SRC.MINWON],
  },
  {
    key: "before-switching-4",
    title: "보험 갈아타기 전 반드시 확인할 4가지",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["승환계약", "보험 갈아타기", "면책기간", "건강고지"],
    searchTerms: ["승환", "갈아타기", "리모델링", "고지의무"],
    sources: [SRC.ALERT, SRC.MINWON],
  },
  {
    key: "family-insurance-audit",
    title: "가족 보험 한 번에 점검하는 법",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["가족 보험 점검", "보험 정리", "보험 통합 관리"],
    searchTerms: ["내보험다보여", "숨은", "가족"],
    sources: [SRC.MY_INSURANCE, SRC.KKULTIP],
  },

  // ── 전환: 생애 이벤트 리모델링 (커밋 P1 — 벤치마킹 환원) ──────────────
  // 근거: "보험 리모델링" 검색 상위(시그널플래너·KB Think·언론)가 공통으로
  // 생애 이벤트(결혼·출산·퇴직) 프레임을 쓰지만, 담보 '합산 금액'은 어디도
  // 보여주지 못함 → 시드 본문 방향에 담보 합산 표(금액+합계)를 필수로 유지.
  {
    key: "newlywed-insurance-audit",
    title: "결혼하면 보험부터 합쳐라? — 신혼부부 보험 점검 순서",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["신혼부부 보험 점검", "결혼 보험 정리", "부부 보험 중복", "신혼 보험"],
    searchTerms: ["신혼", "부부", "결혼", "중복가입", "실손"],
    description:
      "각자 들고 온 계약을 부부 합산으로 펼치면 중복(실손 비례보상)과 공백이 처음 드러난다. '합쳐라'가 답이 아니라 '펼쳐서 합산해봐야 안다'가 답. 부부 담보 합산 표(금액+합계) 필수 — 가상 예시 명시.",
    sources: [SRC.KKULTIP, SRC.TALKTALK, SRC.MY_INSURANCE],
  },
  {
    key: "postpartum-insurance-audit",
    title: "출산 후 보험 점검 — 자녀보험 추가 전에 부모 보장부터",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["출산 후 보험", "자녀보험 가입 전", "부모 보장 점검", "태아보험 이후"],
    searchTerms: ["출산", "태아", "어린이", "자녀"],
    description:
      "출산 직후엔 자녀보험부터 알아보지만, 아이의 진짜 위험은 부모(가장)의 보장 공백이다. 부모 사망·진단 담보를 계약 가로질러 합산한 표(금액+합계) 필수 — 자녀보험 추가 판단은 그 다음이라는 순서를 세운다. 가상 예시 명시.",
    sources: [SRC.KKULTIP, SRC.TALKTALK],
  },
  {
    key: "pre-retirement-restructure",
    title: "퇴직 전 5년, 보험 구조를 바꿔야 하는 이유",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["퇴직 전 보험 점검", "은퇴 보험 정리", "갱신형 보험료 인상", "납입여력"],
    searchTerms: ["은퇴", "노후", "갱신", "갱신형", "연금"],
    description:
      "소득이 멈추는 시점 이후에도 납입과 갱신 인상은 계속된다 — 퇴직 후 납입여력·갱신형 보험료 인상이 겹치는 구조 문제를 다룬다. 담보·납입 구조를 계약 가로질러 합산한 표(금액+합계) 필수. 개인별 결론(해지·전환)은 단정하지 않는다. 가상 예시 명시.",
    sources: [SRC.KKULTIP, SRC.TERMS, SRC.TALKTALK],
  },
  {
    key: "income-change-premium-ratio",
    title: "이직·소득 변화 때 보험료 비율 다시 계산하는 법",
    category: "보험 리모델링",
    intent: "전환",
    keywords: ["소득 대비 보험료", "보험료 비율", "이직 보험 점검", "보험료 부담 줄이기"],
    searchTerms: ["보험료", "납입", "감액", "해지환급", "납입면제"],
    description:
      "소득이 바뀌면 보험료 총액의 비율부터 다시 계산해야 한다. 전 계약 보험료를 합산한 표(금액+합계) 필수 — 총액은 어느 증권에도 없다. 부담 조정 수단(감액·납입유예 등)은 제도 소개까지만, 개인별 처방은 단정하지 않는다. 가상 예시 명시.",
    sources: [SRC.KKULTIP, SRC.TALKTALK],
  },

  // ── 유입: 종목별 가이드 (커밋 P5 — 보험 포털 커버리지, 종목 축 빈 칸 채움) ──
  // 운전자·치아·종신·일상배상·단체. 전부 교육·점검 관점(비교·추천·순위 금지 준수).
  {
    key: "driver-insurance-checkup",
    title: "운전자보험, 자동차보험이랑 뭐가 다른가요 — 중복되기 쉬운 담보부터",
    category: "실손·보장성 가이드",
    intent: "유입",
    keywords: ["운전자보험 자동차보험 차이", "운전자보험 중복", "교통사고처리지원금", "운전자 특약"],
    searchTerms: ["운전자", "교통사고처리지원금", "변호사선임", "벌금", "자동차부상"],
    description:
      "자동차보험(의무)과 운전자보험(선택)의 역할 구분 교육 → 여러 계약에 운전자 특약이 흩어져 중복되는 패턴 → 담보 합산 표(금액+합계, 가상 예시 명시)로 확인해야 보이는 이유. 상품 비교·추천 금지, 점검 관점만.",
    sources: [SRC.KKULTIP, SRC.TALKTALK, SRC.TERMS],
  },
  {
    key: "dental-insurance-waiting",
    title: "치아보험 가입 전 반드시 확인할 것 — 면책기간과 감액기간",
    category: "실손·보장성 가이드",
    intent: "유입",
    keywords: ["치아보험 면책기간", "치아보험 감액", "치아보험 가입 전", "임플란트 보험"],
    searchTerms: ["치아", "임플란트", "크라운", "브릿지", "면책", "감액"],
    description:
      "가입 직후엔 보장되지 않는 구조(면책기간·50% 감액기간) 교육 → '지금 필요해서 드는 보험'의 함정 → 가입 시점 판단이 왜 중요한가. 담보 합산 표(금액+합계, 가상 예시 명시) 유지. 개인별 가입 여부 단정 금지.",
    sources: [SRC.TERMS, SRC.KKULTIP],
  },
  {
    key: "whole-life-vs-term",
    title: "종신보험과 정기보험 — 사망보장의 두 구조",
    category: "실손·보장성 가이드",
    intent: "유입",
    keywords: ["종신보험 정기보험 차이", "사망보장 구조", "종신보험 해지환급금", "정기보험"],
    searchTerms: ["종신", "정기", "사망보장", "해지환급금", "상속"],
    description:
      "두 구조의 차이 교육 — 우열을 단정하지 않는다(연령·목적·납입여력에 따라 답이 반대로 나옴을 명시). ⚠️ 종신→정기 갈아타기 권유 톤 금지(승환 리스크 — 면책기간 리셋·총 납입액·가입 나이를 짚는다). '저축 대용' 오해 바로잡기는 사실 서술로만. 사망 담보 합산 표(금액+합계, 가상 예시 명시).",
    sources: [SRC.TERMS, SRC.KKULTIP, SRC.TALKTALK],
  },
  {
    key: "daily-liability-coverage",
    title: "일상생활배상책임, 있는 줄도 모르고 중복 가입하는 대표 담보",
    category: "실손·보장성 가이드",
    intent: "유입",
    keywords: ["일상생활배상책임", "일상배상 중복", "배상책임 특약", "누수 보험"],
    searchTerms: ["일상생활배상", "배상책임", "누수", "자전거사고"],
    description:
      "가족 계약 여기저기에 특약으로 붙어 있는 대표 담보 → 비례보상이라 중복 가입해도 이중 수령 불가(사실 교육) → 전 계약을 펼쳐 합산해봐야 아는 이유. 담보 합산 표(금액+합계, 가상 예시 명시) 필수.",
    sources: [SRC.KKULTIP, SRC.MINWON],
  },
  {
    key: "group-vs-personal-insurance",
    title: "직장 단체보험 믿고 개인보험 줄여도 될까",
    category: "실손·보장성 가이드",
    intent: "유입",
    keywords: ["단체보험 개인보험", "단체실손 중복", "개인실손 중지제도", "퇴직 보험"],
    searchTerms: ["단체보험", "퇴직", "실손중지", "중복"],
    description:
      "단체보험의 한계(퇴직·이직 시 소멸) + 개인실손 중지제도(사실 교육) → 단체+개인 보장을 합산해봐야 공백/중복이 보인다. 담보 합산 표(금액+합계, 가상 예시 명시) 필수. '줄여도 된다/안 된다' 개인별 단정 금지 — 판단 변수만 드러낸다.",
    sources: [SRC.KKULTIP, SRC.TALKTALK],
  },
];
