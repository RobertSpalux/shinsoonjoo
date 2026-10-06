import sources from "../../configs/sources.json";
import { PROFILE_PHONE, profileForReview, type ReviewInfo } from "./brand";

type SourceEntry = { source_url?: string; review_source_line?: string };

/**
 * 글 화면 「원문 출처」 줄의 심의 지정 자구 — configs/sources.json `review_source_line`.
 * - 새 심의 글(profileForReview 와 같은 기준: 승인일이 PROFILE_CUTOFF 이후 또는 미승인)만 해당.
 * - 승인본은 undefined → 호출부가 원안 그대로 렌더한다.
 * - 값이 없는 출처도 undefined(지금처럼 둔다).
 */
export function reviewSourceLine(
  sourceUrl: string | null | undefined,
  review?: ReviewInfo | null,
): string | undefined {
  if (!sourceUrl) return undefined;
  if (profileForReview(review).phone !== PROFILE_PHONE) return undefined;
  const hit = (sources.sources as SourceEntry[]).find((s) => s.source_url === sourceUrl);
  return hit?.review_source_line || undefined;
}
