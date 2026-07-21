/**
 * 금지 표현 게이트 (CLAUDE.md §6.10) — 심의 신청 전 검사.
 *
 * ⚠️ 검사 시점: 심의 신청 전([심의용 복사]·[웹 심의용 미리보기]을 막는다).
 *    심의 통과 후에는 원안 수정이 불가하므로(§6.9) 발행 시점에 잡으면 못 고친다.
 *    발행 게이트(trg_publish_gate = 심의필 유무)와 역할이 겹치지 않는다.
 *
 * 3등급:
 *   A(block) — 정당한 용례가 없는 과장어/패턴. 1건이라도 있으면 게이트 차단.
 *   B(warn)  — 문맥 의존. 검수자가 항목별로 [확인함]을 체크해야 통과(compliance_acks).
 *   C(pattern) — 정규식. 각 항목의 등급은 A 또는 B로 귀속.
 *
 * 순수 함수(DB 의존 없음). 서버(admin/page·preview·compose API)에서 실행한다.
 */

export type Grade = "A" | "B";

export interface Finding {
  field: string;
  term: string; // 실제 매치된 문자열
  grade: Grade;
  offset: number; // 해당 필드 평문 내 위치
  length: number;
  reason: string; // §6.10의 어느 조항인지
  guidance: string; // 대체 표현 제안
  acked?: boolean; // B등급 확인 여부(acks 대조 결과)
  context?: string; // 적발 구간 ±40자 발췌(관리 모달 하이라이트용)
  contextOffset?: number; // context 내 매치 시작 위치
}

export interface ComplianceAck {
  field: string;
  term: string;
  offset: number;
  ackedAt: string;
}

export interface CheckResult {
  level: "block" | "warn" | "clean";
  findings: Finding[];
}

/** 검사 대상 아티클(느슨한 형태 — DB 행/관리 카드 모두 수용) */
export interface CheckableArticle {
  title?: string | null;
  naver_title?: string | null;
  blogspot_title?: string | null;
  summary?: string | null;
  instagram_caption?: string | null;
  main_website_markdown?: string | null;
  naver_blog_content?: string | null;
  blogspot_content?: string | null;
  key_points?: string[] | null;
  faq_json?: { question?: string; answer?: string }[] | null;
  threads_json?: { body?: string; replies?: string[] }[] | null;
  verify_claims?: { claim?: string; basis?: string; confidence?: string }[] | null;
}

const RULE = {
  hype: "§6.10 금지 단어(과장·최상급)",
  urgency: "§6.10 다급함 유발 금지",
  slander: "§6.10 비방 프레이밍 금지(보험사·설계사·영업채널)",
  adverse: "§6.10 역선택 조장 금지(보험료 대 보험금 손익 비교)",
  taxFree: "§6.10 비과세 표기 — '관련 세법 요건 충족시' 병기 필수",
  insurer: "§6.10 보험회사명·상품명 노출 금지",
  stat: "§6.10 통계치 — 증빙(원출처) 없으면 사용 불가",
  titleMoney: "§6.10 제목·대표이미지 금액/화폐기호 노출 금지",
  realCase: "§6.10 실제 사례('O원 보상 받았습니다') 금지 — 가정형만 허용",
  waiver: "§6.10 납입면제 사례 언급 금지(2025-10~)",
} as const;

