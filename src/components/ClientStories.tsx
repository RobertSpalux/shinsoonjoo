"use client";

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

/**
 * 고객 사례 섹션 — 보험업법 광고 기준 준수:
 * 과장·보장성 표현 금지, 별점 등 평점 연출 지양,
 * 재구성 사례임을 하단에 명시 (실명·실데이터 노출 없음).
 */

const stories = [
  {
    id: 1,
    clientLabel: "3대 가족 고객",
    quote:
      "종신보험을 '사랑의 바통'이라 부르시는 지사장님. 저희 3대의 미래를 든든하게 설계해 주셨습니다.",
    tags: ["종신보험", "3대 설계", "가족신뢰"],
  },
  {
    id: 2,
    clientLabel: "출산 후 보상 해결",
    quote:
      "출산 후 아이를 안고 전남까지 내려와 보상 문제를 끝까지 해결해 주시던 그 책임감, 평생 잊지 못합니다.",
    tags: ["보상처리", "책임감", "현장방문"],
  },
  {
    id: 3,
    clientLabel: "질병 위기 극복",
    quote:
      "예기치 못한 질병으로 막막했을 때, 가족처럼 곁을 지켜주신 덕분에 큰 위기를 넘겼습니다.",
    tags: ["위기관리", "질병보장", "동행"],
  },
];

function StoryCard({
  story,
  index,
}: {
  story: (typeof stories)[0];
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      ref={ref}
      initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: index * 0.12, ease: "easeOut" }}
      className="min-w-[300px] flex-shrink-0 snap-center md:min-w-0 md:flex-shrink"
    >
      <article className="group flex h-full flex-col rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-card)] p-8 transition-colors duration-500 hover:border-[var(--color-gold-dim)]/60 md:p-10">
        <span aria-hidden className="block h-px w-6 bg-[var(--color-gold)]" />

        <blockquote className="mt-6 flex-1">
          <p className="text-[15px] leading-relaxed text-[var(--color-text-body)]">
            &ldquo;{story.quote}&rdquo;
          </p>
        </blockquote>

        <div className="my-6 h-px w-8 bg-[var(--color-line)]" />

        <p className="mb-4 text-sm font-semibold text-[var(--color-text-strong)]">
          {story.clientLabel}
        </p>

        <div className="flex flex-wrap gap-2">
          {story.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-sm border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      </article>
    </motion.div>
  );
}

export default function ClientStories() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });
  const reduceMotion = useReducedMotion();

  return (
    <section
      ref={sectionRef}
      className="relative w-full bg-[var(--color-ink-soft)] py-24 md:py-32"
    >
      <div className="mx-auto max-w-6xl px-6 md:px-12 lg:px-20">
        <motion.div
          initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="mb-16 text-center md:mb-20"
        >
          <p className="mb-6 text-xs font-semibold tracking-[0.08em] uppercase text-[var(--color-text-muted)]">
            Client Stories
          </p>
          <h2
            className="text-3xl font-semibold leading-snug tracking-[-0.01em] text-[var(--color-text-strong)] md:text-4xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            현장에서 쌓인
            <br />
            신뢰의 이야기
          </h2>
        </motion.div>

        <div className="-mx-6 flex gap-6 overflow-x-auto px-6 pb-4 snap-x snap-mandatory md:mx-0 md:grid md:grid-cols-3 md:gap-8 md:overflow-visible md:px-0 md:pb-0">
          {stories.map((story, index) => (
            <StoryCard key={story.id} story={story} index={index} />
          ))}
        </div>

        <motion.p
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ delay: 0.8 }}
          className="mt-6 text-center text-[11px] font-medium text-[var(--color-text-muted)] md:hidden"
        >
          ← 스와이프하여 더 보기 →
        </motion.p>

        <p className="mt-8 text-center text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          위 사례는 실제 상담 경험을 바탕으로 재구성했으며, 개인정보 보호를 위해
          세부 내용을 각색했습니다.
        </p>
      </div>
    </section>
  );
}
