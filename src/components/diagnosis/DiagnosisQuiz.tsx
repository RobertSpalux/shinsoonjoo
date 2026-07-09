"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getCareer } from "@/lib/brand";

/**
 * 4단계 자산 방어력 진단 퀴즈.
 * 무거운 개인정보 없이 가볍게 시작 → 결과 리포트 직전에 리드 폼.
 * 카카오싱크 도입 시 LeadForm 부분만 교체하면 되는 구조.
 */

const STEPS = [
  {
    key: "premium",
    question: "매달 나가는 보험료, 얼마나 되시나요?",
    hint: "본인 + 가족 합산 기준으로 대략이면 충분합니다.",
    multi: false,
    options: ["10만원 미만", "10~30만원", "30~50만원", "50~100만원", "100만원 이상", "잘 모르겠어요"],
  },
  {
    key: "coverages",
    question: "지금 갖고 계신 보장을 골라주세요",
    hint: "해당되는 것을 모두 선택하세요.",
    multi: true,
    options: ["실손의료비", "암 진단비", "뇌·심장 진단비", "종신·사망보장", "연금·저축", "간병·치매", "운전자·배상책임", "하나도 없거나 모름"],
  },
  {
    key: "risk",
    question: "가장 준비가 안 된 것 같은 리스크는?",
    hint: "지금 가장 걱정되는 것 하나만 골라주세요.",
    multi: false,
    options: ["암·중대질병 치료비", "간병비·치매", "은퇴 후 생활비", "상속세·증여", "가장의 소득 상실", "병원비(실손) 공백"],
  },
  {
    key: "profile",
    question: "마지막으로, 어디쯤 계신가요?",
    hint: "정확한 리포트 산출을 위한 마지막 질문입니다.",
    multi: false,
    options: ["2030 · 싱글", "3040 · 신혼/영유아 자녀", "4050 · 학령기 자녀", "5060 · 자녀 독립 준비", "60+ · 은퇴 전후", "법인 대표·사업자"],
  },
] as const;

type Answers = { premium?: string; coverages?: string[]; risk?: string; profile?: string };

function computeScore(a: Answers): number {
  let score = 40;
  const c = a.coverages ?? [];
  if (!c.includes("하나도 없거나 모름")) score += Math.min(c.length * 7, 35);
  if (a.premium === "잘 모르겠어요") score -= 8;
  if (a.premium === "10만원 미만") score -= 5;
  if (c.includes("실손의료비")) score += 5;
  if (a.risk === "상속세·증여" || a.risk === "간병비·치매") score -= 4; // 고난도 리스크 미비
  return Math.max(15, Math.min(88, score));
}

