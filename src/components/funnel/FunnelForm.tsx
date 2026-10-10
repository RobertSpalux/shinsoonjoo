"use client";

import { useState } from "react";
import { AGE_BANDS, INTERESTS, MESSAGE_MAX, FUNNEL_CONSENT_VERSION, type Interest } from "@/lib/funnel/lead";
import { FUNNEL_CONSENT } from "@/lib/funnel/consent";
import { FUNNEL_COPY } from "@/lib/funnel/copy";
import { gaEvent } from "@/lib/ga";

type FormState = "idle" | "submitting" | "success" | "error";

function utm(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

export default function FunnelForm() {
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [message, setMessage] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [website, setWebsite] = useState(""); // 허니팟

  const isValid = name.trim() && phone.trim() && ageBand && interests.length > 0 && agreed;

  function toggle(i: Interest) {
    setInterests((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || state === "submitting") return;
    setState("submitting");
    setError("");

    const res = await fetch("/api/funnel/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        phone: phone.trim(),
        age_band: ageBand,
        interests,
        message: message.trim() || null,
        privacy_collect_agreed: agreed,
        consent_version: FUNNEL_CONSENT_VERSION,
        website,
        utm_source: utm("utm_source"),
        utm_medium: utm("utm_medium"),
        utm_campaign: utm("utm_campaign"),
        utm_content: utm("utm_content"),
        landing_path: window.location.pathname,
      }),
    }).catch(() => null);

    if (!res?.ok) {
      const j = await res?.json().catch(() => null);
      setError(j?.error ?? "전송에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      setState("error");
      return;
    }
    setState("success");
    // 전환 이벤트 — 개인정보는 싣지 않는다
    gaEvent("lead_created", { form: "funnel_v1", source: utm("utm_source") ?? "direct" });
  }

  if (state === "success") {
    return (
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-card)] p-8 text-center md:p-10">
        <p className="font-serif text-xl font-semibold text-[var(--color-forest)]">{FUNNEL_COPY.success}</p>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-sm border border-[var(--color-line)] bg-white px-4 py-3.5 text-sm text-[var(--color-text-strong)] transition-colors placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-gold-dim)]";
  const labelClass = "mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-card)] p-8 shadow-[var(--shadow-card)] md:p-10"
    >
      <h2 className="font-serif text-2xl font-semibold text-[var(--color-forest)]">{FUNNEL_COPY.formTitle}</h2>
      <p className="mt-2 mb-8 text-sm leading-relaxed text-[var(--color-text-body)]">{FUNNEL_COPY.formNote}</p>

      {/* 허니팟 — 화면·보조기기 모두에서 숨김 */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="fl-website">website</label>
        <input id="fl-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      <div className="mb-5">
        <label htmlFor="fl-name" className={labelClass}>이름 *</label>
        <input id="fl-name" required maxLength={30} value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" className={inputClass} />
      </div>

      <div className="mb-5">
        <label htmlFor="fl-phone" className={labelClass}>휴대전화 *</label>
        <input id="fl-phone" type="tel" inputMode="numeric" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" className={inputClass} />
      </div>

      <div className="mb-5">
        <label htmlFor="fl-age" className={labelClass}>연령대 *</label>
        <select id="fl-age" required value={ageBand} onChange={(e) => setAgeBand(e.target.value)} className={`${inputClass} appearance-none`}>
          <option value="" disabled>선택해 주세요</option>
          {AGE_BANDS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      <fieldset className="mb-5">
        <legend className={labelClass}>관심 분야 * (여러 개 선택 가능)</legend>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((i) => {
            const on = interests.includes(i);
            return (
              <button
                key={i}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(i)}
                className={`rounded-sm border px-3 py-2 text-xs transition-colors ${
                  on
                    ? "border-[var(--color-forest)] bg-[var(--color-forest)] text-[var(--color-ink)]"
                    : "border-[var(--color-line)] bg-white text-[var(--color-text-body)]"
                }`}
              >
                {i}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mb-6">
        <label htmlFor="fl-message" className={labelClass}>남기실 말씀 (선택)</label>
        <textarea
          id="fl-message"
          rows={3}
          maxLength={MESSAGE_MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="연락 가능한 시간대 등을 적어 주세요. 병력 등 건강정보는 적지 마세요."
          className={`${inputClass} resize-none`}
        />
      </div>

      <div className="mb-6">
        <p className="mb-1.5 text-xs font-semibold text-[var(--color-text-body)]">{FUNNEL_CONSENT.title}</p>
        <div className="max-h-40 overflow-y-auto rounded-sm border border-[var(--color-line)] bg-white p-3">
          <p className="whitespace-pre-line text-[11px] leading-relaxed text-[var(--color-text-muted)]">{FUNNEL_CONSENT.body}</p>
        </div>
        <label className="mt-2 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-[var(--color-line)] accent-[var(--color-gold)]"
          />
          <span className="text-xs font-semibold leading-relaxed text-[var(--color-text-body)]">{FUNNEL_CONSENT.label}</span>
        </label>
      </div>

      {state === "error" && <p className="mb-4 text-sm text-red-700" role="alert">{error}</p>}

      <button
        type="submit"
        disabled={!isValid || state === "submitting"}
        className="w-full rounded-sm bg-[var(--color-forest)] py-4 text-sm font-semibold text-[var(--color-ink)] transition-colors duration-300 hover:bg-[var(--color-forest-soft)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state === "submitting" ? "전송 중..." : FUNNEL_COPY.submit}
      </button>
    </form>
  );
}
