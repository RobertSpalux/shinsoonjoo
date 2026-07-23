/**
 * 문체 검증 게이트 — 전 채널 경어체 통일(2026-07-23 확정, CLAUDE.md·factory-prompt 17행).
 *
 * 배경: 공통 프롬프트가 "전 채널 경어체"를 지시하지만 지시만으로는 새어나간다
 *       (상록수 본진이 평서체로 나오던 사고). 지시가 아니라 '검사'로 막는다. 뉴스·상록수 공통.
 *
 * 방식: 생성물의 종결어미를 문장 단위로 판정해 평서체(한다체·해라체) 비율을 낸다.
 *       - 경어체: ~습니다/~입니다/~합니다/~십니다/~됩니다/…(ㅂ받침+니다·습니다) · ~요 계열 · ~니까 · ~세요
 *       - 평서체: ~한다/~이다/~된다/~있다/~없다/~아니다/~것이다/~였다/~했다 · ~더라/~는가 등
 *       - 명사형·기호·영문·숫자로 끝나면 판정 제외(개조식 항목)
 *       표 행(|)·인용(>)·제목(#)·주석 마커·HTML 태그만 있는 줄은 검사에서 제외(오탐 방지).
 *
 * 순수 함수(DB 의존 없음). 생성 경로(route.ts)에서 scanBannedTopics와 같은 자리에 배선한다.
 */

/** 평서체 비율 임계 — 판정 문장 중 이 비율 이상이 평서체면 위반. (조정 가능) */
export const PLAIN_RATIO_THRESHOLD = 0.15;
/** 평서체 문장 절대수 임계 — 이 개수 이상이면 비율과 무관하게 위반(OR 조건). (조정 가능) */
export const PLAIN_COUNT_THRESHOLD = 3;

export interface StyleViolation {
  field: string;
  /** 평서체로 판정된 문장 수 */
  plainCount: number;
  /** 판정된(경어체+평서체) 문장 수 — 명사형·기호 종결은 제외됨 */
  total: number;
  /** plainCount / total (소수 3자리) */
  ratio: number;
  /** 걸린 평서체 문장 최대 3개 */
  samples: string[];
}

/** 검사 대상(느슨한 형태 — DB 행/단계별 부분 결과 모두 수용). */
export interface StyleCheckable {
  main_website_markdown?: string | null;
  naver_blog_content?: string | null;
  blogspot_content?: string | null;
  summary?: string | null;
  key_points?: string[] | null;
  remodeling_bridge?: string | null;
  faq_json?: ({ question?: string; answer?: string } | null)[] | null;
}

/** 한글 음절의 종성이 ㅂ(받침)인가 — 'X니다' 경어체(합/입/됩/십/납…) 판별용. */
function hasBieupBatchim(ch: string): boolean {
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 === 17; // 종성 ㅂ
}

/** '…니다'가 경어체인가 — 'ㅂ받침+니다'(합니다/입니다/됩니다) 또는 '습니다'. (아니다는 제외) */
function endsHonorificNida(s: string): boolean {
  if (!s.endsWith("니다")) return false;
  const pre = s[s.length - 3];
  if (pre === undefined) return false;
  return pre === "습" || hasBieupBatchim(pre);
}

type Verdict = "honorific" | "plain" | "skip";

