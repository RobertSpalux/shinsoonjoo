"use client";

import { motion } from "framer-motion";
import { BRAND, getCareer } from "@/lib/brand";

/**
 * 검증 가능한 신뢰 섹션 — 경쟁 분석의 핵심 차별점.
 * 자기 진술이 아니라 제3자가 검증 가능한 인증(협회 공식 조회, 언론 보도)을 전면에 세운다.
 * 대형 플랫폼(토스·굿리치)의 익명 설계사 구조가 만들 수 없는 자산.
 */

const PROOFS = [
  {
    label: "우수인증설계사 8년 연속",
    desc: "생명·손해보험협회 공식 인증. 동일사 3년 이상 근속, 불완전판매 0건, 계약 유지율 기준을 모두 통과해야 하며, 협회 '명예의 전당'에서 누구나 직접 조회할 수 있습니다.",
    link: { href: "https://www.klia.or.kr", text: "생명보험협회에서 직접 확인" },
  },
  {
    label: "GA명장",
    desc: "보험GA협회가 우수인증 5년 연속 달성자에게만 부여하는 타이틀. GA명장의 평균 계약 유지율은 97.6% — 전체 설계사 상위 일부만 도달하는 기준입니다.",
    link: { href: BRAND.pressUrl, text: "보험신보 언론보도 보기" },
  },
  {
    label: "천안 오프라인 지사 실체",
    desc: `${BRAND.company}. 온라인에만 존재하는 상담 창구가 아니라, 언제든 찾아올 수 있는 사무실과 팀이 있습니다.`,
    link: null,
  },
];

export default function TrustSection() {
  const { years, days } = getCareer();

  return (
    <section className="relative w-full bg-[var(--color-ink-soft)] py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-12">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7 }}
          className="mb-14 max-w-2xl md:mb-20"
        >
          <p className="mb-4 text-xs font-semibold tracking-[0.25em] uppercase text-[var(--color-gold)]">
            Verified Trust
          </p>
          <h2 className="mb-5 text-3xl font-extrabold leading-tight tracking-tight text-white md:text-4xl">
            말이 아니라,
            <br />
            <span className="text-[var(--color-gold)]">조회되는 신뢰</span>입니다
          </h2>
          <p className="text-[15px] leading-relaxed text-zinc-400">
            보험 앱들은 상담사가 누구인지 알려주지 않습니다. 저는 반대로 갑니다 —
            이름, 경력 {years}년({days.toLocaleString("ko-KR")}일), 인증 이력 전부를
            공개하고, 제3자 기관에서 직접 확인하실 수 있게 합니다.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {PROOFS.map((p, i) => (
            <motion.article
              key={p.label}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.6, delay: i * 0.12 }}
              className="flex flex-col rounded-2xl border border-[var(--color-line)] bg-[var(--color-ink-card)] p-8 transition-all duration-500 hover:border-[var(--color-gold-dim)]/60"
            >
              <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-gold-dim)]/50 bg-[var(--color-gold)]/10">
                <svg className="h-5 w-5 text-[var(--color-gold)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                </svg>
              </div>
              <h3 className="mb-3 text-lg font-bold text-white">{p.label}</h3>
              <p className="mb-5 flex-1 text-sm leading-relaxed text-zinc-400">{p.desc}</p>
              {p.link && (
                <a
                  href={p.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-[var(--color-gold-dim)] transition-colors hover:text-[var(--color-gold-light)]"
                >
                  {p.link.text} ↗
                </a>
              )}
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
