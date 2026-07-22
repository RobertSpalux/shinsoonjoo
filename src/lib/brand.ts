/**
 * 브랜드 싱글 소스 — 모든 페이지/컴포넌트/JSON-LD가 여기서 가져다 쓴다.
 * 경력 표기는 하드코딩하지 않고 입사일 기준 자동 계산 (매년 갱신 불필요).
 */

/**
 * ⚠️ 필수안내사항 표시 기준 (손보규정 §26 ①, 협회 가이드북 Part II)
 * renderMandatoryNotice() 출력물을 화면에 실제로 렌더할 때 반드시 지킬 것.
 * - 바탕색과 구별되는 색상으로 표시한다.
 * - 경고문구(유의사항)는 다른 안내사항과 시각적으로 차별화한다.
 * - A4 고딕체 기준 8pt 이상.
 * - 본문이 12pt 이상이면 심의필 표기는 10pt 이상.
 */

export const BRAND = {
  siteName: "신순주의 선한 금융",
  siteNameEn: "SHIN SOON JOO GOOD FINANCE",
  personName: "신순주",
  title: "지사장",
  company: "프라임에셋", // 사실값 — 푸터/프로필 하단에만 노출. 본부·지사(140본부/RUTC지사/천안3)는 협회 필수안내사항 형식에 들어가지 않으므로 표기하지 않는다. 지역 표현이 필요하면 "천안"만.
  region: "전국 (비대면 상담 · 대면 상담 가능)", // 전국구 — 지역명은 헤드라인·SEO·스키마에 넣지 않음
  phone: "041-572-0372",
  address: "충남 천안시 서북구 월봉7길 18 202호 프라임에셋",
  social: {
    instagram: "https://www.instagram.com/goodfinance_sj/",
    kakao: "http://pf.kakao.com/_xoxdBwX",
  },
  careerStart: new Date("2003-07-01T00:00:00+09:00"),
  credentials: [
    "2025 우수인증설계사 (2018년부터 8년 연속)",
    "GA명장 (보험신보 언론보도)",
    "2007 동부생명 연도대상",
  ],
  pressUrl: "https://www.insweek.co.kr/news/articleView.html?idxno=68744",
  /** 히어로 등 한 줄 표기용 짧은 마크 (credentials의 축약형) */
  pressMarks: ["보험신보 보도", "우수인증설계사 8년 연속", "GA명장"],
  verse: {
    text: "하나님이 생명을 구원하시려고 나를 당신들보다 먼저 보내셨나이다",
    ref: "창세기 45:5",
    tagline: "당신의 위기보다 항상 한 발 앞서, 가장 선한 금융의 통로가 되겠습니다.",
  },
  // fallback = 실운영 도메인 — env 누락 시에도 유령 도메인이 새지 않게 한다
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://goodfinance.kr",
} as const;

/** 입사일 기준 경력 계산 → { years, days } (하드코딩 금지, 항상 이 함수로 파생) */
export function getCareer(now: Date = new Date()) {
  const ms = now.getTime() - BRAND.careerStart.getTime();
  const days = Math.floor(ms / 86_400_000);
  const years = Math.floor(days / 365.25);
  return { years, days };
}

/** "N년 (N,NNN일)" 형태 표기 */
export function careerLabel(now?: Date) {
  const { years, days } = getCareer(now);
  return `${years}년 (${days.toLocaleString("ko-KR")}일)`;
}

/* ────────────────────────────────────────────────────────────────────────
 * 금소법 광고 컴플라이언스 (CLAUDE.md §6)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * 광고심의 고정 식별정보(회사·설계사 공통).
 * ⚠️ 심의필 번호·유효기간은 여기 없다 — 광고물(글)×채널 단위로 발급되므로 상수로 둘 수 없다.
 *    정본은 `ad_reviews` 테이블이며, renderMandatoryNotice(review)에 건별로 주입한다.
 */
export const COMPLIANCE = {
  agencyName: "프라임에셋(주) 보험대리점",
  agencyRegNo: "2009058101",
  plannerName: "신순주",
  plannerRegNo: "20030976050033", // 생명·손해보험협회 공통
} as const;

/** 광고물(글)×채널 단위 승인 심의필 — ad_reviews의 해당 행에서 온다. */
export type ReviewInfo = {
  authority: string;
  no: string;
  from: string; // 'YYYY.MM.DD'
  to: string; // 'YYYY.MM.DD'
};

