"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import CountUp from "./CountUp";
import { BRAND, getCareer } from "@/lib/brand";

export default function HeroSection() {
  const { years, days } = getCareer();

  return (
    <section className="relative w-full overflow-hidden bg-[var(--color-ink)]">
      {/* 은은한 골드 글로우 */}
      <div className="pointer-events-none absolute -top-40 right-0 h-[500px] w-[500px] rounded-full bg-[var(--color-gold)]/[0.06] blur-3xl" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-6 pt-28 pb-16 md:flex-row md:items-center md:gap-16 md:px-12 lg:gap-20 lg:px-20">
        {/* Left : Text */}
        <div className="flex w-full flex-col justify-center md:w-3/5">
          {/* 언론보도 배너 */}
          <motion.a
            href={BRAND.pressUrl}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="mb-8 inline-flex w-fit items-center gap-2.5 rounded-full border border-[var(--color-gold-dim)]/50 bg-[var(--color-gold)]/[0.07] px-4 py-2 text-xs font-medium text-[var(--color-gold-light)] transition-colors duration-300 hover:bg-[var(--color-gold)]/[0.14]"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-gold)]" />
            보험신보 보도 · 2025 우수인증설계사 · GA명장
            <span aria-hidden>↗</span>
          </motion.a>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mb-5 text-xs font-semibold tracking-[0.25em] uppercase text-zinc-500"
          >
            {BRAND.siteNameEn}
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25 }}
            className="mb-7 text-[2.5rem] font-extrabold leading-tight tracking-tight text-white md:text-5xl lg:text-[3.4rem]"
          >
            {years}년, {days.toLocaleString("ko-KR")}일.
            <br />
            약속을 지켜온
            <br />
            <span className="text-[var(--color-gold)]">가장 선한 금융</span>
          </motion.h1>

          {/* 창세기 45:5 — 시그니처 서사 */}
          <motion.blockquote
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.2, delay: 0.5 }}
            className="mb-9 max-w-lg border-l-2 border-[var(--color-gold-dim)] pl-5"
          >
            <p
              className="text-[15px] leading-relaxed text-zinc-300"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              &ldquo;{BRAND.verse.text}&rdquo;
              <span className="mt-1 block text-xs text-zinc-500">
                — {BRAND.verse.ref}
              </span>
            </p>
            <p className="mt-3 text-sm font-medium leading-relaxed text-zinc-400">
              {BRAND.verse.tagline}
            </p>
          </motion.blockquote>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.65 }}
            className="mb-14 flex flex-wrap items-center gap-4"
          >
            <Link
              href="/diagnosis"
              className="inline-flex items-center gap-3 rounded-full bg-[var(--color-gold)] px-8 py-4 text-sm font-bold tracking-wide text-black transition-all duration-300 hover:bg-[var(--color-gold-light)] hover:shadow-xl hover:shadow-[var(--color-gold)]/20"
            >
              내 자산 방어력 진단하기
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <a
              href="#consultation"
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-7 py-4 text-sm font-semibold text-zinc-300 transition-all duration-300 hover:border-[var(--color-gold-dim)] hover:text-[var(--color-gold-light)]"
            >
              1:1 상담 예약
            </a>
          </motion.div>

          {/* Metrics */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.8 }}
            className="grid grid-cols-3 gap-6 border-t border-[var(--color-line)] pt-8 md:max-w-lg md:gap-10"
          >
            <CountUp end={days} duration={2.8} label="고객과 함께한 날" suffix="일" />
            <CountUp end={8} duration={2} label="우수인증설계사 연속" suffix="년" />
            <CountUp end={years} duration={2} label="현장 경력" suffix="년차" />
          </motion.div>
        </div>

        {/* Right : Profile */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.3 }}
          className="mt-12 flex w-full items-center justify-center md:mt-0 md:w-2/5"
        >
          <div className="relative aspect-[3/4] w-full max-w-sm">
            <div className="absolute -inset-3 rounded-2xl border border-[var(--color-gold-dim)]/30" />
            <div className="relative h-full w-full overflow-hidden rounded-2xl bg-zinc-900">
              <Image
                src="/soonjoo.jpg"
                alt={`${BRAND.personName} ${BRAND.title} — ${BRAND.company}`}
                fill
                className="object-cover object-top grayscale-[35%]"
                priority
                sizes="(max-width: 768px) 100vw, 40vw"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-6 pt-16 pb-5">
                <p className="text-sm font-bold text-white">
                  {BRAND.personName} <span className="font-medium text-zinc-400">{BRAND.title}</span>
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-gold-light)]">
                  {BRAND.company}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
