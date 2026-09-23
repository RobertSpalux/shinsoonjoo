import { ACTUAL_LOSS_NOTICE, REQUIRED_NOTICES } from "./brand";

/**
 * 네이버 붙여넣기용 HTML — **서식째 복사**.
 *
 * 🔴 정정 (2026-09-22, 관제탑 실측 재확인)
 *   종전 주석에 「네이버는 붙여넣기 서식을 전부 지운다」고 적어 두었으나 **틀렸다.**
 *   선택 영역을 execCommand('copy') 로 복사하면 **글자 크기·굵게·사진·인용구가 그대로 들어간다.**
 *   다만 **색 지정만은 네이버가 바꿔 버린다**(딥그린 → 빨강). 그래서 color 를 한 번도 쓰지 않는다.
 *
 * 🔴 입력은 반드시 **osmu-format 의 toNaverText 출력**이다.
 *   raw naver_blog_content 를 그대로 서식화하면 개인의견 귀속 문구(REQUIRED_NOTICES)와
 *   필수안내사항이 빠진다. 실제로 그 상태로 초안2 네이버가 접수됐다(2026-09-22).
 *   이 파일은 **텍스트를 만들지 않는다 — 이미 만들어진 텍스트에 크기만 입힌다.**
 *
 * 크기 규격
 *   소제목 24px · 목록/▶ 19px(용어는 <b>) · 본문 15px · 필수안내·유의문구 13px
 *   한 줄 조언은 <blockquote> 안에 라벨 19px + 본문 16px
 *   문단 사이 빈 줄은 `<p style="font-size:15px;">&nbsp;</p>`
 *   사진은 <p style="text-align:center;"> 안의 <img width="800">, data URI 로 포함
 */

const SIZE = { head: 24, list: 19, body: 15, advice: 16, notice: 13 } as const;

/** osmu 가 필수안내사항 앞에 넣는 구분선 */
const NOTICE_RULE = "─────────────";
const ADVICE_MARK = "한 줄 조언";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const p = (size: number, inner: string) => `<p style="font-size:${size}px;">${inner}</p>`;
const gap = () => p(SIZE.body, "&nbsp;");
const img = (src: string) =>
  `<p style="text-align:center;"><img src="${src}" width="800" ` +
  `style="width:100%;max-width:800px;height:auto;"></p>`;

function isHeading(ln: string): boolean {
  if (!ln || ln.length > 40) return false;
  if (/^[-•·▶>|📄#]/.test(ln)) return false;
  if (/^\d+\.\s/.test(ln)) return false;
  if (/[.?!]$/.test(ln)) return false;
  if (/^https?:\/\//.test(ln)) return false;
  if (ln.includes(" · ")) return false;
  if (ln.startsWith("─")) return false;
  return true;
}

/** `N. 용어 · 설명` / `▶ 항목 · 값` 에서 용어만 굵게 */
function boldTerm(ln: string): string {
  const m = ln.match(/^(\d+\.\s+|▶\s+)(.+?)(\s+·\s+)(.*)$/);
  if (!m) return esc(ln);
  return `${esc(m[1])}<b>${esc(m[2])}</b>${esc(m[3])}${esc(m[4])}`;
}

// 실손 글은 자기부담금 한 줄이 개인의견 블록에 같이 붙는다 — 같은 톤으로 낸다.
const isNoticeLine = (ln: string) =>
  [...REQUIRED_NOTICES, ACTUAL_LOSS_NOTICE].some((n) => ln.includes(n));

export interface NaverRichOptions {
  /** 본문에 넣을 사진(데이터 URI 권장). 없으면 사진 없이 만든다 — 자리를 지어내지 않는다. */
  images?: string[];
}

/**
 * osmu toNaverText 출력 → 네이버 붙여넣기용 HTML.
 *
 * 사진 자리: ① 맨 앞 ② 소제목 중간 ③ 마지막 소제목 앞. 소제목이 모자라면 있는 만큼만.
 * 구분선(`─────────────`) 뒤는 전부 필수안내사항으로 보고 13px 로 낸다.
 */
export function toNaverRichHtml(text: string, opts: NaverRichOptions = {}): string {
  const images = opts.images ?? [];
  const ruleAt = text.indexOf(NOTICE_RULE);
  const bodyText = ruleAt >= 0 ? text.slice(0, ruleAt) : text;
  const noticeText = ruleAt >= 0 ? text.slice(ruleAt + NOTICE_RULE.length) : "";

  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const raw of bodyText.split("\n")) {
    const ln = raw.trimEnd();
    if (ln.trim() === "") {
      if (cur.length) blocks.push(cur);
      cur = [];
    } else cur.push(ln);
  }
  if (cur.length) blocks.push(cur);

  const headIdx = blocks
    .map((b, i) => (b.length === 1 && isHeading(b[0].trim()) ? i : -1))
    .filter((i) => i >= 0);

  const slots = new Map<number, number>();
  if (images.length >= 2 && headIdx.length >= 2) {
    slots.set(headIdx[Math.floor(headIdx.length / 2)], 1);
  }
  if (images.length >= 3 && headIdx.length >= 3) {
    slots.set(headIdx[headIdx.length - 1], 2);
  }

  const out: string[] = [];
  if (images[0]) out.push(img(images[0]), gap());

  blocks.forEach((b, i) => {
    const slot = slots.get(i);
    if (slot !== undefined && images[slot]) out.push(img(images[slot]), gap(), gap());

    const first = b[0].trim();

    // 필수 유의문구 2종 — 본문 어디에 있든 13px
    if (b.every((l) => isNoticeLine(l.trim()))) {
      b.forEach((l) => out.push(p(SIZE.notice, esc(l.trim()))));
      out.push(gap());
      return;
    }

    // 한 줄 조언 — blockquote
    if (first.includes(ADVICE_MARK) && first.length <= 40) {
      const rest = b.slice(1).map((l) => esc(l.trim())).join("<br>");
      out.push(
        `<blockquote>${p(SIZE.list, `<b>${esc(first)}</b>`)}` +
        (rest ? p(SIZE.advice, rest) : "") + "</blockquote>",
        gap(),
      );
      return;
    }

    if (b.length === 1 && isHeading(first)) {
      out.push(gap(), p(SIZE.head, esc(first)), gap());
      return;
    }

    if (b.every((l) => /^(\d+\.\s|▶\s)/.test(l.trim()))) {
      b.forEach((l) => out.push(p(SIZE.list, boldTerm(l.trim())), gap()));
      return;
    }

    out.push(p(SIZE.body, b.map((l) => esc(l.trim())).join("<br>")), gap());
  });

  // 필수안내사항 — 구분선 뒤 전부. 빠뜨리면 반송된다.
  //   원문의 빈 줄을 문단 구분으로 살린다 — 한 덩어리로 이으면 심의 첨부 캡처에서 읽기 어렵다.
  const noticeParas = noticeText
    .split(/\n\s*\n/)
    .map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((b) => b.length > 0);
  if (noticeParas.length) {
    out.push(gap());
    noticeParas.forEach((b) => out.push(p(SIZE.notice, b.map(esc).join("<br>"))));
  }
  return out.join("\n");
}

/** 붙여넣은 뒤 확인용 — 소제목 목록. 서식이 살아 있으면 손댈 필요가 없다. */
export function naverHeadings(text: string): string[] {
  const ruleAt = text.indexOf(NOTICE_RULE);
  const body = ruleAt >= 0 ? text.slice(0, ruleAt) : text;
  return body.split("\n").map((l) => l.trim()).filter(isHeading);
}
