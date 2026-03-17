"use client";

import { motion } from "framer-motion";
import CountUp from "./CountUp";

export default function HeroSection() {
  return (
    <section className="relative min-h-screen w-full overflow-hidden bg-[var(--color-cream)]">
      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-24 md:flex-row md:items-center md:gap-16 md:px-12 lg:gap-20 lg:px-20">
        {/* Left - 60% : Text */}
        <div className="flex w-full flex-col justify-center md:w-3/5">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mb-5 text-xs font-semibold tracking-[0.25em] uppercase text-slate-400"
          >
            Private Insurance Banker
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25 }}
            className="mb-6 text-[2.5rem] font-extrabold leading-tight tracking-tight text-slate-900 md:text-5xl lg:text-[3.5rem]"
          >
            24년의 신뢰,
            <br />
            업계 상위 1%의
            <br />
            보험 전문가
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="mb-10 max-w-md text-[15px] font-medium leading-relaxed text-slate-600 md:text-base"
          >
            숫자가 아닌 사람을 봅니다.
            <br />
            고객 한 분 한 분의 삶에 맞춘 맞춤 설계로,
            <br />
            진정한 자산 보호를 실현합니다.
          </motion.p>

          {/* CTA Button - Dark navy, rounded-full */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55 }}
            className="mb-14"
          >
            <a
              href="#consultation"
              className="inline-flex items-center gap-3 rounded-full bg-slate-900 px-8 py-4 text-sm font-semibold tracking-wide text-white transition-all duration-300 hover:bg-slate-800 hover:shadow-xl hover:shadow-slate-900/10"
            >
              무료 상담 예약
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                />
              </svg>
            </a>
          </motion.div>

          {/* Metrics row - 3 col horizontal */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.7 }}
            className="grid grid-cols-3 gap-6 border-t border-slate-200 pt-8 md:max-w-lg md:gap-10"
          >
            <CountUp end={2003} duration={2.5} label="업계 입문" suffix="년" />
            <CountUp
              end={2007}
              duration={2.5}
              label="연도대상 수상"
              suffix="년"
            />
            <CountUp
              end={24}
              duration={2}
              label="경력"
              suffix="년차"
            />
          </motion.div>
        </div>

        {/* Right - 40% : Profile image placeholder */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.3 }}
          className="mt-12 flex w-full items-center justify-center md:mt-0 md:w-2/5"
        >
          <div className="relative aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl bg-slate-200">
            {/* Placeholder inner content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-300/80">
                <svg
                  className="h-6 w-6 text-slate-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                  />
                </svg>
              </div>
              <span className="text-xs font-medium text-slate-400">
                프로필 사진
              </span>
            </div>

            {/* Subtle gold accent border */}
            <div className="absolute inset-0 rounded-2xl ring-1 ring-slate-200" />
          </div>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.8 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
          className="flex flex-col items-center gap-2"
        >
          <span className="text-[10px] font-medium tracking-[0.2em] uppercase text-slate-300">
            Scroll
          </span>
          <div className="h-6 w-px bg-gradient-to-b from-slate-300 to-transparent" />
        </motion.div>
      </motion.div>
    </section>
  );
}
