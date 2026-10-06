"use client";

import { useEffect } from "react";

/**
 * 새로 심의받는 글의 하단 프로필(푸터) 연락처·우수인증 표기를 글 단위로 바꾼다.
 * 푸터는 루트 레이아웃 소속이라 글 데이터를 모른다 → 마운트 후 data 속성 자리만 치환.
 * 승인된 글은 이 컴포넌트를 렌더하지 않는다(profileForReview 가 원안 값을 돌려줌 → 호출부가 생략).
 */
export default function ProfileSwap({ phone, cert }: { phone: string; cert: string }) {
  useEffect(() => {
    const a = document.querySelector<HTMLAnchorElement>("a[data-profile-phone]");
    if (a) {
      a.href = `tel:${phone}`;
      const span = a.querySelector("span");
      if (span) span.textContent = phone;
    }
    const li = document.querySelector("li[data-profile-cert]");
    if (li) li.textContent = cert;
  }, [phone, cert]);
  return null;
}
