"use client";

import { motion, useReducedMotion } from "framer-motion";
import { BRAND, getCareer } from "@/lib/brand";

/**
 * 검증 가능한 신뢰 섹션 — 경쟁 분석의 핵심 차별점.
 * 자기 진술이 아니라 제3자가 검증 가능한 인증(협회 공식 인증, 언론 보도)과
 * 업계에서 드문 장기 근속을 신뢰 신호로 세운다.
 * 링크는 '확인 강요'가 아니라 '원하면 확인도 가능하다'는 안심 장치.
 */

export default function TrustSection() {
  const { years } = getCareer();
  const reduceMotion = useReducedMotion();

  const proofs = [
    {
      label: "우수인증설계사 8년 연속",
      desc: "생명·손해보험협회 공식 인증. 동일사 3년 이상 근속, 불완전판매 0건, 계약 유지율 기준을 모두 통과해야 하며, 원하시면 협회 '명예의 전당'에서 언제든 확인하실 수 있습니다.",
      link: { href: "https://www.klia.or.kr", text: "생명보험협회에서 확인 가능" },
    },
    {
      label: "GA명장",
      desc: "보험GA협회가 우수인증 5년 연속 달성자에게만 부여하는 타이틀. GA명장의 평균 계약 유지율은 97.6% — 전체 설계사 상위 일부만 도달하는 기준입니다.",
      link: { href: BRAND.pressUrl, text: "보험신보 보도 기사" },
    },
    {
      label: `${years}년, 한 자리를 지켜온 신뢰`,
      desc: `보험설계사 대부분이 몇 년 안에 자리를 옮기는 업계에서, ${years}년째 같은 자리에서 같은 고객을 지켜왔습니다. 오래 남는 사람이 끝까지 책임집니다.`,
      link: null,
    },
  ];

  const reveal = (delay: number) =>
    reduceMotion
      ? { initial: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: 24 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-60px" },
          transition: { duration: 0.6, delay },
        };

  return (
    <section className="relative w-full bg-[var(--color-ink-soft)] py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-12">
        <motion.div {...reveal(0)} className="mb-14 max-w-2xl md:mb-20">
          <p className="mb-4 text-xs font-semibold tracking-[0.08em] uppercase text-[var(--color-text-muted)]">
            Verified Trust
          </p>
          <h2
            className="mb-5 text-3xl font-semibold leading-[1.3] tracking-[-0.01em] text-[var(--color-forest)] md:text-4xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            관계가 아니라,
            <br />
            분석으로
          </h2>
          <p className="text-[15px] leading-relaxed text-[var(--color-text-body)]">
            &ldquo;아는 사람이라 믿고 맡겼는데&hellip;&rdquo; — 저를 찾아와 이렇게
            말씀하시는 분이 많습니다. 담당자는 몇 번씩 바뀌고, 요청하신 증권을 열어
            분석해보면 중복 가입·과한 설계·부족한 보장이 반복됩니다. 그 패턴을{" "}
            {years}년간 바로잡으며, 직접 분석 시스템을 만들었습니다.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {proofs.map((p, i) => (
            <motion.article
              key={p.label}
              {...reveal(i * 0.12)}
              className="flex flex-col rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-card)] p-8 transition-colors duration-500 hover:border-[var(--color-gold-dim)]/60"
            >
              <span aria-hidden className="mb-6 block h-px w-6 bg-[var(--color-gold)]" />
              <h3
                className="mb-3 text-lg font-semibold text-[var(--color-text-strong)]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {p.label}
              </h3>
              <p className="mb-5 flex-1 text-sm leading-relaxed text-[var(--color-text-body)]">
                {p.desc}
              </p>
              {p.link && (
                <a
                  href={p.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-fit text-xs font-medium text-[var(--color-text-strong)] underline decoration-[var(--color-gold-dim)] underline-offset-4 transition-colors hover:decoration-[var(--color-gold)]"
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