/** A등급 단어 — 정당한 용례가 거의 없는 과장어. 필요한 경우만 오탐 방지 lookahead. */
const A_TERMS: { term: string; re: RegExp; guidance: string }[] = [
  { term: "무료", re: /무료(?!함)/g, guidance: "'무료' 삭제 — 예: '보험 리모델링 진단'" },
  { term: "끝판왕", re: /끝판왕/g, guidance: "과장 삭제 — 사실 서술로" },
  { term: "제1위", re: /제1위/g, guidance: "순위 표현 삭제(증빙 불가 최상급)" },
  { term: "무려", re: /무려/g, guidance: "'무려' 삭제 — 수치는 담담히" },
  { term: "획기적인", re: /획기적인/g, guidance: "'획기적인' 삭제" },
  { term: "고액보장", re: /고액보장/g, guidance: "구체 담보·금액으로 대체(과장어 회피)" },
  { term: "엄청난", re: /엄청난/g, guidance: "'엄청난' 삭제" },
  { term: "어마어마한", re: /어마어마한/g, guidance: "'어마어마한' 삭제" },
  { term: "역대급", re: /역대급/g, guidance: "'역대급' 삭제" },
  { term: "대박", re: /대박/g, guidance: "'대박' 삭제" },
  { term: "초가성비", re: /초가성비/g, guidance: "'초가성비' 삭제" },
  { term: "천문학적", re: /천문학적/g, guidance: "'천문학적' 삭제 — 구체 수치로" },
  { term: "100점", re: /100\s*점/g, guidance: "'100점' 삭제(과장)" },
  { term: "눈속임", re: /눈속임/g, guidance: "'눈속임' 삭제(비방 뉘앙스)" },
  { term: "보험료 폭탄", re: /보험료\s*폭탄/g, guidance: "'보험료 폭탄' 삭제 — 자극어" },
  { term: "간병살인", re: /간병\s*살인/g, guidance: "'간병살인' 삭제 — 자극어" },
  { term: "의료쇼핑", re: /의료\s*쇼핑/g, guidance: "'의료쇼핑' 삭제 — 자극어" },
  { term: "빵빵하게", re: /빵빵하게/g, guidance: "'빵빵하게' 삭제 — 구어 과장" },
  // 신규(썸네일·제목 금지표현, 260521) — 정당 용례 없는 과장·자극·이득조장
  { term: "어마무시한", re: /어마무시한/g, guidance: "'어마무시한' 삭제(과장)" },
  { term: "왕창", re: /왕창/g, guidance: "'왕창' 삭제(구어 과장)" },
  { term: "전설의 보험", re: /전설의\s*보험/g, guidance: "'전설의 보험' 삭제(과장)" },
  { term: "N대천왕", re: /\d\s*대\s*천왕/g, guidance: "'N대천왕' 삭제(과장)" },
  { term: "문의 폭주", re: /문의\s*폭주/g, guidance: "'문의 폭주' 삭제(과장)" },
  { term: "줄서서 가입", re: /줄\s*서서\s*가입/g, guidance: "'줄서서 가입' 삭제(과장)" },
  { term: "거지", re: /거지\s*(되기|됩니다|안\s*?되려)/g, guidance: "'거지되기/안되려면' 삭제(자극)" },
  { term: "패가망신", re: /패가망신/g, guidance: "'패가망신' 삭제(자극)" },
  { term: "호구", re: /호구(?!조사)/g, guidance: "'호구' 삭제(자극)" },
  { term: "쪽박", re: /쪽박/g, guidance: "'쪽박' 삭제(자극)" },
  { term: "미친 듯이", re: /미친\s*듯이/g, guidance: "'미친 듯이' 삭제(자극)" },
  { term: "목숨 걸지 마", re: /목숨\s*걸지\s*마/g, guidance: "'목숨 걸지 마세요' 삭제(자극)" },
  { term: "막차", re: /막차\s*타/g, guidance: "'막차타세요' 삭제(다급함·자극)" },
  { term: "간병파산", re: /간병\s*파산/g, guidance: "'간병파산' → '간병 비용 부담' 등 중립 표현" },
  { term: "간병지옥", re: /간병\s*지옥/g, guidance: "'간병지옥' → 중립 표현" },
  { term: "부자되는 보험", re: /부자\s*되는\s*보험/g, guidance: "'부자되는 보험' 삭제(이득 조장)" },
  { term: "돈 벌어다주는 보험", re: /돈\s*벌어다\s*주는\s*보험/g, guidance: "'돈 벌어다주는 보험' 삭제(이득 조장)" },
  { term: "보험을 보물/황금/로또 비유", re: /(보험[은는을를]\s*(보물|황금|로또)|(보물|황금|로또)\s*같은\s*보험)/g, guidance: "보험을 보물·황금·로또에 비유 금지(이득 조장)" },
];

