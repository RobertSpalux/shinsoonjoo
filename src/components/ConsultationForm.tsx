"use client";

import { useRef, useState } from "react";
import { motion, useInView, AnimatePresence } from "framer-motion";

const categories = [
  "종신보험·사망보장",
  "실손·의료비",
  "연금·은퇴설계",
  "법인·CEO플랜",
  "보험리모델링",
  "기타 상담",
];

type FormState = "idle" | "submitting" | "success" | "error";

export default function ConsultationForm() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-80px" });

  const [formState, setFormState] = useState<FormState>("idle");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("");
  const [privacyAgreed, setPrivacyAgreed] = useState(false);

  const isValid = name.trim() && phone.trim() && category && privacyAgreed;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || formState === "submitting") return;

    setFormState("submitting");

    const res = await fetch("/api/consultation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        phone: phone.trim(),
        category,
        message: message.trim() || null,
        privacy_agreed: privacyAgreed,
      }),
    });

    if (!res.ok) {
      setFormState("error");
      setTimeout(() => setFormState("idle"), 3000);
      return;
    }

    setFormState("success");
    setName("");
    setPhone("");
    setCategory("");
    setMessage("");
    setPrivacyAgreed(false);
    setTimeout(() => setFormState("idle"), 4000);
  }

  const inputClass =
    "w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm font-medium text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900";

  return (
    <section
      ref={sectionRef}
      id="consultation"
      className="relative w-full bg-slate-900 py-24 md:py-32"
    >
      <div className="mx-auto max-w-6xl px-6 md:px-12 lg:px-20">
        <div className="grid gap-16 md:grid-cols-2 md:gap-20">
          {/* Left - Intro text */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7 }}
            className="flex flex-col justify-center"
          >
            <p className="mb-6 text-xs font-semibold tracking-[0.25em] uppercase text-slate-500">
              Private Consultation
            </p>
            <h2 className="mb-6 text-3xl font-extrabold leading-snug tracking-tight text-white md:text-4xl">
              프라이빗 상담 예약
            </h2>
            <p className="mb-8 text-[15px] font-medium leading-relaxed text-slate-400">
              24년간 쌓아온 전문성으로 고객님의 상황에 맞는
              <br className="hidden md:block" />
              최적의 보장 설계를 제안해 드립니다.
              <br className="hidden md:block" />
              부담 없이 문의해 주세요.
            </p>

            <div className="space-y-4 border-t border-slate-700 pt-8">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800">
                  <svg
                    className="h-4 w-4 text-[var(--color-gold)]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-xs text-slate-500">전화 상담</p>
                  <p className="text-sm font-bold text-white">
                    010-XXXX-XXXX
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800">
                  <svg
                    className="h-4 w-4 text-[var(--color-gold)]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-xs text-slate-500">상담 가능 시간</p>
                  <p className="text-sm font-bold text-white">
                    평일 09:00 – 18:00
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right - Form */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.15 }}
          >
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl border border-slate-700 bg-slate-800 p-8 md:p-10"
            >
              {/* Name */}
              <div className="mb-5">
                <label
                  htmlFor="name"
                  className="mb-1.5 block text-xs font-semibold text-slate-400"
                >
                  이름 *
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="홍길동"
                  className={inputClass}
                />
              </div>

              {/* Phone */}
              <div className="mb-5">
                <label
                  htmlFor="phone"
                  className="mb-1.5 block text-xs font-semibold text-slate-400"
                >
                  연락처 *
                </label>
                <input
                  id="phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="010-0000-0000"
                  className={inputClass}
                />
              </div>

              {/* Category */}
              <div className="mb-5">
                <label
                  htmlFor="category"
                  className="mb-1.5 block text-xs font-semibold text-slate-400"
                >
                  상담 분야 *
                </label>
                <select
                  id="category"
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={`${inputClass} appearance-none`}
                >
                  <option value="" disabled>
                    선택해 주세요
                  </option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {/* Message */}
              <div className="mb-5">
                <label
                  htmlFor="message"
                  className="mb-1.5 block text-xs font-semibold text-slate-400"
                >
                  상담 내용 (선택)
                </label>
                <textarea
                  id="message"
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="궁금하신 사항을 자유롭게 적어주세요"
                  className={`${inputClass} resize-none`}
                />
              </div>

              {/* Privacy agreement */}
              <div className="mb-6">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={privacyAgreed}
                    onChange={(e) => setPrivacyAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-500 accent-[var(--color-gold)]"
                  />
                  <span className="text-xs leading-relaxed text-slate-500">
                    개인정보 수집 및 이용에 동의합니다. 수집된 정보(이름,
                    연락처)는 상담 목적으로만 사용되며, 상담 완료 후 즉시
                    파기됩니다.
                  </span>
                </label>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={!isValid || formState === "submitting"}
                className="w-full rounded-full bg-[var(--color-gold)] py-4 text-sm font-bold tracking-wide text-white transition-all duration-300 hover:bg-[var(--color-gold-light)] hover:shadow-lg hover:shadow-[var(--color-gold)]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {formState === "submitting" ? (
                  <span className="inline-flex items-center gap-2">
                    <svg
                      className="h-4 w-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3"
                        className="opacity-25"
                      />
                      <path
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        className="opacity-75"
                      />
                    </svg>
                    전송 중...
                  </span>
                ) : (
                  "상담 신청하기"
                )}
              </button>
            </form>
          </motion.div>
        </div>
      </div>

      {/* Toast notification */}
      <AnimatePresence>
        {formState === "success" && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2"
          >
            <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-6 py-4 shadow-xl shadow-slate-200/60">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50">
                <svg
                  className="h-4 w-4 text-emerald-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.5 12.75l6 6 9-13.5"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">
                  상담 신청이 접수되었습니다
                </p>
                <p className="text-xs text-slate-500">
                  빠른 시일 내에 연락드리겠습니다
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {formState === "error" && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2"
          >
            <div className="flex items-center gap-3 rounded-2xl border border-red-100 bg-white px-6 py-4 shadow-xl shadow-slate-200/60">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-50">
                <svg
                  className="h-4 w-4 text-red-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">
                  전송에 실패했습니다
                </p>
                <p className="text-xs text-slate-500">
                  잠시 후 다시 시도해 주세요
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
