/**
 * 브랜드 싱글 소스 — 모든 페이지/컴포넌트/JSON-LD가 여기서 가져다 쓴다.
 * 경력 표기는 하드코딩하지 않고 입사일 기준 자동 계산 (매년 갱신 불필요).
 */

export const BRAND = {
  siteName: "신순주의 선한 금융",
  siteNameEn: "SHIN SOON JOO GOOD FINANCE",
  personName: "신순주",
  title: "지사장",
  company: "프라임에셋 140본부 천안3지점",
  region: "천안 · 충남 · 전남",
  careerStart: new Date("2003-07-01T00:00:00+09:00"),
  credentials: [
    "2025 우수인증설계사 (2018년부터 8년 연속)",
    "GA명장 (보험신보 언론보도)",
    "2007 동부생명 연도대상",
  ],
  pressUrl: "https://www.insweek.co.kr/news/articleView.html?idxno=68744",
  verse: {
    text: "하나님이 생명을 구원하시려고 나를 당신들보다 먼저 보내셨나이다",
    ref: "창세기 45:5",
    tagline: "당신의 위기보다 항상 한 발 앞서, 가장 선한 금융의 통로가 되겠습니다.",
  },
  siteUrl: "https://soonjoo.vercel.app",
} as const;

/** 입사일 기준 경력 계산: { years: 23, days: 8395 } */
export function getCareer(now: Date = new Date()) {
  const ms = now.getTime() - BRAND.careerStart.getTime();
  const days = Math.floor(ms / 86_400_000);
  const years = Math.floor(days / 365.25);
  return { years, days };
}

/** "23년 (8,395일)" 형태 표기 */
export function careerLabel(now?: Date) {
  const { years, days } = getCareer(now);
  return `${years}년 (${days.toLocaleString("ko-KR")}일)`;
}
