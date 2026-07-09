"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, motion, useReducedMotion } from "framer-motion";

interface CountUpProps {
  end: number;
  duration?: number;
  suffix?: string;
  label: string;
  /** cream = 딥그린 대비 밴드 위 (DESIGN-SPEC 3-4) */
  variant?: "ink" | "cream";
}

export default function CountUp({
  end,
  duration = 2,
  suffix = "",
  label,
  variant = "ink",
}: CountUpProps) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const hasAnimated = useRef(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!isInView || hasAnimated.current) return;
    hasAnimated.current = true;

    if (reduceMotion) {
      setCount(end);
      return;
    }

    const startTime = performance.now();

    function animate(currentTime: number) {
      const elapsed = (currentTime - startTime) / 1000;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(end * eased));

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
  }, [isInView, end, duration, reduceMotion]);

  return (
    <motion.div
      ref={ref}
      initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="flex flex-col"
    >
      <span
        className={`text-3xl font-bold tracking-tight tabular-nums md:text-4xl ${
          variant === "cream" ? "text-[var(--color-ink)]" : "text-[var(--color-text-strong)]"
        }`}
      >
        {count.toLocaleString("ko-KR")}
        <span className="text-xl font-semibold md:text-2xl">{suffix}</span>
      </span>
      <span
        className={`mt-1.5 text-xs font-medium ${
          variant === "cream" ? "text-[var(--color-ink)]/70" : "text-[var(--color-text-muted)]"
        }`}
      >
        {label}
      </span>
    </motion.div>
  );
}
