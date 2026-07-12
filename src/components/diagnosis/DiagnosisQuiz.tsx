"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BRAND, getCareer } from "@/lib/brand";
import { computeDiagnosis, type DiagnosisAnswers } from "@/lib/diagnosis-score";
import { gaEvent } from "@/lib/ga";
import CoverageMockup, { type ContractAnswer } from "@/components/CoverageMockup";

/**
 * 7문항 자산 방어력 진단 퀴즈 (N7 — 점수 로직은 lib/diagnosis-score.ts).
 * ⚠️ 리드 게이트 없음(N2) — 4문항 완료 즉시 점수·담보 합산 목업·잔여 공백 경고를 전부 공개한다.
 * ⚠️ 결과 화면 CTA는 카카오톡 상담 단 1개(N3) — 리포트 폼·전화 링크·채널추가 등
 * 빠져나갈 구멍을 두지 않는다. "웹의 KPI는 리드 수집이 아니라 상담 성사"(CLAUDE.md).
 * 리드 대신 4문항 완료 시점에 익명 진단 로그(응답+점수+유입, PII 없음)를 저장한다.
 * (시각은 라이트/에디토리얼 + 딥그린 밴드)
 */

/**
 * 7문항 (커밋 N7) — 브랜드 서사를 문항에 심는다:
 * "계약이 흩어져 합계를 모른다"(Q1) / "지인에게 맡겼다"(Q2) / "한 번도 안 봤다"(Q3) /
 * 보험료는 금액이 아니라 소득 대비 비율로 판단(Q4+Q5).
 */
const STEPS = [
  {
    key: "contracts",
    question: "보험 계약이 몇 개나 되시나요?",
    hint: "본인 명의 기준으로 대략이면 충분합니다.",
    multi: false,
    options: ["1~2개", "3~5개", "6~9개", "10개 이상", "잘 모르겠다"],
  },
  {
    key: "channel",
    question: "주로 어떤 경로로 가입하셨나요?",
    hint: "가장 많이 해당하는 하나만 골라주세요.",
    multi: false,
    options: ["지인·친척 소개", "설계사 권유", "다이렉트·온라인", "여러 곳이 섞임", "기억나지 않음"],
  },
  {
    key: "lastCheck",
    question: "마지막으로 보장 내용을 확인하신 게 언제인가요?",
    hint: "업계에서는 3~5년마다 점검을 권합니다.",
    multi: false,
    options: ["1년 이내", "1~3년 전", "3~5년 전", "5년 이상", "가입 후 한 번도 없음"],
  },
  {
    key: "premium",
    question: "매달 나가는 보험료, 얼마나 되시나요?",
    hint: "본인 + 가족 합산 기준으로 대략이면 충분합니다.",
    multi: false,
    options: ["10만원 미만", "10~30만원", "30~50만원", "50~100만원", "100만원 이상", "잘 모르겠다"],
  },
  {
    key: "income",
    question: "월 소득은 어느 정도이신가요?",
    hint: "보험료가 적정한지는 금액이 아니라 '소득 대비 비율'로 판단합니다.",
    multi: false,
    options: ["300만원 미만", "300~500만원", "500~800만원", "800만원 이상", "밝히고 싶지 않음"],
  },
  {
    key: "coverages",
    question: "지금 갖고 계신 보장을 골라주세요",
    hint: "해당되는 것을 모두 선택하세요.",
    multi: true,
    options: ["실손의료비", "암 진단비", "뇌·심장 진단비", "종신·사망보장", "수술비", "간병·치매", "연금·저축", "운전자·배상책임", "하나도 없거나 모름"],
  },
  {
    key: "profile",
    question: "마지막으로, 어디쯤 계신가요?",
    hint: "정확한 결과 산출을 위한 마지막 질문입니다.",
    multi: false,
    options: ["2030 · 싱글", "3040 · 신혼/영유아 자녀", "4050 · 학령기 자녀", "5060 · 자녀 독립 준비", "60+ · 은퇴 전후", "법인 대표·사업자"],
  },
] as const;

const TOTAL_STEPS = STEPS.length; // 7 — 질문 수. 결과 화면은 step === TOTAL_STEPS

type Answers = DiagnosisAnswers;

/**
 * 인증 3종 — 질문 화면 하단 딥그린 밴드(N9). 크림(질문) ↔ 딥그린(인증) 대비 리듬.
 * ⚠️ 결과 화면에서는 렌더하지 않는다 — 결과가 CTA 딥그린 밴드로 끝나 딥그린이 연속되기 때문.
 */
const TRUST = [
  ["8년 연속", "우수인증설계사"],
  ["GA명장", "보험GA협회 인증"],
  ["0건", "불완전판매 (인증 필수 요건)"],
] as const;

