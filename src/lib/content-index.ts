/**
 * 주간 유입 지수(IX1) — content_index_weekly(sql/009) 행을 글 × 주차 표로 접는 순수 함수.
 * 측정·판정은 scripts/content_index_weekly.py 가 한다. 여기서는 표시만.
 */

export interface IndexRow {
  week_start: string;
  slug: string;
  keyword: string | null;
  keyword_source: "main_keyword" | "auto" | null;
  naver_blog_rank: number | null;
  /** null = 이 주 네이버 미측정(본진 전용 글·조회 실패). 순위 null 과 구분한다(그건 30위 밖). */
  naver_blog_n: number | null;
  naver_post_matched: boolean | null;
  naver_integ_blog: boolean | null;
  naver_integ_main: boolean | null;
  gsc_impressions: number | null;
  gsc_clicks: number | null;
  gsc_position: number | null;
  gsc_top_queries: { query: string; impressions: number; clicks: number; position: number }[] | null;
  ga_sessions: number | null;
  conv_events: Record<string, number> | null;
  verdicts: string[] | null;
  errors: Record<string, string> | null;
}

export interface IndexLine {
  slug: string;
  latest: IndexRow;
  /** weeks 순서(최신 → 과거)와 같은 길이. 그 주 행이 없으면 null. */
  cells: (IndexRow | null)[];
}

export const VERDICT_ORDER = ["갱신 대상", "보강 대상", "제목·설명 개선 대상"] as const;

/** 순위 변화 — 숫자가 작을수록 좋다. 측정 실패·미측정 주는 비교하지 않는다. */
export function rankArrow(cur: number | null | undefined, prev: number | null | undefined): string {
  if (cur == null && prev == null) return "";
  if (prev == null) return "";
  if (cur == null) return "▼밖";
  if (cur < prev) return `▲${prev - cur}`;
  if (cur > prev) return `▼${cur - prev}`;
  return "＝";
}

export function convTotal(r: IndexRow | null): number {
  return Object.values(r?.conv_events ?? {}).reduce((a, b) => a + (b || 0), 0);
}

/** 행 → (주차 목록 최신순, 글별 줄). 줄 순서 = 판정 있는 글 먼저(갱신 → 보강 → 제목), 그다음 블로그탭 순위. */
export function pivot(rows: IndexRow[], maxWeeks = 8): { weeks: string[]; lines: IndexLine[] } {
  const weeks = [...new Set(rows.map((r) => r.week_start))].sort().reverse().slice(0, maxWeeks);
  const bySlug = new Map<string, Map<string, IndexRow>>();
  for (const r of rows) {
    if (!weeks.includes(r.week_start)) continue;
    const m = bySlug.get(r.slug) ?? new Map<string, IndexRow>();
    m.set(r.week_start, r);
    bySlug.set(r.slug, m);
  }
  const lines: IndexLine[] = [];
  for (const [slug, m] of bySlug) {
    const cells = weeks.map((w) => m.get(w) ?? null);
    const latest = cells.find((c) => c !== null)!;
    lines.push({ slug, latest, cells });
  }
  const vRank = (l: IndexLine) => {
    const v = l.cells[0]?.verdicts ?? [];
    const i = VERDICT_ORDER.findIndex((x) => v.includes(x));
    return i < 0 ? VERDICT_ORDER.length : i;
  };
  lines.sort((a, b) => vRank(a) - vRank(b) || (a.latest.naver_blog_rank ?? 99) - (b.latest.naver_blog_rank ?? 99));
  return { weeks, lines };
}
