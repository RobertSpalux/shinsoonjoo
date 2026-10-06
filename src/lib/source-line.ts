import sources from "../../configs/sources.json";
import { PROFILE_PHONE, profileForReview, type ReviewInfo } from "./brand";

type SourceEntry = {
  source_url?: string;
  review_source_line?: string;
  org?: string;
  title?: string;
  published?: string;
};

/**
 * 글 화면 「원문 출처」 줄의 심의 지정 자구 — configs/sources.json `review_source_line`.
 * - 수동 값(`review_source_line`)이 있으면 그것이 우선, 없으면 `{org}_{title}_{published}.` 기본 형식(title 은 원문 제목 그대로).
 * - 새 심의 글(profileForReview 와 같은 기준: 승인일이 PROFILE_CUTOFF 이후 또는 미승인)만 해당.
 * - 승인본은 undefined → 호출부가 원안 그대로 렌더한다.
 * - sources.json 에 없는 출처(또는 org·title·published 가 빈 항목)는 undefined.
 */
export function reviewSourceLine(
  sourceUrl: string | null | undefined,
  review?: ReviewInfo | null,
): string | undefined {
  if (!sourceUrl) return undefined;
  if (profileForReview(review).phone !== PROFILE_PHONE) return undefined;
  const hit = (sources.sources as SourceEntry[]).find((s) => s.source_url === sourceUrl);
  if (!hit) return undefined;
  if (hit.review_source_line) return hit.review_source_line;
  if (hit.org && hit.title && hit.published) return `${hit.org}_${hit.title}_${hit.published}.`;
  return undefined;
}