export default function DiagnosisQuiz() {
  const { years } = getCareer();
  const [step, setStep] = useState(0); // 0~6 질문, 7 결과(즉시 공개 — 게이트 없음)
  const [answers, setAnswers] = useState<Answers>({});

  const result = useMemo(() => computeDiagnosis(answers), [answers]);
  const score = result.total;

  // GA4 전환 퍼널: diagnosis_start(첫 응답) → diagnosis_complete(4문항 완료) → kakao_cta_click(상담 전환)
  const startedRef = useRef(false);
  const completedRef = useRef(false);
  const markStart = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    gaEvent("diagnosis_start");
  };
  useEffect(() => {
    if (step === TOTAL_STEPS && !completedRef.current) {
      completedRef.current = true;
      gaEvent("diagnosis_complete", { score });

      // 익명 진단 완료 로그 (커밋 N3) — 응답+점수+유입만 저장, 이름·연락처 null (PII 없음).
      // 어떤 프로필이 몇 점을 받고 이탈/전환하는지 추적용. 실패해도 사용자 흐름과 무관(fire-and-forget).
      const params = new URLSearchParams(window.location.search);
      // 채널 유입 구분: utm_source/medium/campaign을 lead_source(기존 필드)에 압축 저장
      const utm = [params.get("utm_source"), params.get("utm_medium"), params.get("utm_campaign")]
        .filter(Boolean)
        .join("/");
      // 폴백 'diagnosis-anon' — 실제 리드의 'direct'와 구분 (익명 로그 필터링용)
      const leadSource = utm || params.get("ref") || "diagnosis-anon";
      fetch("/api/diagnosis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anonymous: true,
          quiz_responses: answers,
          quiz_score: score,
          lead_source: leadSource,
        }),
      }).catch(() => undefined);
    }
  }, [step, score, answers]);

  const selectSingle = (key: string, value: string) => {
    markStart();
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setTimeout(() => setStep((s) => s + 1), 250);
  };

  const toggleMulti = (key: "coverages", value: string) => {
    markStart();
    setAnswers((prev) => {
      const cur = prev[key] ?? [];
      return { ...prev, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  };

  const current = step < TOTAL_STEPS ? STEPS[step] : null;
  const pct = Math.min(Math.round(((step + 1) / TOTAL_STEPS) * 100), 100);

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* 진행 바 — 각진 3px 트랙(반경 0), 라벨은 오버라인 스타일 (N9) */}
      {step < TOTAL_STEPS && (
        <div className="mb-10">
          <div className="mb-2 flex justify-between text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)]">
            <span>{`STEP ${step + 1} / ${TOTAL_STEPS}`}</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-[3px] bg-[var(--color-line)]">
            <div
              className="h-full bg-[var(--color-forest)] transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${pct}%` }}
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
            <h2 className="mb-2 font-serif text-xl font-semibold tracking-[-0.01em] text-[var(--color-text-strong)] md:text-2xl">
              {current.question}
            </h2>
            <p className="mb-8 text-sm text-[var(--color-text-muted)]">{current.hint}</p>

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
                    aria-pressed={selected}
                    className={`relative overflow-hidden rounded-[var(--radius-sm)] border px-5 py-4 text-left text-sm transition-[background-color,border-color,color,transform] duration-200 ${
                      selected
                        ? // 선택 상태(N9) — 보더 2px 효과(ring-inset) + ink-soft 배경 + 좌측 3px 딥그린 바(색맹 대응, 절대배치라 시프트 없음)
                          "border-[var(--color-forest)] bg-[var(--color-ink-soft)] font-semibold text-[var(--color-text-strong)] ring-1 ring-inset ring-[var(--color-forest)]"
                        : "border-[var(--color-line)] bg-[var(--color-ink-card)] font-medium text-[var(--color-text-body)] hover:border-[var(--color-text-muted)] motion-safe:hover:-translate-y-px"
                    }`}
                  >
                    {selected && (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-[3px] bg-[var(--color-forest)]"
                      />
                    )}
                    {current.multi ? (
                      <span className="flex items-center justify-between gap-3">
                        {opt}
                        {selected && (
                          <span aria-hidden className="shrink-0 font-semibold text-[var(--color-forest)]">
                            ✓
                          </span>
                        )}
                      </span>
                    ) : (
                      opt
                    )}
                  </button>
                );
              })}
            </div>

            {current.multi && (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={(answers.coverages ?? []).length === 0}
                className="mt-8 w-full rounded-[var(--radius-sm)] bg-[var(--color-forest)] py-3.5 text-sm font-semibold text-[var(--color-ink)] transition-[background-color,transform] duration-300 hover:-translate-y-px hover:bg-[var(--color-forest-soft)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:translate-y-0"
              >
                다음 단계로
              </button>
            )}

            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="mt-4 w-full text-center text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-body)]"
              >
                ← 이전 질문으로
              </button>
            )}
          </motion.div>
        )}

        {/* 결과 — 게이트 없이 즉시 공개: 점수+근거(딥그린) → 목업(크림) → 카톡 CTA(딥그린) */}
        {step === TOTAL_STEPS && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="mb-8 overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-forest)] p-8 md:p-10">
              {/* 점수 */}
              <div className="text-center">
                <span aria-hidden className="mx-auto mb-4 block h-px w-6 bg-[var(--color-gold)]" />
                <p className="text-xs font-semibold tracking-[0.08em] text-[var(--color-ink)]/70">
                  나의 자산 방어력
                </p>
                <motion.p
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.3, type: "spring", stiffness: 120 }}
                  className="mt-3 font-serif text-6xl font-semibold tabular-nums text-[var(--color-ink)]"
                >
                  {score}
                  <span className="text-2xl">점</span>
                </motion.p>
                <p className="mt-2 text-xs text-[var(--color-ink)]/60">설문 기반 추정입니다.</p>
              </div>

              {/* ⭐ 점수 근거 공개 (N7) — 항목별 상태 서술 (점수 숫자는 노출 안 함) */}
              <div className="mt-7 border-t border-[var(--color-ink)]/15 pt-7 text-left">
                <span aria-hidden className="mb-5 block h-px w-6 bg-[var(--color-gold)]" />
                <dl className="space-y-2.5">
                  {result.breakdown.map((item) => (
                    <div key={item.key} className="flex gap-4 text-sm leading-relaxed">
                      <dt className="w-[4.5rem] shrink-0 text-[var(--color-ink)]/60">{item.label}</dt>
                      <dd className="tabular-nums text-[var(--color-ink)]/85">{item.value}</dd>
                    </div>
                  ))}
                </dl>

                {/* 종합 서술 — 응답 조합 조건 분기 (추정 표현만, 단정·해지 뉘앙스 금지) */}
                <p className="mt-6 text-sm leading-relaxed text-[var(--color-ink)]/90">
                  {result.narrative}
                </p>
                <p className="mt-4 text-[13px] leading-relaxed text-[var(--color-ink)]/60">
                  다만 이건 설문 기반 추정입니다. 실제로는 본인도 모르는 계약이 섞여 있는 경우가
                  대부분입니다.
                </p>
              </div>
            </div>

            {/* 담보 합산 목업 + 잔여 공백 경고 — 크림 배경. 응답별 도입 문장으로 논리 연결(N8) */}
            <div className="mb-8">
              <CoverageMockup contractAnswer={answers.contracts as ContractAnswer | undefined} />
            </div>

            {/* 해결 — 정밀분석 다리 + 주 CTA(카카오톡, 화면당 주 CTA 1개). 별도 딥그린 밴드 */}
            <div className="mb-8 overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-forest)] p-8 md:p-10">
              <div className="text-center">
                <span aria-hidden className="mx-auto mb-4 block h-px w-6 bg-[var(--color-gold)]" />
                <p className="mx-auto max-w-md font-serif text-lg font-semibold leading-snug text-[var(--color-ink)] md:text-xl">
                  전 계약을 조회해, 담보 단위로 봐드립니다
                </p>
                <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--color-ink)]/85">
                  위와 같은 표는 상담에서 실제 계약을 조회해야 나옵니다. 중복·과설계·보장 공백을
                  담보 단위로 정밀 분석해 드립니다.
                </p>
                <p className="mt-2 text-xs text-[var(--color-ink)]/60">
                  {years}년 경험을 담아 직접 개발한 분석 시스템으로 진행합니다.
                </p>
                <a
                  href={BRAND.social.kakao}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => gaEvent("kakao_cta_click", { position: "diagnosis_result" })}
                  className="mt-6 inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-7 py-3.5 text-sm font-semibold text-[var(--color-forest)] transition-transform duration-300 hover:-translate-y-px"
                >
                  카카오톡으로 상담 신청하기
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 인증 3종 딥그린 밴드 (N9) — 질문 화면 전용(결과 화면은 CTA 딥그린으로 끝나 연속 금지).
          w-screen 풀블리드 — 가로 스크롤은 page의 overflow-x-clip이 차단 */}
      {step < TOTAL_STEPS && (
        <section
          aria-label="인증 실적"
          className="relative left-1/2 mt-16 w-screen -translate-x-1/2 bg-[var(--color-forest)] py-10 md:py-12"
        >
          <div className="mx-auto grid max-w-2xl grid-cols-3 divide-x divide-[var(--color-gold)] px-5">
            {TRUST.map(([big, small]) => (
              <div key={small} className="px-3 text-center md:px-6">
                <p className="font-serif text-lg font-semibold tabular-nums text-[var(--color-ink)] md:text-2xl">
                  {big}
                </p>
                <p className="mt-1.5 text-[10px] leading-snug text-[var(--color-ink)]/70 md:text-xs">
                  {small}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
