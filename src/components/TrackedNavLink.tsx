"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { gaEvent } from "@/lib/ga";

/**
 * 서버 컴포넌트(Footer) 안의 내부 링크에 GA4 이벤트만 붙이는 얇은 껍데기 — next/link 그대로(클라이언트 이동 유지).
 * 🔴 마크업·문구는 넘겨받은 그대로 렌더한다 — 텍스트 노드를 만들지 않는다(골격 심의 원안 불변, CLAUDE.md §6.11-9).
 */
export default function TrackedNavLink({
  event,
  position,
  onClick,
  ...rest
}: ComponentProps<typeof Link> & { event: string; position: string }) {
  return (
    <Link
      {...rest}
      onClick={(e) => {
        gaEvent(event, { position });
        onClick?.(e);
      }}
    />
  );
}
