import { REQUIRED_NOTICES } from "@/lib/brand";

/**
 * 게시글 본문 필수 유의문구 2종 — 준법팀 회신(2026-07-21): 사이트 심의와 별건으로
 * 게시글마다 본문에 노출한다. 심의필 유무·mode(publish/submission)와 무관하게 **상시** 렌더한다
 * (MandatoryNotice는 승인 심의필이 없으면 null이라, 유의문구는 이 별개 블록이 담당한다).
 * 문구는 brand.ts REQUIRED_NOTICES 싱글소스(푸터·osmu와 동일 자구).
 * 스타일은 인접한 비권유 고지 블록과 동일 톤(작은 글씨·저채도) — 새 디자인 없음.
 */
export default function ArticleNotice() {
  return (
    <div className="mt-3 rounded-lg border border-[var(--color-line)] bg-white px-5 py-4 text-xs leading-relaxed text-[var(--color-text-muted)]">
      {REQUIRED_NOTICES.map((notice, i) => (
        <p key={notice} className={i > 0 ? "mt-1.5" : undefined}>
          {notice}
        </p>
      ))}
    </div>
  );
}
