import { checkBannedTerms, type CheckableArticle } from "./compliance/banned-terms";
import { scanPlainStyle, formatStyleViolations } from "./style-gate";
import { scanEvidence, summarizeEvidence } from "./evidence-gate";

/**
 * 로컬 초안 게이트 — route.ts(factory/generate) 의 생성 게이트 3종(CLAUDE.md §8)을 초안 파일에 그대로 건다.
 * 호출: scripts/check_draft.mts (DB·텔레그램·배포 사이트를 부르지 않는다).
 *
 * 판정: 금지어 A 등급 = 차단(route.ts 와 동일). 문체·근거는 route.ts 에선 needs_human_review 플래그지만
 *       여기선 결재방에 올리기 전 단계라 막는다 — 근거 violation 은 심의 제출 전 반드시 해소(§8).
 */
export function judgeDraft(
  meta: CheckableArticle & { slug?: string },
  naver: string,
  main: string | null = null,
  year?: number
) {
  const a = { ...meta, naver_blog_content: naver, main_website_markdown: main };
  const banned = checkBannedTerms(a);
  const style = scanPlainStyle(a);
  const evidence = scanEvidence(a, year);
  const evViolations = evidence.filter((i) => i.level === "violation");
  return {
    slug: meta.slug ?? null,
    pass: banned.level !== "block" && !style.length && !evViolations.length,
    banned: { level: banned.level, findings: banned.findings.map((f) => `${f.grade} ${f.field} 「${f.term}」 ${f.guidance}`) },
    style: { pass: style.length === 0, summary: formatStyleViolations(style) || "정상" },
    evidence: { pass: evViolations.length === 0, summary: summarizeEvidence(evidence) || "정상", issues: evidence },
  };
}
