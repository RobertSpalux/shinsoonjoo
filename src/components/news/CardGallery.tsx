"use client";

import Image from "next/image";
import { motion } from "framer-motion";

/** 기사 내 카드뉴스 가로 스크롤 갤러리 — 텍스트 피로를 끊고 체류시간을 늘리는 시각 블록 */
export default function CardGallery({ images, title }: { images: string[]; title: string }) {
  if (!images?.length) return null;

  return (
    <motion.figure
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6 }}
      className="my-10"
    >
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 [-ms-overflow-style:none] [scrollbar-width:thin]">
        {images.map((src, i) => (
          <div
            key={src}
            className="relative aspect-[4/5] w-64 flex-none snap-center overflow-hidden rounded-xl border border-[var(--color-line)] shadow-sm md:w-72"
          >
            <Image
              src={src}
              alt={`${title} 카드뉴스 ${i + 1}`}
              fill
              className="object-cover"
              sizes="288px"
            />
          </div>
        ))}
      </div>
      <figcaption className="mt-1 text-center text-xs text-slate-400">
        ← 옆으로 넘겨보세요 · 저장해두고 필요할 때 꺼내보세요
      </figcaption>
    </motion.figure>
  );
}
