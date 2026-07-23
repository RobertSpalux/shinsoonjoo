import Link from "next/link";
import {
  BRAND,
  getCareer,
  REQUIRED_NOTICES,
  CONDITIONAL_NOTICES,
  SITE_REVIEW,
  renderMandatoryNotice,
} from "@/lib/brand";

/**
 * 푸터 — 딥그린 대비 밴드 (DESIGN-SPEC 3-4).
 * 밴드 위 규칙: 텍스트 크림, 헤딩 세리프 크림, 마크는 골드 헤어라인만.
 * 소속·주소·연락처의 허용 위치 (CLAUDE.md 2절).
 */

/** 인스타그램 — 라인 마크 (lucide 1.x에서 브랜드 아이콘이 제거되어 인라인 SVG 사용) */
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

/** 카카오톡 채널 — 말풍선 실루엣 라인 마크 */
function KakaoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3.5c-5.24 0-9.5 3.28-9.5 7.32 0 2.6 1.77 4.88 4.43 6.18l-1.02 3.77c-.09.33.28.6.57.41l4.47-2.96c.34.03.69.05 1.05.05 5.24 0 9.5-3.28 9.5-7.45S17.24 3.5 12 3.5z" />
      <path d="M8.5 9.5v4M7 9.5h3M12.2 9.5v4l2.3-4M12.2 11.6l2.3 1.9" />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25z" />
    </svg>
  );
}

function MapPinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
      <path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0z" />
    </svg>
  );
}