/** 한 문장의 끝 종결어미를 경어체/평서체/판정제외로 분류. */
function classifyEnding(sentence: string): Verdict {
  // 종결부 정리: 뒤쪽 공백·문장부호·따옴표·강조기호(*_ ~ >) 제거
  const s = sentence.replace(/[\s.!?…"'”’)\]】」』*_>~]+$/u, "");
  if (!s) return "skip";

  // ── 경어체(존댓말) ──
  if (s.endsWith("요")) return "honorific"; // ~요 계열은 전부 존댓말(평서체는 요를 쓰지 않는다)
  if (endsHonorificNida(s)) return "honorific"; // ~ㅂ니다/습니다
  if (/(니까|세요|십시오|십시다|시다)$/.test(s)) return "honorific";

  // ── 평서체(한다체·해라체) ──
  // 'ㅂ니다'가 아닌 '다' 종결 = 평서체(한다/이다/된다/있다/없다/아니다/것이다/였다/했다 …)
  if (s.endsWith("다")) return "plain";
  if (/(더라|더군|던가|는가|은가|느냐|더냐)$/.test(s)) return "plain";

  // ── 판정 제외: 명사형·기호·영문·숫자 종결(개조식 항목) ──
  return "skip";
}

const COMMENT_RE = /<!--[\s\S]*?-->/g;

/** 검사에서 제외할 줄이면 null, 남길 줄이면 정제된 텍스트(HTML 태그·주석 제거)를 반환. */
function retainLine(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.startsWith("|")) return null; // 표 행
  if (t.startsWith(">")) return null; // 인용 블록
  if (t.startsWith("#")) return null; // 마크다운 제목
  const noComment = t.replace(COMMENT_RE, "").trim();
  if (!noComment) return null; // 주석/마커(<!--CTA-->, <!-- advice -->)만 있는 줄
  const stripped = noComment.replace(/<[^>]+>/g, "").trim();
  if (!stripped) return null; // HTML 태그만 있는 줄(<ul>, </h2> 등)
  return stripped;
}

/** 정제된 텍스트를 종결부호·줄바꿈 기준으로 문장 단위 분리. (소수점 '3.1%'는 뒤 공백이 없어 안 쪼개짐) */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface FieldJudge {
  plainCount: number;
  total: number;
  samples: string[];
}

function judgeField(text: string): FieldJudge {
  const retained = text
    .split(/\r?\n/)
    .map(retainLine)
    .filter((l): l is string => l !== null);
  const sentences = splitSentences(retained.join("\n"));

  let plainCount = 0;
  let total = 0;
  const samples: string[] = [];
  for (const sen of sentences) {
    const v = classifyEnding(sen);
    if (v === "skip") continue;
    total++;
    if (v === "plain") {
      plainCount++;
      if (samples.length < 3) samples.push(sen.length > 60 ? sen.slice(0, 57) + "…" : sen);
    }
  }
  return { plainCount, total, samples };
}

/** 검사 대상 필드를 (field, text)로 펼친다. faq_json은 답변(answer)만 본다. */
function styleFields(a: StyleCheckable): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  const push = (field: string, text: string | null | undefined) => {
    if (text && String(text).trim()) out.push({ field, text: String(text) });
  };
  push("main_website_markdown", a.main_website_markdown);
  push("naver_blog_content", a.naver_blog_content);
  push("blogspot_content", a.blogspot_content);
  push("summary", a.summary);
  push("remodeling_bridge", a.remodeling_bridge);
  if (Array.isArray(a.key_points)) push("key_points", a.key_points.join("\n"));
  if (Array.isArray(a.faq_json)) push("faq_json", a.faq_json.map((f) => f?.answer ?? "").join("\n"));
  return out;
}

/**
 * 문체 검사 — 필드별로 독립 판정. 평서체 비율이 임계를 넘는 필드만 반환한다.
 * @returns 위반 필드 목록(위반 없으면 빈 배열).
 */
export function scanPlainStyle(a: StyleCheckable): StyleViolation[] {
  const out: StyleViolation[] = [];
  for (const { field, text } of styleFields(a)) {
    const { plainCount, total, samples } = judgeField(text);
    if (total === 0) continue; // 판정할 문장이 없음(전부 개조식/기호)
    const ratio = plainCount / total;
    if (ratio >= PLAIN_RATIO_THRESHOLD || plainCount >= PLAIN_COUNT_THRESHOLD) {
      out.push({ field, plainCount, total, ratio: Number(ratio.toFixed(3)), samples });
    }
  }
  return out;
}

/** 관측 라인용 1줄 요약 — "field 27%(샘플…)" 형태. 위반 없으면 빈 문자열. */
export function formatStyleViolations(vs: StyleViolation[]): string {
  if (!vs.length) return "";
  return vs
    .map((v) => `${v.field} ${Math.round(v.ratio * 100)}%(${v.plainCount}/${v.total})`)
    .join(" · ");
}