/**
 * 광고 필수안내사항 전문(全文) 렌더러.
 *
 * 자가점검표 1-1 ~ 1-8 전 항목을 충족하는 완성형이다. 하나라도 빠지면 반려된다.
 * (협회 가이드북 Part II · 프라임에셋 참고자료 26.05.21 기준)
 *
 * 두 모드의 유일한 차이는 **심의필 줄 한 줄**뿐이다 — 본문 나머지는 제출본=게시본으로
 * 완전히 동일해야 한다. (제출 후 본문이 달라지면 심의에서 '원안 수정'으로 걸린다.)
 * - mode='submission': review와 무관하게 항상 전문을 반환하고, 심의필 줄만 공란으로 고정한다.
 *   심의는 '실제 게시될 화면 전체'를 보고 판정하므로, 필수안내사항이 빠진 화면을 제출하면
 *   누락으로 반려된다. ⚠️ 공란은 임의번호·예시번호(00000 포함) 절대 금지 — 밑줄만 쓴다
 *   (프라임에셋 참고자료: "심의필 예시는 공란으로 표기, 임의번호 불가").
 * - mode='publish'(기본): review가 없거나 no가 비면 **null**을 반환한다(블록 생략). §6.3
 *   게시용에 공란 심의필을 넣으면 허위 심의필 표기가 되므로 절대 출력하지 않는다.
 * ⚠️ 출력 문구를 임의로 축약·변형하지 말 것 — 축약은 반송 사유다.
 * ⚠️ 승환계약 유의문구는 2022.11.07 회사 공지로 GA 전 광고물 필수 → 상시 포함.
 * ⚠️ 실제 화면 렌더 시 파일 상단의 표시 기준(색상·차별화·글꼴 크기)을 지킬 것.
 */
export function renderMandatoryNotice(
  review?: ReviewInfo | null,
  mode: "submission" | "publish" = "publish"
): string | null {
  // ⬇️ 심의필 줄만 모드에 따라 달라진다. 아래 본문 전체는 두 모드 공통(한 글자도 다르면 안 됨).
  let reviewLine: string;
  if (mode === "submission") {
    // 제출용: 심의필 줄은 공란(밑줄)으로 고정. 임의번호·예시번호 금지.
    reviewLine = "프라임에셋 심의필 제_____호 (____.__.__ ~ ____.__.__)";
  } else {
    // 게시용: 유효 심의필이 없으면 필수안내사항을 만들지 않는다(허위 표기 방지).
    if (!review || !review.no) return null;
    reviewLine = `${review.authority} 심의필 제${review.no}호 (${review.from}~${review.to})`;
  }

  const { plannerName, plannerRegNo, agencyName, agencyRegNo } = COMPLIANCE;

  return `[필수안내사항]

계약체결 전 상품설명서 및 약관을 자세히 읽어보시기 바랍니다.

보험설계사 ${plannerName} (생명·손해보험협회 등록번호 : ${plannerRegNo})
${agencyName} (등록번호 : 제${agencyRegNo}호)

${plannerName} 보험설계사는 해당 상품에 대해 충분히 설명할 의무가 있으며,
가입자는 가입에 앞서 이에 대한 충분한 설명을 받으시기 바랍니다.

${plannerName} 보험설계사는 다수의 보험회사와 계약 체결 및 대리·중개하는 보험설계사입니다.

${plannerName} 보험설계사는 보험회사로부터 보험계약체결권을 부여받지 아니한
금융상품판매 대리·중개업자입니다.

본 광고는 광고심의기준을 준수하였으며, 유효기간은 심의일로부터 1년입니다.
${reviewLine}

[유의사항]

보험계약자가 기존 보험계약을 해지하고 새로운 보험계약을 체결하는 과정에서
① 질병이력, 연령증가 등으로 가입이 거절되거나 보험료가 인상될 수 있습니다.
② 가입 상품에 따라 새로운 면책기간 적용 및 보장 제한 등 기타 불이익이 발생할 수 있습니다.`;
}

