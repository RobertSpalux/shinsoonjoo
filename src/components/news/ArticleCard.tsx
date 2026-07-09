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

const CATEGORY_COLORS: Record<string, string> = {
  금융뉴스: "text-sky-300 border-sky-900",
  생활경제: "text-emerald-300 border-emerald-900",
  보상꿀팁: "text-[var(--color-gold-light)] border-[var(--color-gold-dim)]",
  판례해설: "text-rose-300 border-rose-900",
  천안소식: "text-violet-300 border-violet-900",
};

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
        className="flex h-full flex-col rounded-2xl border border-[var(--color-line)] bg-[var(--color-ink-card)] p-7 transition-all duration-500 hover:-translate-y-1 hover:border-[var(--color-gold-dim)]/60 hover:shadow-xl hover:shadow-black/40 md:p-8"
      >
        <div className="mb-4 flex items-center justify-between">
          <span
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide ${
              CATEGORY_COLORS[category] ?? "text-zinc-400 border-[var(--color-line)]"
            }`}
          >
            {category}
          </span>
          <span className="text-[11px] text-zinc-600">{date}</span>
        </div>

        <h3 className="mb-3 text-lg font-bold leading-snug text-white transition-colors duration-300 group-hover:text-[var(--color-gold-light)]">
          {title}
        </h3>

        {summary && (
          <p className="mb-5 line-clamp-3 text-sm leading-relaxed text-zinc-400">
            {summary}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-[var(--color-line)] pt-4">
          <span className="text-xs font-medium text-zinc-500">
            신순주의 해설 읽기
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-zinc-600">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {viewCount.toLocaleString("ko-KR")}
          </span>
        </div>
      </Link>
    </motion.article>
  );
}
