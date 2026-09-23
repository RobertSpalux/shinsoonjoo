import { requiredNoticesFor } from "@/lib/brand";

/**
 * 게시글 본문 필수 유의문구 — 준법팀 회신(2026-07-21): 사이트 심의와 별건으로
 * 게시글마다 본문에 노출한다. 심의필 유무·mode(publish/submission)와 무관하게 **상시** 렌더한다
 * (MandatoryNotice는 승인 심의필이 없으면 null이라, 유의문구는 이 별개 블록이 담당한다).
 * 문구는 brand.ts requiredNoticesFor() 싱글소스(푸터·osmu와 동일 자구).
 * [2026-09-23] 실손 주제 글은 **3종**이다 — 자기부담금 한 줄이 붙는다(PAMS 반송 요구).
 *   그래서 본문·제목을 받아 판정한다. 안 넘기면 종전대로 2종만 나간다.
 * 스타일은 인접한 비권유 고지 블록과 동일 톤(작은 글씨·저채도) — 새 디자인 없음.
 */
export default function ArticleNotice({
  body,
  title,
}: {
  body?: string | null;
  title?: string | null;
} = {}) {
  // 원고에 이미 박힌 문구는 빼고 낸다 — osmu 와 같은 원칙.
  //   실손 글은 자기부담금 한 줄을 PAMS 접수 원고 자체에 넣으므로, 안 빼면 본문과
  //   이 블록에 두 번 보인다.
  const notices = requiredNoticesFor(body, title).filter(
    (n) => !String(body ?? "").includes(n)
  );
  if (!notices.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-[var(--color-line)] bg-white px-5 py-4 text-xs leading-relaxed text-[var(--color-text-muted)]">
      {notices.map((notice, i) => (
        <p key={notice} className={i > 0 ? "mt-1.5" : undefined}>
          {notice}
        </p>
      ))}
    </div>
  );
}
