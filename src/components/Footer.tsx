import Link from "next/link";
import { BRAND, getCareer } from "@/lib/brand";

export default function Footer() {
  const { years } = getCareer();

  return (
    <footer className="border-t border-[var(--color-line)] bg-[var(--color-ink-soft)]">
      <div className="mx-auto max-w-7xl px-6 py-14 md:px-12">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div>
            <p className="text-lg font-bold text-white">{BRAND.siteName}</p>
            <p className="mt-1 text-[10px] font-medium tracking-[0.22em] uppercase text-[var(--color-gold)]">
              {BRAND.siteNameEn}
            </p>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-zinc-500">
              {BRAND.verse.tagline}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 text-sm md:gap-16">
            <div>
              <p className="mb-3 text-xs font-semibold tracking-widest uppercase text-zinc-600">
                Menu
              </p>
              <ul className="space-y-2.5 text-zinc-400">
                <li><Link href="/news" className="hover:text-[var(--color-gold-light)]">금융소식</Link></li>
                <li><Link href="/diagnosis" className="hover:text-[var(--color-gold-light)]">자산진단</Link></li>
                <li><Link href="/recruit" className="hover:text-[var(--color-gold-light)]">인재채용</Link></li>
                <li><Link href="/#consultation" className="hover:text-[var(--color-gold-light)]">상담 예약</Link></li>
              </ul>
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold tracking-widest uppercase text-zinc-600">
                Profile
              </p>
              <ul className="space-y-2.5 text-zinc-400">
                <li>{BRAND.company}</li>
                <li>{BRAND.personName} {BRAND.title} · {years}년 차</li>
                <li>우수인증설계사 8년 연속</li>
                <li>
                  <a
                    href={BRAND.pressUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-gold-dim)] hover:text-[var(--color-gold-light)]"
                  >
                    GA명장 언론보도 ↗
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 border-t border-[var(--color-line)] pt-6 text-[11px] leading-relaxed text-zinc-600">
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
