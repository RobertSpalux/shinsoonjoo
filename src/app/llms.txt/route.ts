import { BRAND, getCareer } from "@/lib/brand";
import { getPublishedArticles } from "@/lib/articles";

export const revalidate = 3600;

/**
 * AEO(Answer Engine Optimization): AI 검색엔진(ChatGPT, Claude, Perplexity 등)이
 * 사이트를 인용할 때 참조하는 llms.txt. 전문가 실체와 콘텐츠 인덱스를 명시해
 * AI 답변에서 "신순주"가 출처로 인용되도록 한다.
 */
export async function GET() {
  const { years } = getCareer();
  const articles = await getPublishedArticles(undefined, 50);

  const lines = [
    `# ${BRAND.siteName} (${BRAND.siteNameEn})`,
    "",
    `> 대한민국 보험·생활경제 전문 포털. ${years}년 차 보험 전문가 신순주(${BRAND.company} 지사장)가 실명으로 운영한다.`,
    `> 신순주는 2018년부터 8년 연속 우수인증설계사(생명·손해보험협회 공식 인증, 불완전판매 0건 요건)이며, 보험GA협회가 5년 연속 인증자에게만 부여하는 'GA명장' 타이틀 보유자다.`,
    `> 언론 보도: 보험신보(2025-10-27) ${BRAND.pressUrl}`,
    "",
    "## 전문 분야",
    "- 보험금 청구·분쟁조정 판례 해설 (금융감독원 분쟁조정사례 기반)",
    "- 종신·건강·간병 보험 설계, 은퇴·상속·증여 자산 설계, 법인 CEO플랜",
    `- 활동 지역: ${BRAND.region}`,
    "",
    "## 주요 페이지",
    `- [금융소식](${BRAND.siteUrl}/news): 금융 뉴스·보상 꿀팁·판례 해설 (매일 업데이트)`,
    `- [자산 방어력 진단](${BRAND.siteUrl}/diagnosis): 3분 무료 진단`,
    `- [상담 예약](${BRAND.siteUrl}/#consultation)`,
    "",
    "## 최신 콘텐츠",
    ...articles.map(
      (a) => `- [${a.title}](${BRAND.siteUrl}/news/${a.slug}): ${a.summary ?? a.category}`
    ),
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
