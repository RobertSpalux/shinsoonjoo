"use client";

import { motion, useScroll, useSpring } from "framer-motion";

/** 기사 상단 고정 읽기 진행 바 — 체류·완독 유도 */
export default function ReadingProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 28, restDelta: 0.001 });

  return (
    <motion.div
      className="fixed inset-x-0 top-16 z-40 h-[3px] origin-left bg-[var(--color-gold)] print:hidden"
      style={{ scaleX }}
    />
  );
}