/** B등급 단어 — 문맥 의존. 오탐 제외 lookahead를 함께 둔다. */
const B_TERMS: { term: string; re: RegExp; guidance: string }[] = [
  // 최고령 제외
  { term: "최고", re: /최고(?!령)/g, guidance: "최상급 여부 확인 — 증빙 없으면 삭제" },
  // 최대한 제외
  { term: "최대", re: /최대(?!한)/g, guidance: "최상급 여부 확인 — '최대 보장' 등은 삭제/완화" },
  { term: "단점", re: /단점/g, guidance: "비교·비방 뉘앙스 확인" },
  { term: "함정", re: /함정/g, guidance: "비방 뉘앙스 확인 — 중립 표현으로" },
  { term: "허점", re: /허점/g, guidance: "비방 뉘앙스 확인" },
  // '치명적 질병'(담보명) 제외
  { term: "치명", re: /치명(?!적\s*질병)/g, guidance: "'치명적' 과장 확인 — 담보명이면 그대로 두고 확인" },
  // '무조건 ~ 아니/아닙(부정문)' 제외 — '아닙니다'는 '아닙'이라 두 형태 모두 본다
  { term: "무조건", re: /무조건(?![^.\n]{0,20}?(아니|아닙))/g, guidance: "단정 표현 확인 — 부정문이면 확인 처리" },
  { term: "다이렉트", re: /다이렉트/g, guidance: "특정 판매채널 지칭 확인" },
  { term: "온라인보험", re: /온라인보험/g, guidance: "특정 판매채널 지칭 확인" },
  // 신규(260521) — 문맥 의존(정당 용례 가능). 동사 '미치다'는 조사 lookbehind로 제외.
  { term: "미친", re: /(?<![을를이가]\s?)미친(?!\s*듯이)/g, guidance: "자극 표현 확인 — '미친 ~'이면 삭제(동사 '미치다'는 제외됨)" },
  { term: "큰일납니다", re: /큰일\s*(납니다|난다|나요)/g, guidance: "다급함·자극 확인 — 중립 표현으로" },
  { term: "돈 날린다", re: /돈[을\s]*날린/g, guidance: "자극 표현 확인 — 중립 표현으로" },
  { term: "난리난", re: /난리\s*난/g, guidance: "자극 표현 확인" },
  { term: "죽을때까지", re: /죽을\s*때까지/g, guidance: "사망 서술이면 '평생/종신'으로 완화 확인" },
  { term: "죽어도", re: /죽어도/g, guidance: "자극 표현 확인 — 사망 서술은 '사망 시' 등으로" },
  { term: "죽기 전까지", re: /죽기\s*전까지/g, guidance: "'죽기 전까지' 완화 확인" },
];

/** [A] 다급함 유발 */
const URGENCY: { term: string; re: RegExp }[] = [
  { term: "지금 바로", re: /지금\s*바로/g },
  { term: "당장", re: /당장(?!\s*(은|필요))/g },
  { term: "늦기 전에", re: /늦기\s*전에/g },
  { term: "한도 축소 전", re: /한도\s*축소\s*전/g },
  { term: "곧 없어진다", re: /곧\s*없어진/g },
  { term: "영상 삭제 전", re: /영상\s*삭제\s*전/g },
];

/** [A] 비방 프레이밍 */
const SLANDER: { term: string; re: RegExp }[] = [
  { term: "설계사는 안 알려주는", re: /설계사(는|가|들이)?\s*안\s*알려주/g },
  { term: "보험사가 싫어하는", re: /보험사(가|들이)?\s*싫어하/g },
  { term: "보험사만 배불리는", re: /보험사(만|는|가)?\s*배불[리려]/g },
  { term: "~하시는 설계사 분들이 많이", re: /설계사\s*분들이?\s*많이/g },
  // 신규(260521) — 보험사 대상 비방 프레임
  { term: "보험사는 안 알려주는", re: /보험사(는|가|들이)?\s*안\s*알려주/g },
  { term: "보험사는 해지를 기다린다", re: /보험사(는|가|들이)?\s*해지[^.\n]{0,6}기다[리린립려렸]/g },
];

/** 국내 생·손보사 상호(부분 목록) — [B] */
const INSURERS = [
  "삼성생명", "한화생명", "교보생명", "신한라이프", "미래에셋생명", "동양생명", "흥국생명",
  "KB라이프", "NH농협생명", "라이나생명", "메트라이프", "AIA생명", "처브라이프", "DB생명",
  "하나생명", "iM라이프", "ABL생명", "푸본현대생명", "KDB생명",
  "삼성화재", "현대해상", "DB손해보험", "KB손해보험", "메리츠화재", "한화손해보험",
  "롯데손해보험", "흥국화재", "MG손해보험", "하나손해보험", "캐롯손해보험", "AXA손해보험",
  "NH농협손해보험", "농협손해보험",
];
// '생명보험/화재보험/손해보험'(일반 명사)은 제외하고 브랜드성 접두 토큰만.
const INSURER_PATTERN =
  /(?<![가-힣])(?!생명보험|화재보험|손해보험)[가-힣A-Za-z]{2,5}(생명|화재|해상)(?!보험)(?![가-힣])/g;

