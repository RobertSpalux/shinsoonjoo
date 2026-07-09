"use client";

import { useState } from "react";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "로그인 실패");
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-ink)] px-6 pt-16">
      <form
        onSubmit={login}
        className="w-full max-w-sm rounded-2xl border border-[var(--color-line)] bg-[var(--color-ink-card)] p-8"
      >
        <h1 className="mb-1 text-lg font-bold text-slate-900">관리자 로그인</h1>
        <p className="mb-6 text-xs text-slate-500">신순주의 선한 금융 · 운영 콘솔</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="관리자 비밀번호"
          autoFocus
          className="mb-4 w-full rounded-xl border border-[var(--color-line)] bg-white px-4 py-3.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[var(--color-gold)]"
        />
        {error && <p className="mb-4 text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full rounded-full bg-[var(--color-gold)] py-3.5 text-sm font-bold text-white transition-all hover:bg-[var(--color-gold-light)] disabled:opacity-40"
        >
          {loading ? "확인 중..." : "로그인"}
        </button>
      </form>
    </main>
  );
}