export default function Footer() {
  const { years } = getCareer();

  // 광고 필수안내사항 — 심의 담당자 반송 의견에 따라 전 페이지 라이브 상시노출(반송 대응).
  //  · SITE_REVIEW(실제 심의필) 채워짐 → 실번호 상시 표시(publish).
  //  · SITE_REVIEW=null → 제출용 공란 예시(submission, 밑줄 제_____호) 상시 표시.
  // ⚠️ 심사자가 "번호·유효기간 예시(공란) 표기로 상시노출"을 명시 요구 → env 게이트 폐기(항상 렌더).
  // ⚠️ 임의번호 생성 금지(§6.3·§6.9) — 공란은 밑줄 형식 그대로. 심의 통과 시 SITE_REVIEW만 채우면 실번호 자동 치환.
  const siteNotice = SITE_REVIEW
    ? renderMandatoryNotice(SITE_REVIEW, "publish")
    : renderMandatoryNotice(null, "submission");
  // §26 표시기준: 승환계약 [유의사항]을 다른 안내와 시각적으로 차별화하기 위해 표시상 두 조각으로 분리한다.
  // indexOf 기준 슬라이스라 문구는 변형·축약 없이 전부 보존된다("[유의사항]" 라벨 포함).
  const cautionIdx = siteNotice ? siteNotice.indexOf("[유의사항]") : -1;
  const noticeMain =
    siteNotice && cautionIdx >= 0 ? siteNotice.slice(0, cautionIdx).trimEnd() : siteNotice;
  const noticeCaution =
    siteNotice && cautionIdx >= 0 ? siteNotice.slice(cautionIdx) : null;

  return (
    <footer className="border-t border-[var(--color-gold)] bg-[var(--color-forest)]">
      <div className="mx-auto max-w-7xl px-6 py-14 md:px-12">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div>
            <p
              className="text-lg font-semibold text-[var(--color-ink)]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {BRAND.siteName}
            </p>
            <p className="mt-1 text-[10px] font-medium tracking-[0.08em] uppercase text-[var(--color-ink)]/60">
              {BRAND.siteNameEn}
            </p>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-[var(--color-ink)]/75">
              {BRAND.verse.tagline}
            </p>
            <div className="mt-8 flex items-center gap-3">
              <a
                href={BRAND.social.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="인스타그램"
                className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[var(--color-ink)] text-[var(--color-forest)] transition-[background-color,transform] duration-300 hover:-translate-y-px hover:bg-white"
              >
                <InstagramIcon className="h-[22px] w-[22px]" />
              </a>
              <a
                href={BRAND.social.kakao}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="카카오톡 채널"
                className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[var(--color-ink)] text-[var(--color-forest)] transition-[background-color,transform] duration-300 hover:-translate-y-px hover:bg-white"
              >
                <KakaoIcon className="h-[22px] w-[22px]" />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-10 text-sm md:gap-16">
            <div>
              <p className="mb-3 text-[13px] font-medium text-[var(--color-ink)]/60">
                Menu
              </p>
              <ul className="space-y-2.5 text-[var(--color-ink)]/90">
                <li><Link href="/news" className="transition-colors hover:text-[var(--color-gold-light)]">금융소식</Link></li>
                <li><Link href="/diagnosis" className="transition-colors hover:text-[var(--color-gold-light)]">자산진단</Link></li>
                <li><Link href="/recruit" className="transition-colors hover:text-[var(--color-gold-light)]">인재채용</Link></li>
                <li><Link href="/#consultation" className="transition-colors hover:text-[var(--color-gold-light)]">상담 예약</Link></li>
                <li><Link href="/privacy" className="transition-colors hover:text-[var(--color-gold-light)]">개인정보 처리방침</Link></li>
              </ul>
            </div>
            <div>
              <p className="mb-3 text-[13px] font-medium text-[var(--color-ink)]/60">
                Profile
              </p>
              <ul className="space-y-2.5 text-[var(--color-ink)]/90">
                <li className="text-[var(--color-ink)]/75">{BRAND.company}</li>
                <li>
                  <a
                    href={`tel:${BRAND.phone}`}
                    className="inline-flex items-center gap-2 text-[var(--color-ink)]/75 transition-colors hover:text-[var(--color-gold-light)]"
                  >
                    <PhoneIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="tabular-nums">{BRAND.phone}</span>
                  </a>
                </li>
                <li className="flex items-start gap-2 text-[var(--color-ink)]/75">
                  <MapPinIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {BRAND.address}
                </li>
                <li>{BRAND.personName} {BRAND.title} · {years}년 차</li>
                <li>우수인증설계사 8년 연속</li>
                <li>
                  <a
                    href={BRAND.pressUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-ink)]/90 underline decoration-[var(--color-gold-dim)] underline-offset-4 transition-colors hover:text-[var(--color-gold-light)] hover:decoration-[var(--color-gold-light)]"
                  >
                    GA명장 언론보도 ↗
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-[var(--color-ink)]/15 pt-5 text-[11px] text-[var(--color-ink)]/70">
          {/* 일반 안내 4문장 — 문구 불변, 간격만 압축(space-y-1 · leading-snug). */}
          <div className="space-y-1 leading-snug">
            <p>
              본 사이트의 콘텐츠는 금융 정보 제공을 목적으로 하며, 특정 상품의 권유가 아닙니다.
              보험 계약 체결 전 상품설명서와 약관을 반드시 확인하시기 바랍니다.
            </p>
            {/* 필수 유의문구 2종 — 사이트 골격 심의용(§6.11-4). 게시글 본문에도 별도 노출. brand.ts 싱글소스. */}
            {REQUIRED_NOTICES.map((notice) => (
              <p key={notice}>{notice}</p>
            ))}
            {/* 담보·보험료 변동 조건부 안내 (brand.ts CONDITIONAL_NOTICES.premiumVariation) — 푸터에 정확히 1회.
                REQUIRED_NOTICES(personalOpinion·policyReference)에는 포함돼 있지 않으므로 중복 아님. */}
            <p>{CONDITIONAL_NOTICES.premiumVariation}</p>
          </div>

          {/* ── 광고 필수안내사항(협회 필수안내 전 항목) — 사이트 골격 심의필(§6.11-8) ──
              §26 표시기준: 딥그린 바탕과 구별되는 밝은 크림(/85~/95), 8pt↑, 승환계약 [유의사항]은 시각 차별화(골드 보더).
              SITE_REVIEW=null(미승인) → 제출용 공란 플레이스홀더(밑줄). 승인·번호 입력 시 실제 심의필 자동 노출.
              ⚠️ brand.ts 문구는 축약·변형 없이 그대로 렌더(split은 표시 목적이며 텍스트 불변). leading만 압축. */}
          {siteNotice && (
            // 규정 고지 박스 — 딥그린 위 은은한 밝은 면 + 얇은 골드 톤 테두리로 "필수안내 영역" 시각 분리.
            // ⚠️ 접기/토글 없음 — 항상 펼쳐진 상시노출.
            <div className="mt-5 rounded-lg border border-[var(--color-gold-dim)]/40 bg-[var(--color-ink)]/20 p-5">
              {/* 필수안내사항 전문 — md↑에서 CSS 2단 흐름(문자열 분할이 아니라 브라우저가 라인 흐름만 2단으로).
                  ⚠️ 심의필 공란 줄(제_____호)이 컬럼 경계에서 어색하게 끊기면 아래 두 클래스
                  (md:[column-count:2] md:[column-gap:2rem])만 제거해 1단으로 폴백한다. 문구는 불변. */}
              <p className="whitespace-pre-line text-[11px] leading-snug text-[var(--color-ink)]/85 md:[column-count:2] md:[column-gap:2rem]">
                {noticeMain}
              </p>
              {/* 승환계약 유의사항 — 박스 전체폭. 상단 구분선 + 골드 좌보더(§26 차별화). */}
              {noticeCaution && (
                <div className="mt-3 border-t border-[var(--color-gold-dim)]/40 pt-3">
                  <div className="border-l-2 border-[var(--color-gold)] pl-3">
                    <p className="whitespace-pre-line text-[11px] font-medium leading-snug text-[var(--color-ink)]/95">
                      {noticeCaution}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="mt-4">
            © {new Date().getFullYear()} {BRAND.siteName}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
