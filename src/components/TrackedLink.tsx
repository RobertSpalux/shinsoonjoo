"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { gaEvent } from "@/lib/ga";

/**
 * 서버 컴포넌트(Footer 등) 안의 외부 링크에 GA4 이벤트만 붙이는 얇은 껍데기.
 * 🔴 마크업·문구는 넘겨받은 그대로 렌더한다 — 텍스트 노드를 만들지 않는다(골격 심의 원안 불변, CLAUDE.md §6.11-9).
 * 이벤트에는 지금 보고 있는 경로를 함께 남긴다 — 어느 글·페이지에서 카카오 채널로 갔는지 잴 수 있게.
 */
export default function TrackedLink({
  event,
  position,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { event: string; position: string; children: ReactNode }) {
  return (
    <a
      {...rest}
      onClick={(e) => {
        gaEvent(event, { position, page: typeof window === "undefined" ? "" : window.location.pathname });
        rest.onClick?.(e);
      }}
    >
      {children}
    </a>
  );
}
