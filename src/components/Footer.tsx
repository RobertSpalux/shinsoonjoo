import Link from "next/link";
import { Instagram } from "lucide-react";
import { BRAND, getCareer } from "@/lib/brand";

/** 카카오톡 채널 — 심플 말풍선 라인 마크 */
function KakaoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 4c-4.97 0-9 3.13-9 7 0 2.48 1.66 4.66 4.17 5.9L6.5 20.5l4.13-2.3c.45.05.9.08 1.37.08 4.97 0 9-3.13 9-7s-4.03-7-9-7z" />
    </svg>
  );
}

export default function Footer() {
  const { years } = getCareer();

  return (
    <footer className="border-t border-[var(--color-line)] bg-[var(--color-ink-soft)]">
      <div className="mx-auto max-w-7xl px-6 py-14 md:px-12">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div>
            <p className="text-lg font-bold text-[var(--color-text-strong)]">{BRAND.siteName}</p>
            <p className="mt-1 text-[10px] font-medium tracking-[0.08em] uppercase text-[var(--color-text-muted)]">
              {BRAND.siteNameEn}
            </p>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-[var(--color-text-body)]">
              {BRAND.verse.tagline}
            </p>
            <div className="mt-6 flex items-center gap-4">
              <a
                href={BRAND.social.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="인스타그램"
                className="text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-strong)]"
              >
                <Instagram className="h-4 w-4" strokeWidth={1.8} />
              </a>
              <a
                href={BRAND.social.kakao}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="카카오톡 채널"
                className="text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-strong)]"
              >
                <KakaoIcon className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-10 text-sm md:gap-16">
            <div>
              <p className="mb-3 text-[13px] font-medium text-[var(--color-text-muted)]">
                Menu
              </p>
              <ul className="space-y-2.5 text-[var(--color-text-body)]">
                <li><Link href="/news" className="transition-colors hover:text-[var(--color-text-strong)]">금융소식</Link></li>
                <li><Link href="/diagnosis" className="transition-colors hover:text-[var(--color-text-strong)]">자산진단</Link></li>
                <li><Link href="/recruit" className="transition-colors hover:text-[var(--color-text-strong)]">인재채용</Link></li>
                <li><Link href="/#consultation" className="transition-colors hover:text-[var(--color-text-strong)]">상담 예약</Link></li>
              </ul>
            </div>
            <div>
              <p className="mb-3 text-[13px] font-medium text-[var(--color-text-muted)]">
                Profile
              </p>
              <ul className="space-y-2.5 text-[var(--color-text-body)]">
                <li className="text-[var(--color-text-muted)]">{BRAND.company}</li>
                <li className="text-[var(--color-text-muted)]">
                  <a href={`tel:${BRAND.phone}`} className="tabular-nums transition-colors hover:text-[var(--color-text-body)]">
                    {BRAND.phone}
                  </a>
                </li>
                <li className="text-[var(--color-text-muted)]">{BRAND.address}</li>
                <li>{BRAND.personName} {BRAND.title} · {years}년 차</li>
                <li>우수인증설계사 8년 연속</li>
                <li>
                  <a
                    href={BRAND.pressUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-text-body)] underline decoration-[var(--color-gold-dim)] underline-offset-4 transition-colors hover:decoration-[var(--color-gold)]"
                  >
                    GA명장 언론보도 ↗
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 border-t border-[var(--color-line)] pt-6 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          <p>
            본 사이트의 콘텐츠는 금융 정보 제공을 목적으로 하며, 특정 상품의 권유가 아닙니다.
            보험 계약 체결 전 상품설명서와 약관을 반드시 확인하시기 바랍니다.
          </p>
          <p className="mt-2">
            © {new Date().getFullYear()} {BRAND.siteName}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
