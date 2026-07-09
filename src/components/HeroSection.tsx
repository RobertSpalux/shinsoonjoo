"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { BRAND, getCareer } from "@/lib/brand";

export default function HeroSection() {
  const { years } = getCareer();
  const reduceMotion = useReducedMotion();

  const fadeUp = (delay: number) =>
    reduceMotion
      ? { initial: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.6, delay, ease: "easeOut" as const },
        };

  return (
    <section className="relative w-full bg-[var(--color-ink)]">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 pt-28 pb-16 md:flex-row md:items-center md:gap-16 md:px-12 lg:gap-20 lg:px-20">
        {/* Left : Text */}
        <div className="flex w-full flex-col justify-center md:w-3/5">
          <motion.p
            {...fadeUp(0.05)}
            className="mb-6 text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)]"
          >
            {BRAND.siteNameEn}
          </motion.p>

          <motion.h1
            {...fadeUp(0.15)}
            className="mb-6 font-serif text-[2.25rem] font-semibold leading-[1.22] tracking-[-0.015em] text-[var(--color-forest)] md:text-[3.25rem]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            당신도 모르게,
            <br />
            새고 있는 보험이 있습니다.
          </motion.h1>

          <motion.p
            {...fadeUp(0.25)}
            className="mb-8 max-w-xl text-base leading-relaxed text-[var(--color-text-body)] md:text-lg"
          >
            {years}년 현장 노하우로 직접 개발한 리모델링 진단 시스템 — 기존
            계약 전체를 분석해 새는 보장을 찾아내고, 꼭 필요한 것만 남겨 다시
            설계합니다.
          </motion.p>

          {/* 창세기 45:5 — 시그니처 서사 */}
          <motion.div {...fadeUp(0.35)} className="mb-8 max-w-lg">
            <span
              aria-hidden
              className="mb-4 block h-px w-6 bg-[var(--color-gold)]"
            />
            <blockquote
              className="text-[15px] italic leading-relaxed text-[var(--color-text-body)]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              &ldquo;{BRAND.verse.text}&rdquo;
              <span className="mt-1 block not-italic text-xs text-[var(--color-text-muted)]">
                — {BRAND.verse.ref}
              </span>
            </blockquote>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-body)]">
              {BRAND.verse.tagline}
            </p>
          </motion.div>

          <motion.div {...fadeUp(0.45)} className="mb-12">
            <p className="mb-4 text-sm text-[var(--color-text-muted)]">
              &ldquo;저를 믿으세요&rdquo;라고 말하지 않습니다. 계약 전체를
              분석한 결과로 증명합니다.
            </p>
            <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
              <Link
                href="/diagnosis"
                className="inline-flex items-center rounded-sm bg-[var(--color-forest)] px-7 py-3.5 text-sm font-semibold text-[var(--color-ink)] transition-[background-color,transform] duration-300 hover:-translate-y-px hover:bg-[var(--color-forest-soft)]"
              >
                내 보험 진단받기
              </Link>
              <a
                href="#consultation"
                className="border-b border-[var(--color-gold-dim)] pb-0.5 text-sm font-medium text-[var(--color-text-strong)] transition-colors duration-300 hover:border-[var(--color-gold)]"
              >
                1:1 상담 예약
              </a>
            </div>
          </motion.div>

          {/* 언론·자격 마크 */}
          <motion.a
            {...fadeUp(0.55)}
            href={BRAND.pressUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit border-t border-[var(--color-line)] pt-6 text-xs text-[var(--color-text-muted)] underline-offset-4 transition-colors duration-300 hover:text-[var(--color-text-body)] hover:underline"
          >
            {BRAND.pressMarks.join(" · ")}
          </motion.a>
        </div>

        {/* Right : Profile — 웜 모노톤, 단일 프레임 */}
        <motion.div
          {...(reduceMotion
            ? { initial: { opacity: 1 } }
            : {
                initial: { opacity: 0 },
                animate: { opacity: 1 },
                transition: { duration: 0.9, delay: 0.3 },
              })}
          className="mt-12 flex w-full flex-col items-center md:mt-0 md:w-2/5"
        >
          <div className="w-full max-w-sm">
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)]">
              <Image
                src="/soonjoo.jpg"
                alt={`${BRAND.personName} ${BRAND.title}`}
                fill
                className="object-cover object-top brightness-[1.02] contrast-[1.02] grayscale-[40%] sepia-[8%]"
                priority
                sizes="(max-width: 768px) 100vw, 40vw"
              />
            </div>
            {/* 잡지식 캡션 */}
            <div className="mt-3 border-t border-[var(--color-line)] pt-3">
              <p className="text-sm font-medium text-[var(--color-text-strong)]">
                {BRAND.personName}{" "}
                <span className="font-normal text-[var(--color-text-muted)]">
                  {BRAND.title}
                </span>
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
