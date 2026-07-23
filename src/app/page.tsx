import Link from "next/link";
import HeroSection from "@/components/HeroSection";
import StatsBand from "@/components/StatsBand";
import TrustSection from "@/components/TrustSection";
import Timeline from "@/components/Timeline";
import ClientStories from "@/components/ClientStories";
import JourneyMap from "@/components/JourneyMap";
import ConsultationForm from "@/components/ConsultationForm";
import ArticleCard from "@/components/news/ArticleCard";
import { getPublishedArticles } from "@/lib/articles";
import { personSchema, organizationSchema, jsonLdString } from "@/lib/jsonld";

export const revalidate = 300;

export default async function Home() {
  const latest = await getPublishedArticles(undefined, 3);

  return (
    <main>
      {/* E-E-A-T: 홈에 Person + Organization 스키마 상시 주입 (전국구 — 지역 스키마 미사용) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(personSchema()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(organizationSchema()) }}
      />

      <HeroSection />
      <StatsBand />
      <TrustSection />
      <Timeline />

      {/* 최신 금융소식 */}
      {latest.length > 0 && (
        <section className="w-full bg-[var(--color-ink)] py-24 md:py-32">
          <div className="mx-auto max-w-7xl px-6 md:px-12">
            <div className="mb-12 flex items-end justify-between">
              <div>
                <p className="mb-4 text-xs font-semibold tracking-[0.08em] uppercase text-[var(--color-text-muted)]">
                  Daily Insight
                </p>
                <h2
                  className="text-3xl font-semibold tracking-[-0.01em] text-[var(--color-forest)] md:text-4xl"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  오늘의 금융소식
                </h2>
              </div>
              <Link
                href="/news"
                className="hidden text-sm font-medium text-[var(--color-text-body)] transition-colors hover:text-[var(--color-text-strong)] md:block"
              >
                전체 보기 →
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {latest.map((a, i) => (
                <ArticleCard
                  key={a.id}
                  slug={a.slug}
                  title={a.title}
                  category={a.category}
                  summary={a.summary}
                  publishedAt={a.published_at}
                  viewCount={a.view_count}
                  index={i}
                />
              ))}
            </div>
            <Link
              href="/news"
              className="mt-8 block text-center text-sm font-medium text-[var(--color-text-body)] md:hidden"
            >
              전체 보기 →
            </Link>
          </div>
        </section>
      )}

      <ClientStories />
      <JourneyMap />
      <ConsultationForm />
    </main>
  );
}