/** 통계치 [B] (→ 증빙 없으면 A 승격) */
const STAT_PATTERNS: RegExp[] = [
  /\d{1,3}\s*%/g,
  /100\s*명\s*중\s*\d+/g,
  /\d+\s*명\s*중\s*\d+/g,
];

/** 제목류 금액/화폐 [A] */
const TITLE_MONEY: { term: string; re: RegExp }[] = [
  { term: "금액(만원)", re: /\d[\d,]*\s*만원/g },
  { term: "금액(억)", re: /\d[\d,]*\s*억/g },
  { term: "금액(원)", re: /\d{3,}\s*원/g },
  { term: "화폐기호", re: /[₩$]/g },
];

const TITLE_FIELDS = new Set(["title", "naver_title", "blogspot_title"]);

/** 아티클을 (field, text, isTitle) 평문 단위로 펼친다. */
function fieldTexts(a: CheckableArticle): { field: string; text: string; isTitle: boolean }[] {
  const out: { field: string; text: string; isTitle: boolean }[] = [];
  const push = (field: string, text: string | null | undefined, isTitle = false) => {
    if (text && String(text).trim()) out.push({ field, text: String(text), isTitle });
  };
  push("title", a.title, true);
  push("naver_title", a.naver_title, true);
  push("blogspot_title", a.blogspot_title, true);
  push("summary", a.summary);
  push("instagram_caption", a.instagram_caption);
  push("main_website_markdown", a.main_website_markdown);
  push("naver_blog_content", a.naver_blog_content);
  push("blogspot_content", a.blogspot_content);
  if (Array.isArray(a.key_points)) push("key_points", a.key_points.join("\n"));
  if (Array.isArray(a.faq_json))
    push("faq_json", a.faq_json.map((f) => `${f.question ?? ""}\n${f.answer ?? ""}`).join("\n\n"));
  if (Array.isArray(a.threads_json))
    push(
      "threads_json",
      a.threads_json.map((t) => [t.body ?? "", ...(t.replies ?? [])].join("\n")).join("\n\n")
    );
  return out;
}

/** verify_claims 전체를 한 문자열로 — 통계 근거 대조용 */
function verifyText(a: CheckableArticle): string {
  return (a.verify_claims ?? [])
    .map((c) => `${c.claim ?? ""} ${c.basis ?? ""}`)
    .join(" ");
}

function runMatches(
  field: string,
  text: string,
  re: RegExp,
  grade: Grade,
  reason: string,
  guidance: string,
  termLabel?: string
): Finding[] {
  const out: Finding[] = [];
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    out.push({
      field,
      term: termLabel ?? m[0],
      grade,
      offset: m.index,
      length: m[0].length,
      reason,
      guidance,
    });
    if (m.index === r.lastIndex) r.lastIndex++; // 빈 매치 방어
  }
  return out;
}

/**
 * §6.10 금지 표현 검사.
 * @param a 아티클 필드
 * @param acks 저장된 B등급 확인 이력 → 매치되는 B findings는 acked=true
 */
