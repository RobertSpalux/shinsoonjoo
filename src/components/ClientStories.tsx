"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";

const stories = [
  {
    id: 1,
    clientLabel: "3대 가족 고객",
    quote:
      "종신보험을 '사랑의 바통'이라 부르시는 지사장님. 저희 3대의 미래를 완벽하게 설계해 주셨습니다.",
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

function StarRating() {
  return (
    <div className="flex gap-0.5">
      {[...Array(5)].map((_, i) => (
        <svg
          key={i}
          className="h-4 w-4 text-[var(--color-gold)]"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

function StoryCard({
  story,
  index,
}: {
  story: (typeof stories)[0];
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: index * 0.12, ease: "easeOut" }}
      className="min-w-[300px] flex-shrink-0 snap-center md:min-w-0 md:flex-shrink"
    >
      <article className="group flex h-full flex-col rounded-2xl border border-slate-100 bg-white p-8 shadow-lg shadow-slate-200/50 transition-all duration-500 hover:shadow-xl hover:shadow-slate-200/60 md:p-10">
        <StarRating />

        <blockquote className="mt-6 flex-1">
          <p className="text-[15px] font-medium leading-relaxed text-slate-700">
            &ldquo;{story.quote}&rdquo;
          </p>
        </blockquote>

        <div className="my-6 h-px w-8 bg-slate-200" />

        <p className="mb-4 text-sm font-bold text-slate-900">
          {story.clientLabel}
        </p>

        <div className="flex flex-wrap gap-2">
          {story.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500"
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

  return (
    <section
      ref={sectionRef}
      className="relative w-full bg-[var(--color-cream-dark)] py-24 md:py-32"
    >
      <div className="mx-auto max-w-6xl px-6 md:px-12 lg:px-20">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="mb-16 text-center md:mb-20"
        >
          <p className="mb-6 text-xs font-semibold tracking-[0.25em] uppercase text-slate-400">
            Client Stories
          </p>
          <h2 className="text-3xl font-extrabold leading-snug tracking-tight text-slate-900 md:text-4xl">
            고객이 직접 전하는
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
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ delay: 0.8 }}
          className="mt-6 text-center text-[11px] font-medium tracking-wider text-slate-400 md:hidden"
        >
          ← 스와이프하여 더 보기 →
        </motion.p>
      </div>
    </section>
  );
}
