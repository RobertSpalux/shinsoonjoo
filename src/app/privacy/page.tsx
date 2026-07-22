import type { Metadata } from "next";
import {
  PRIVACY_INTRO,
  PRIVACY_SECTIONS,
  PRIVACY_EFFECTIVE_DATE,
} from "@/lib/privacy-policy";

export const metadata: Metadata = {
  title: "개인정보 처리방침 | 신순주의 선한 금융",
  description:
    "신순주의 선한 금융 개인정보 처리방침 — 처리 목적, 항목, 보유기간, 제3자 제공, 파기, 정보주체 권리, 보호책임자 안내.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[var(--color-ink)] pt-16">
      <article className="mx-auto max-w-3xl px-5 py-16 md:px-8 md:py-24">
        <header className="mb-10 border-b border-[var(--color-line)] pb-8">
          <p className="mb-3 text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)]">
            PRIVACY POLICY
          </p>
          <h1
            className="text-3xl font-semibold leading-[1.25] tracking-[-0.015em] text-[var(--color-text-strong)] md:text-4xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            개인정보 처리방침
          </h1>
          <p className="mt-4 text-[13px] text-[var(--color-text-muted)]">
            시행일 :{" "}
            {PRIVACY_EFFECTIVE_DATE ? PRIVACY_EFFECTIVE_DATE : "시행일 별도 고지"}
          </p>
        </header>

        {/* 도입 문단 */}
        <div className="space-y-4">
          {PRIVACY_INTRO.map((para, i) => (
            <p
              key={i}
              className="text-[15px] leading-relaxed text-[var(--color-text-body)]"
            >
              {para}
            </p>
          ))}
        </div>

        {/* 제1~11조 */}
        <div className="mt-12 space-y-10">
          {PRIVACY_SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2
                className="mb-3 text-xl font-semibold tracking-[-0.01em] text-[var(--color-text-strong)] md:text-2xl"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {section.heading}
              </h2>
              <p className="whitespace-pre-line text-[14px] leading-relaxed text-[var(--color-text-body)]">
                {section.body}
              </p>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