export function checkBannedTerms(a: CheckableArticle, acks: ComplianceAck[] = []): CheckResult {
  const findings: Finding[] = [];
  const fields = fieldTexts(a);
  const vtext = verifyText(a);

  for (const { field, text, isTitle } of fields) {
    // A등급 단어
    for (const t of A_TERMS)
      findings.push(...runMatches(field, text, t.re, "A", RULE.hype, t.guidance, t.term));
    // B등급 단어
    for (const t of B_TERMS)
      findings.push(...runMatches(field, text, t.re, "B", RULE.hype, t.guidance, t.term));
    // 다급함 [A]
    for (const t of URGENCY)
      findings.push(
        ...runMatches(field, text, t.re, "A", RULE.urgency, "다급함 유발 문구 삭제", t.term)
      );
    // 비방 [A]
    for (const t of SLANDER)
      findings.push(
        ...runMatches(
          field,
          text,
          t.re,
          "A",
          RULE.slander,
          "비방 프레이밍 삭제 — 각성 근거는 제도 변화·담보 구조에",
          t.term
        )
      );
    // 역선택 [B]
    findings.push(
      ...runMatches(
        field,
        text,
        /(보험료[^.\n]{0,40}보험금|보험금[^.\n]{0,40}보험료)[^.\n]{0,40}(이득|손해|본전)/g,
        "B",
        RULE.adverse,
        "손익 비교로 가입/해지를 유도하지 않기(역선택 조장)",
        "보험료↔보험금 손익 비교"
      )
    );
    // 비과세 [A] — 같은 필드에 '관련 세법 요건 충족시'가 없으면 차단
    if (/비과세/.test(text) && !/관련\s*세법\s*요건\s*충족\s*시/.test(text)) {
      const idx = text.indexOf("비과세");
      findings.push({
        field, term: "비과세", grade: "A", offset: idx, length: 3,
        reason: RULE.taxFree,
        guidance: "'비과세' 옆에 '관련 세법 요건 충족시' 병기(미표기 시 반려)",
      });
    }
    // 보험사명 [B] — 명시 목록 + 패턴
    for (const name of INSURERS) {
      const idx = text.indexOf(name);
      if (idx >= 0)
        findings.push({
          field, term: name, grade: "B", offset: idx, length: name.length,
          reason: RULE.insurer,
          guidance: "A사·B사·C사로 치환(등장 순서를 알파벳순으로)",
        });
    }
    findings.push(
      ...runMatches(field, text, INSURER_PATTERN, "B", RULE.insurer, "A사·B사·C사로 치환(알파벳순)")
    );
    // 통계치 [B→A] — verify_claims에 근거 없으면 승격
    for (const sp of STAT_PATTERNS) {
      const raw = runMatches(field, text, sp, "B", RULE.stat, "", "통계치");
      for (const f of raw) {
        const matched = text.slice(f.offset, f.offset + f.length);
        const bareNum = matched.match(/\d+/)?.[0] ?? "";
        const hasBasis =
          !!vtext && (vtext.includes(matched.replace(/\s+/g, "")) || (bareNum !== "" && vtext.includes(bareNum)));
        f.term = matched.trim();
        if (hasBasis) {
          f.grade = "B";
          f.guidance = "증빙(원출처) 확인됨 — 출처 4요소 표기 확인";
        } else {
          f.grade = "A";
          f.guidance = "증빙 없는 통계치 — 원출처 자료 확보 후 사용하거나 삭제";
        }
        findings.push(f);
      }
    }
    // 실제 사례 [A] / 납입면제 [A] (본문 필드 한정)
    if (!isTitle) {
      findings.push(
        ...runMatches(
          field, text,
          /[\d,]+\s*[만억조]?\s*원[^.\n]{0,12}보상[^.\n]{0,8}받았/g,
          "A", RULE.realCase,
          "실제 지급 사례 금지 → 가정형('O원 보장받을 수 있습니다')으로",
          "O원 보상 받았습니다"
        )
      );
      findings.push(
        ...runMatches(field, text, /납입\s*면제/g, "A", RULE.waiver, "납입면제 사례 언급 삭제(2025-10~)", "납입면제")
      );
    }
    // 제목류 금액/화폐 [A]
    if (isTitle && TITLE_FIELDS.has(field)) {
      for (const t of TITLE_MONEY)
        findings.push(
          ...runMatches(
            field, text, t.re, "A", RULE.titleMoney,
            "제목에서 금액/화폐 제거(본문은 허용) — 자릿수만 보여도 금액으로 간주",
            t.term
          )
        );
    }
  }

  // 적발 구간 발췌(±40자) — 모달 하이라이트용
  const textByField = new Map(fields.map((f) => [f.field, f.text]));
  for (const f of findings) {
    const t = textByField.get(f.field) ?? "";
    const start = Math.max(0, f.offset - 40);
    const end = Math.min(t.length, f.offset + f.length + 40);
    const lead = start > 0 ? "…" : "";
    const trail = end < t.length ? "…" : "";
    f.context = lead + t.slice(start, end) + trail;
    f.contextOffset = lead.length + (f.offset - start);
  }

  // 확인(ack) 대조 — B등급만
  const ackKey = (f: { field: string; term: string; offset: number }) => `${f.field}|${f.term}|${f.offset}`;
  const ackSet = new Set(acks.map(ackKey));
  for (const f of findings) if (f.grade === "B") f.acked = ackSet.has(ackKey(f));

  const hasA = findings.some((f) => f.grade === "A");
  const hasUnackedB = findings.some((f) => f.grade === "B" && !f.acked);
  const level: CheckResult["level"] = hasA ? "block" : hasUnackedB ? "warn" : "clean";
  return { level, findings };
}
