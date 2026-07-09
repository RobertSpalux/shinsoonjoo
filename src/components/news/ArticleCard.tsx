"use client";

import Link from "next/link";
import { motion } from "framer-motion";

interface ArticleCardProps {
  slug: string;
  title: string;
  category: string;
  summary: string | null;
  publishedAt: string | null;
  viewCount: number;
  index: number;
}

/**
 * 전환 카테고리('보험 리모델링')만 딥그린 잉크로 살짝 무게를 준다.
 * 나머지는 균일한 muted 라벨 — DESIGN-SPEC "확신에 찬 액센트 하나" 원칙.
 * (무지개 색코딩 = AI 템플릿 신호, 금지)
 */
function categoryClass(category: string) {
  return category === "보험 리모델링"
    ? "text-[var(--color-forest)]"
    : "text-[var(--color-text-muted)]";
}

export default function ArticleCard({
  slug,
  title,
  category,
  summary,
  publishedAt,
  viewCount,
  index,
}: ArticleCardProps) {
  const date = publishedAt
    ? new Date(publishedAt).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, delay: (index % 3) * 0.08, ease: "easeOut" }}
      className="group h-full"
    >
      <Link
        href={`/news/${slug}`}
        className="flex h-full flex-col rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-ink-card)] p-7 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-[var(--color-gold-dim)] hover:shadow-[var(--shadow-lift)] md:p-8"
      >
        {/* 카테고리 라벨 (오버라인) + 날짜 */}
        <div className="mb-4 flex items-center justify-between">
          <span
            className={`inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] ${categoryClass(
              category
            )}`}
          >
            <span className="h-px w-4 bg-[var(--color-gold)]" aria-hidden />
            {category}
          </span>
          <span className="text-[11px] tabular-nums text-[var(--color-text-muted)]">
            {date}
          </span>
        </div>

        <h3 className="mb-3 font-serif text-lg font-semibold leading-snug tracking-[-0.01em] text-[var(--color-text-strong)] transition-colors duration-300 group-hover:text-[var(--color-forest)]">
          {title}
        </h3>

        {summary && (
          <p className="mb-5 line-clamp-3 text-sm leading-relaxed text-[var(--color-text-body)]">
            {summary}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-[var(--color-line)] pt-4">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">
            신순주의 해설 읽기 →
          </span>
          <span className="inline-flex items-center gap-1 text-xs tabular-nums text-[var(--color-text-muted)]">
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.6}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            {viewCount.toLocaleString("ko-KR")}
          </span>
        </div>
      </Link>
    </motion.article>
  );
}