export default function DiagnosisQuiz() {
  const { years } = getCareer();
  const [step, setStep] = useState(0); // 0~3 질문, 4 리드폼, 5 완료
  const [answers, setAnswers] = useState<Answers>({});
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const score = useMemo(() => computeScore(answers), [answers]);

  const selectSingle = (key: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setTimeout(() => setStep((s) => s + 1), 250);
  };

  const toggleMulti = (key: "coverages", value: string) => {
    setAnswers((prev) => {
      const cur = prev[key] ?? [];
      return { ...prev, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  };

  const submit = async () => {
    if (!name.trim() || !phone.trim() || !agreed) {
      setError("이름, 연락처, 개인정보 동의는 필수입니다.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const params = new URLSearchParams(window.location.search);
      const res = await fetch("/api/diagnosis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          quiz_responses: answers,
          quiz_score: score,
          lead_source: params.get("utm_source") ?? params.get("ref") ?? "direct",
          privacy_agreed: agreed,
        }),
      });
      if (!res.ok) throw new Error();
      setStep(5);
    } catch {
      setError("전송에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  const current = step < 4 ? STEPS[step] : null;

  return (
    <div className="mx-auto w-full max-w-xl">
      {/* 진행 바 */}
      {step < 5 && (
        <div className="mb-10">
          <div className="mb-2 flex justify-between text-[11px] font-medium tracking-wider text-zinc-500">
            <span>{step < 4 ? `STEP ${step + 1} / 4` : "리포트 준비 완료"}</span>
            <span>{Math.min(Math.round(((step + 1) / 5) * 100), 100)}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[var(--color-line)]">
            <motion.div
              className="h-full rounded-full bg-[var(--color-gold)]"
              animate={{ width: `${((step + 1) / 5) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* 질문 단계 */}
        {current && (
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -32 }}
            transition={{ duration: 0.35 }}
          >
            <h2 className="mb-2 text-xl font-bold text-white md:text-2xl">{current.question}</h2>
            <p className="mb-8 text-sm text-zinc-500">{current.hint}</p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {current.options.map((opt) => {
                const selected = current.multi
                  ? (answers.coverages ?? []).includes(opt)
                  : answers[current.key as keyof Answers] === opt;
                return (
                  <button
                    key={opt}
                    onClick={() =>
                      current.multi ? toggleMulti("coverages", opt) : selectSingle(current.key, opt)
                    }
                    className={`rounded-xl border px-5 py-4 text-left text-sm font-medium transition-all duration-300 ${
                      selected
                        ? "border-[var(--color-gold)] bg-[var(--color-gold)]/10 text-[var(--color-gold-light)]"
                        : "border-[var(--color-line)] bg-[var(--color-ink-card)] text-zinc-300 hover:border-[var(--color-gold-dim)]/60"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            {current.multi && (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={(answers.coverages ?? []).length === 0}
                className="mt-8 w-full rounded-full bg-[var(--color-gold)] py-4 text-sm font-bold text-black transition-all duration-300 hover:bg-[var(--color-gold-light)] disabled:cursor-not-allowed disabled:opacity-30"
              >
                다음 단계로
              </button>
            )}

            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="mt-4 w-full text-center text-xs text-zinc-600 hover:text-zinc-400"
              >
                ← 이전 질문으로
              </button>
            )}
          </motion.div>
        )}

        {/* 리드 폼 (결과 확인 직전) */}
        {step === 4 && (
          <motion.div
            key="lead"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            transition={{ duration: 0.4 }}
          >
            {/* 점수 티저 — 블러 처리로 궁금증 유발 */}
            <div className="relative mb-8 overflow-hidden rounded-2xl border border-[var(--color-gold-dim)]/40 bg-[var(--color-ink-card)] p-8 text-center">
              <p className="text-xs font-semibold tracking-[0.2em] uppercase text-zinc-500">
                나의 자산 방어력
              </p>
              <p className="mt-3 text-5xl font-extrabold text-[var(--color-gold)] blur-md select-none" aria-hidden>
                {score}점
              </p>
              <p className="mt-3 text-sm text-zinc-400">
                진단이 완료되었습니다. 아래 정보를 남기시면
                <br />
                <strong className="text-white">{years}년 차 GA명장의 맞춤 해설 리포트</strong>를 보내드립니다.
              </p>
            </div>

            <div className="space-y-4">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="성함"
                className="w-full rounded-xl border border-[var(--color-line)] bg-black/40 px-4 py-3.5 text-sm text-white outline-none transition-all placeholder:text-zinc-600 focus:border-[var(--color-gold)] focus:ring-1 focus:ring-[var(--color-gold)]"
              />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="연락처 (010-0000-0000)"
                className="w-full rounded-xl border border-[var(--color-line)] bg-black/40 px-4 py-3.5 text-sm text-white outline-none transition-all placeholder:text-zinc-600 focus:border-[var(--color-gold)] focus:ring-1 focus:ring-[var(--color-gold)]"
              />
              <label className="flex items-start gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-card)] px-4 py-3.5 text-xs leading-relaxed text-zinc-400">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]"
                />
                <span>
                  개인정보 수집·이용에 동의합니다. 수집 항목(성함, 연락처, 진단 응답)은 진단
                  리포트 발송과 상담 연결 목적으로만 사용되며, 목적 달성 후 즉시 파기됩니다.
                </span>
              </label>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <button
                onClick={submit}
                disabled={submitting}
                className="w-full rounded-full bg-[var(--color-gold)] py-4 text-sm font-bold text-black transition-all duration-300 hover:bg-[var(--color-gold-light)] hover:shadow-lg hover:shadow-[var(--color-gold)]/20 disabled:opacity-40"
              >
                {submitting ? "전송 중..." : "무료 리포트 받고 결과 확인하기"}
              </button>
              <p className="text-center text-[11px] text-zinc-600">
                상담 강요는 없습니다. 리포트만 받아보셔도 됩니다.
              </p>
            </div>
          </motion.div>
        )}

        {/* 완료 — 점수 공개 */}
        {step === 5 && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <div className="mb-8 rounded-2xl border border-[var(--color-gold-dim)]/40 bg-[var(--color-ink-card)] p-10">
              <p className="text-xs font-semibold tracking-[0.2em] uppercase text-zinc-500">
                나의 자산 방어력
              </p>
              <motion.p
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.3, type: "spring", stiffness: 120 }}
                className="mt-3 text-6xl font-extrabold text-[var(--color-gold)]"
              >
                {score}<span className="text-2xl">점</span>
              </motion.p>
              <p className="mx-auto mt-5 max-w-sm text-sm leading-relaxed text-zinc-400">
                {score >= 70
                  ? "기본기가 탄탄하시네요. 다만 선택하신 리스크 영역은 정밀 점검이 필요합니다."
                  : score >= 45
                    ? "보장의 뼈대는 있지만 공백이 보입니다. 특히 선택하신 리스크가 무방비 상태일 가능성이 높습니다."
                    : "지금 구조로는 큰 위기 한 번에 자산이 흔들릴 수 있습니다. 빠른 점검을 권합니다."}
              </p>
            </div>
            <p className="text-sm leading-relaxed text-zinc-400">
              접수가 완료되었습니다. <strong className="text-white">24시간 이내</strong>에
              {years}년 차 GA명장 신순주 지사장이 직접 맞춤 리포트와 함께 연락드립니다.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
