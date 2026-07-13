/**
 * 브랜드 싱글 소스 — 모든 페이지/컴포넌트/JSON-LD가 여기서 가져다 쓴다.
 * 경력 표기는 하드코딩하지 않고 입사일 기준 자동 계산 (매년 갱신 불필요).
 */

export const BRAND = {
  siteName: "신순주의 선한 금융",
  siteNameEn: "SHIN SOON JOO GOOD FINANCE",
  personName: "신순주",
  title: "지사장",
  company: "프라임에셋 140본부 천안3지점", // 사실값 — 푸터/프로필 하단에만 노출
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
