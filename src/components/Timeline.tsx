"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const milestones = [
  {
    year: "2003",
    title: "보험업계 입문",
    description:
      "사람을 살리는 일의 시작. 고객의 삶을 지키겠다는 신념으로 보험업계에 첫 발을 내딛다.",
  },
  {
    year: "2007",
    title: "동부생명 연도대상 수상",
    description:
      "끝까지 책임지는 신뢰의 증명. 탁월한 성과와 고객 만족도를 인정받아 최고 영예인 연도대상 수상.",
  },
  {
    year: "2018–2025",
    title: "8년 연속 우수인증설계사",
    description:
      "유지율과 품질로 증명한 상위 1%. 단 한 해도 빠짐없이 선정되며 꾸준함이 곧 신뢰임을 증명하다.",
  },
  {
    year: "현재",
    title: "프라임에셋 140본부 천안3지점 지사장",
    description:
      "24년의 경험과 철학을 바탕으로, 지점을 이끌며 후배 양성과 고객 자산 보호에 매진 중.",
  },
];

function TimelineItem({
  milestone,
  index,
}: {
  milestone: (typeof milestones)[0];
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const isLeft = index % 2 === 0;

  return (
    <div
      ref={ref}
      className={`relative flex w-full items-start ${
        isLeft ? "md:justify-start" : "md:justify-end"
      }`}
    >
      {/* Desktop center dot */}
      <motion.div
        initial={{ scale: 0 }}
        animate={isInView ? { scale: 1 } : {}}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="absolute left-1/2 top-10 z-10 hidden h-3 w-3 -translate-x-1/2 rounded-full border-2 border-[var(--color-gold)] bg-white md:block"
      />

      {/* Mobile dot */}
      <motion.div
        initial={{ scale: 0 }}
        animate={isInView ? { scale: 1 } : {}}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="absolute left-6 top-10 z-10 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-[var(--color-gold)] bg-white md:hidden"
      />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, x: isLeft ? -30 : 30 }}
        animate={isInView ? { opacity: 1, x: 0 } : {}}
        transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
        className={`ml-14 w-full md:ml-0 md:w-[calc(50%-2.5rem)] ${
          isLeft ? "md:mr-auto md:pr-8" : "md:ml-auto md:pl-8"
        }`}
      >
        <div className="rounded-2xl border border-slate-100 bg-white p-7 shadow-lg shadow-slate-200/50 transition-all duration-500 hover:shadow-xl hover:shadow-slate-200/60 md:p-8">
          <span className="mb-1 block text-2xl font-extrabold tracking-tight text-slate-900">
            {milestone.year}
          </span>
          <h3 className="mb-3 text-sm font-bold text-slate-500">
            {milestone.title}
          </h3>
          <p className="text-sm font-medium leading-relaxed text-slate-600">
            {milestone.description}
          </p>
        </div>
      </motion.div>
    </div>
  );
}

export default function Timeline() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });

  return (
    <section
      ref={sectionRef}
      className="relative w-full bg-[var(--color-cream)] py-24 md:py-32"
    >
      <div className="mx-auto max-w-6xl px-6 md:px-12 lg:px-20">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="mb-20 text-center md:mb-28"
        >
          <p className="mb-8 text-xs font-semibold tracking-[0.25em] uppercase text-slate-400">
            Philosophy & History
          </p>

          <blockquote className="mx-auto max-w-2xl">
            <div className="mx-auto mb-6 h-px w-10 bg-slate-300" />
            <p className="text-2xl font-extrabold leading-snug tracking-tight text-slate-900 md:text-3xl lg:text-[2.5rem]">
              보험영업은 단순한 판매가 아니라
              <br />
              사람의 미래를 책임지는
              <br />
              <span className="font-black underline decoration-slate-300 decoration-1 underline-offset-4">
                사명
              </span>
              입니다.
            </p>
            <cite className="mt-6 block text-sm font-semibold tracking-wider text-slate-400 not-italic">
              — 신순주 지사장
            </cite>
            <div className="mx-auto mt-6 h-px w-10 bg-slate-300" />
          </blockquote>
        </motion.div>

        {/* Timeline */}
        <div className="relative">
          {/* Desktop center line - very subtle */}
          <div className="absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-slate-200 md:block" />

          {/* Mobile line */}
          <div className="absolute left-6 top-0 h-full w-px -translate-x-1/2 bg-slate-200 md:hidden" />

          <div className="space-y-8 md:space-y-14">
            {milestones.map((milestone, index) => (
              <TimelineItem
                key={milestone.year}
                milestone={milestone}
                index={index}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
