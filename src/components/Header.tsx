"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

const NAV = [
  { href: "/", label: "홈", en: "Heritage" },
  { href: "/news", label: "금융소식", en: "Insight" },
  { href: "/diagnosis", label: "자산진단", en: "Diagnosis" },
  { href: "/recruit", label: "인재채용", en: "Recruit" },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  return (
    <header className="fixed top-0 z-50 w-full border-b border-[var(--color-line)] bg-[#faf9f6]/85 backdrop-blur-md print:static print:bg-transparent print:backdrop-blur-none">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 md:px-12">
        <Link href="/" className="group flex flex-col leading-tight">
          <span className="text-[15px] font-bold tracking-tight text-[var(--color-text-strong)]">
            신순주의 선한 금융
          </span>
          <span className="text-[9px] font-medium tracking-[0.08em] uppercase text-[var(--color-text-muted)]">
            Shin Soon Joo Good Finance
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-[var(--color-text-body)] transition-colors duration-300 hover:text-[var(--color-text-strong)]"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/#consultation"
            className="rounded-sm border border-[var(--color-forest)] px-5 py-2 text-sm font-semibold text-[var(--color-forest)] transition-colors duration-300 hover:bg-[var(--color-forest)] hover:text-[var(--color-ink)]"
          >
            상담 예약
          </Link>
        </nav>

        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen(!open)}
          aria-label="메뉴 열기"
          className="flex h-10 w-10 flex-col items-center justify-center gap-1.5 md:hidden"
        >
          <span
            className={`h-px w-5 bg-[var(--color-text-strong)] transition-transform duration-300 ${open ? "translate-y-[3.5px] rotate-45" : ""}`}
          />
          <span
            className={`h-px w-5 bg-[var(--color-text-strong)] transition-transform duration-300 ${open ? "-translate-y-[3.5px] -rotate-45" : ""}`}
          />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-[var(--color-line)] bg-[var(--color-ink-card)] md:hidden"
          >
            <div className="flex flex-col px-6 py-4">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex items-baseline justify-between border-b border-[var(--color-line)] py-4 text-base font-medium text-[var(--color-text-body)]"
                >
                  {item.label}
                  <span className="text-[10px] tracking-[0.08em] uppercase text-[var(--color-text-muted)]">
                    {item.en}
                  </span>
                </Link>
              ))}
              <Link
                href="/#consultation"
                onClick={() => setOpen(false)}
                className="mt-4 rounded-sm bg-[var(--color-forest)] py-3 text-center text-sm font-semibold text-[var(--color-ink)]"
              >
                상담 예약
              </Link>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
