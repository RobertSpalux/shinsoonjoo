import { BRAND, getCareer } from "./brand";
import type { Article } from "./articles";

/**
 * JSON-LD 구조화 데이터 빌더.
 * 보험은 구글 YMYL 카테고리 — 실명 저자(Person) + 전국 조직(Organization)
 * 스키마가 E-E-A-T 신호의 핵심이므로 모든 글에 저자 스키마를 동적 주입한다.
 * (전국구 방침에 따라 지역 고정 LocalBusiness 스키마는 사용하지 않는다.)
 */

export function personSchema() {
  const { years } = getCareer();
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: BRAND.personName,
    jobTitle: `보험 전문가 · ${BRAND.title}`,
    worksFor: {
      "@type": "Organization",
      name: BRAND.company,
    },
    description: `${years}년 경력 보험 전문가. 2018년부터 8년 연속 우수인증설계사, 보험GA협회 GA명장.`,
    knowsAbout: [
      "보험",
      "종신보험",
      "보험금 청구",
      "보험 분쟁조정",
      "은퇴설계",
      "상속·증여 설계",
      "법인 CEO플랜",
    ],
    award: [...BRAND.credentials],
    url: BRAND.siteUrl,
    sameAs: [BRAND.pressUrl],
  };
}

/**
 * 전국구 방침: 지역 고정 스키마(LocalBusiness/InsuranceAgency + areaServed)는 쓰지 않는다.
 * 전국 서비스 조직으로서 Organization 스키마만 주입한다 (CLAUDE.md 2·7절).
 */
export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND.siteName,
    alternateName: BRAND.siteNameEn,
    url: BRAND.siteUrl,
    founder: { "@type": "Person", name: BRAND.personName },
    parentOrganization: { "@type": "Organization", name: "프라임에셋" },
    sameAs: [BRAND.social.instagram, BRAND.pressUrl],
    areaServed: { "@type": "Country", name: "대한민국" },
  };
}

export function articleSchema(article: Article) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.summary ?? undefined,
    datePublished: article.published_at ?? article.created_at,
    dateModified: article.published_at ?? article.created_at,
    author: {
      "@type": "Person",
      name: BRAND.personName,
      url: BRAND.siteUrl,
    },
    publisher: {
      "@type": "Organization",
      name: BRAND.siteName,
      url: BRAND.siteUrl,
    },
    mainEntityOfPage: `${BRAND.siteUrl}/news/${article.slug}`,
    image: article.og_image_path ?? undefined,
    articleSection: article.category,
    keywords: article.tags?.join(", ") || undefined,
  };
}

export function faqSchema(faqs: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

/** <script type="application/ld+json"> 렌더용 직렬화 */
export function jsonLdString(schema: object) {
  return JSON.stringify(schema).replace(/</g, "\\u003c");
}
