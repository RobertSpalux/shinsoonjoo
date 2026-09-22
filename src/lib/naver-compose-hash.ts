import { createHash } from "node:crypto";

/**
 * 네이버 조립 재료 해시 — **osmu-format 이 소비하는 것만** 담는다.
 *
 * 쓰임: `/api/admin/compose` 가 조립할 때 이 값을 `premium_articles.naver_composed_hash` 에
 * 남기고, `scripts/preflight.py` 가 지금 원고로 다시 계산해 대조한다.
 * 같으면 "마지막 복사가 osmu 조립을 거쳤고 그 뒤로 원고가 안 바뀌었다"가 증명된다.
 *
 * 🔴 시각(naver_composed_at) 비교로는 대신할 수 없다.
 *   trg_premium_articles_updated 가 **모든 UPDATE 에서** updated_at 을 now() 로 바꾼다.
 *   조립 기록을 쓰는 그 UPDATE 도 updated_at 을 같이 올리므로 두 값이 마이크로초 차이로 붙는다.
 *   해시는 시계에 기대지 않는다.
 *
 * 🔴 규칙을 바꾸면 preflight 의 `naver_compose_hash()` 도 **같이** 바꿔야 한다.
 *   두 벌이 갈리면 멀쩡한 원고가 영구 실패로 남는다. 아래 정규화가 계약이다:
 *     · 필드 순서 고정 · 값이 없으면 빈 문자열 · tags 는 원래 순서 그대로 "" 로 이음
 *     · 필드 구분자 "" · 개행은 \n 으로 통일 · 끝 공백 제거
 */
export interface NaverComposeSource {
  naver_blog_content?: string | null;
  title?: string | null;
  naver_title?: string | null;
  slug?: string | null;
  tags?: string[] | null;
}

const UNIT = "";
const REC = "";

/** 해시에 들어갈 정규화 문자열 — 언어가 달라도 같은 바이트가 나와야 한다. */
export function naverComposeCanonical(a: NaverComposeSource): string {
  const norm = (s: unknown) =>
    String(s ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
  return [
    norm(a.naver_blog_content),
    norm(a.title),
    norm(a.naver_title),
    norm(a.slug),
    (a.tags ?? []).map((t) => norm(t)).join(UNIT),
  ].join(REC);
}

export function naverComposeHash(a: NaverComposeSource): string {
  return createHash("sha256").update(naverComposeCanonical(a), "utf8").digest("hex");
}