/**
 * 사이트 골격 심의필 — 사이트당 1개 고정값(§6.11-8).
 * `ad_reviews`는 article_id FK가 필수라 사이트 단위 값을 담을 수 없어 상수로 둔다.
 *
 * ⚠️ 미승인 상태 = null. 승인·심의필 수령 후 **이 상수 한 곳만** 채우면 푸터(전 페이지)에 자동 반영된다.
 *    (예: `{ authority: "프라임에셋", no: "2026-07-XXXX", from: "2026.07.__", to: "2027.07.__" }`)
 * - null인 동안 푸터는 `renderMandatoryNotice(null, "submission")`로 **제출용 공란 플레이스홀더
 *   (제_____호)** 를 렌더한다 — 심의 제출 캡처 화면에 필수안내사항이 포함되도록(누락 시 반려).
 * - ⚠️ §6.3·§6.11-8은 **라이브(게시) 화면에서는 '비표시'**를 규정한다. 사이트가 일반 공개 상태로
 *   전환된 뒤에도 미승인이라면, 푸터 렌더를 publish 모드(null→비표시)로 바꿔 허위 심의필 표기
 *   (집중 모니터링 ①)를 피할 것.
 */
export const SITE_REVIEW: ReviewInfo | null = null;

/**
 * 소재별 조건부 유의문구. 해당 소재를 다룰 때 본문에 삽입한다.
 * ⚠️ 축약 불가 — 문구를 그대로 사용한다.
 */
export const CONDITIONAL_NOTICES = {
  /**
   * 게시글 필수 유의문구 #1 — 개인 의견 귀속 (준법팀 회신 2026-07-21 지정 자구).
   * 푸터·게시글 본문·외부 채널(osmu) 세 경로가 모두 이 상수를 참조한다(자구 단일화, REQUIRED_NOTICES).
   * ⚠️ 바이럴(블로그 등)은 본문에 1회 이상 노출. 심의필 유무와 무관하게 상시 노출.
   */
  personalOpinion:
    "상기 내용은 보험설계사의 의견이며, 계약체결에 따른 이익 또는 손실은 보험계약자 등에게 귀속됩니다.",

  /** 게시글 필수 유의문구 #2 — 상품·보험사별 상이 → 약관 참조 (회신 지정 자구). */
  policyReference:
    "보험사 및 상품별로 상이할 수 있으므로, 관련한 세부사항은 반드시 해당 약관을 참조하시기 바랍니다.",

  /** 담보·가입금액·보험료 변동 안내 */
  premiumVariation:
    "보험회사 상품별, 성별, 연령, 직업 등에 따라 가입가능한 담보와 가입금액, 보험료 등은 달라질 수 있습니다.",

  /** 실비보험 자기부담금 */
  actualLoss: "실비보험은 자기부담금을 제외한 금액을 보장하는 보험입니다.",

  /** 실손 세대를 특정하지 않고 보장내용을 안내할 때 추가 */
  actualLossGeneration:
    "실손의료비보험은 가입시기별로 보상한도/보장범위/면책사항 등이 다를 수 있습니다.",

  /** 유병자(간편) 보험 */
  simplifiedIssue: "유병자(간편) 보험은 인수기준에 따라 가입이 거절될 수 있습니다.",

  /** 운전자보험 */
  driver: "12대 중과실 중 무면허, 음주운전 및 뺑소니 사고는 보장에서 제외됩니다.",

  /** 태아보험 */
  fetal: "태아보험은 태아 시기에 가입하는 어린이 보험이며, 출생 이후부터 보장됩니다.",

  /** 중도해지 환급 */
  noRefund: "중도해지 시 납입한 보험료보다 환급금이 적거나 없을 수 있습니다.",
} as const;

/**
 * 게시글마다 본문에 상시 노출하는 필수 유의문구 2종 (준법팀 회신 2026-07-21).
 * ⚠️ 담당자 회신: 사이트 심의 1건과 게시글 심의는 별건이며, 이 2종은 게시글 본문에 노출한다
 *    (심의필 유무와 무관하게 상시 — renderMandatoryNotice와 별개 블록).
 * 단일 소스 = CONDITIONAL_NOTICES → 푸터·게시글 본문·osmu가 같은 자구를 참조한다(자구 갈림 방지).
 * 푸터에도 유지(사이트 골격 심의용). 게시글에서 본문+푸터 이중 노출은 허용(유의문구 과다 반려 없음).
 */
export const REQUIRED_NOTICES = [
  CONDITIONAL_NOTICES.personalOpinion,
  CONDITIONAL_NOTICES.policyReference,
] as const;
