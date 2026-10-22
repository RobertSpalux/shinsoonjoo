import { ACTUAL_LOSS_NOTICE, BRAND, CONDITIONAL_NOTICES, REQUIRED_NOTICES } from "./brand";
import NAVER_FORMAT from "../../configs/naver-format.json";

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
 *   이 파일은 **텍스트를 만들지 않는다 — 이미 만들어진 텍스트에 크기·태그만 입힌다.**
 *   글자에서 빠지는 것은 구조 표시뿐이다: `[이미지N]`(사진으로 바뀜) · `[표N]`·` | `(표로 바뀜) ·
 *   「함께 읽으면 좋은 글」의 URL 줄(바로 위 설명 문장의 링크로 바뀜).
 *
 * 🔴 정정 (2026-10-15 NF1, 24호)
 *   종전에는 소제목을 「빈 줄로 홀로 선 한 줄」로만 알아봤다. 원고 규격은 소제목 바로 밑에 본문이 붙는다
 *   (「알아두실 용어 4가지\n1. …」). 그래서 24호 html 은 24px 소제목 0개 — 표·Q·링크까지 15px 로 뭉개졌다.
 *   21~23호는 사람이 손으로 만든 html 이 규격을 냈다. 그 손작업본(22·23호)이 지금의 정답(골든 테스트)이다.
 *
 * 크기 규격 (configs/naver-format.json)
 *   소제목 24px — 블록 첫 줄 · 목록(「N. 용어 · 설명」)·Q. 19px(용어·질문은 <b>) · 본문·A. 15px
 *   사진 설명 14px 가운데 · 필수안내·유의문구 13px
 *   한 줄 조언은 <blockquote> 안에 라벨 19px + 본문 16px
 *   `[표N] 제목` + `a | b | c` 줄 → 19px 굵은 제목 + <table>
 *   문단 사이 빈 줄은 `<p style="font-size:15px;">&nbsp;</p>`
 *   사진은 `[이미지N]` 자리에 N번째 사진. 마지막 자리 = 진단 CTA 카드 → goodfinance.kr/diagnosis 링크
 */

// 규격은 configs/naver-format.json 한 곳 — robert-os 1클릭 채움도 같은 파일을 읽는다.
const SIZE = NAVER_FORMAT.size_px;

/** osmu 가 필수안내사항 앞에 넣는 구분선 */
const NOTICE_RULE = NAVER_FORMAT.notice_rule;
const ADVICE_MARK = NAVER_FORMAT.advice_mark;
const CTA_URL = NAVER_FORMAT.cta_url;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const p = (size: number, inner: string) => `<p style="font-size:${size}px;">${inner}</p>`;
const gap = () => p(SIZE.body, "&nbsp;");
const imgTag = (src: string) =>
  `<img src="${esc(src)}" width="800" style="width:100%;max-width:800px;height:auto;">`;
const img = (src: string, href?: string) =>
  `<p style="text-align:center;">` +
  (href ? `<a href="${esc(href)}" target="_blank">${imgTag(src)}</a>` : imgTag(src)) + `</p>`;
const caption = (inner: string) => `<p style="font-size:${SIZE.caption}px;text-align:center;">${inner}</p>`;
const link = (href: string, inner: string) => `<a href="${esc(href)}" target="_blank">${inner}</a>`;

/** `[이미지①]` 사진 자리표시 — 이 자리에 N번째 사진이 들어간다 */
const IMG_MARKER_LINE = /^\[이미지\s*([①②③④⑤⑥⑦⑧⑨⑩]|\d+)?\]$/;
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
/** `[표1] 제목` — 다음 줄부터 `a | b | c` */
const TABLE_HEAD = /^\[표\s*\d*\]\s*(.*)$/;
const URL_LINE = /^https?:\/\/\S+$/;

function isHeading(ln: string): boolean {
  if (!ln || ln.length > 40) return false;
  if (/^[-•·▶>|📄#\[]/.test(ln)) return false;
  // 🔴 사진 자리표시·따옴표 첫 문장은 소제목이 아니다(2026-10-01 7호 네이버).
  //    둘 다 24px 로 나가 「[이미지①]」 바로 밑 따옴표 문장이 제목처럼 보였고,
  //    자리표시를 지우면서 본문 첫 줄이 같이 지워졌다(10호 승인본도 같은 줄이 빠져 있다).
  if (IMG_MARKER_LINE.test(ln)) return false;
  if (/^["“'‘「]/.test(ln)) return false;
  if (/^\d+\.\s/.test(ln)) return false;
  if (/^[QA]\.\s/.test(ln)) return false;
  if (/[.?!]$/.test(ln)) return false;
  // 마침표 없이 「~습니다」로 끝나는 줄은 문장이다 — 22·23호 정답본도 15px 본문으로 냈다.
  if (/다$/.test(ln)) return false;
  if (URL_LINE.test(ln)) return false;
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

// 실손 글은 자기부담금·가입시기 한 줄이 개인의견 블록에 같이 붙는다 — 같은 톤(13px)으로 낸다.
const NOTICE_LINES = [...REQUIRED_NOTICES, ACTUAL_LOSS_NOTICE, ...Object.values(CONDITIONAL_NOTICES)];
const isNoticeLine = (ln: string) => NOTICE_LINES.some((n) => ln.includes(n));

/** 본문(구분선 앞)을 빈 줄 기준 블록으로 — 각 줄은 앞뒤 공백을 걷어 낸다 */
function bodyBlocks(text: string): { blocks: string[][]; noticeText: string } {
  const ruleAt = text.indexOf(NOTICE_RULE);
  const bodyText = ruleAt >= 0 ? text.slice(0, ruleAt) : text;
  const noticeText = ruleAt >= 0 ? text.slice(ruleAt + NOTICE_RULE.length) : "";
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const raw of bodyText.split("\n")) {
    const ln = raw.trim();
    if (ln === "") {
      if (cur.length) blocks.push(cur);
      cur = [];
    } else cur.push(ln);
  }
  if (cur.length) blocks.push(cur);
  return { blocks, noticeText };
}

const isTableBlock = (b: string[]) => TABLE_HEAD.test(b[0]) && b.length >= 2 && b.slice(1).every((l) => l.includes("|"));
const isAdviceBlock = (b: string[]) => b[0].includes(ADVICE_MARK) && b[0].length <= 40;
/** 블록 첫 줄이 소제목인가 — 사진·표·조언·유의문구 블록은 아니다 */
const headOf = (b: string[]) =>
  !isTableBlock(b) && !isAdviceBlock(b) && !b.every(isNoticeLine) && isHeading(b[0]) ? b[0] : null;

function table(rows: string[]): string {
  const cells = (l: string) => l.split("|").map((c) => esc(c.trim()));
  const [head, ...body] = rows;
  return `<table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:${SIZE.body}px;">` +
    `<thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join("")}</tr></thead>` +
    `<tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

/** 블록 안의 줄들 — 한 줄이 한 문단(뒤에 빈 줄) */
function lines(ls: string[], out: string[]) {
  for (let i = 0; i < ls.length; i++) {
    const ln = ls[i];
    const next = ls[i + 1];
    if (!URL_LINE.test(ln) && next && URL_LINE.test(next)) {
      // 「함께 읽으면 좋은 글」 — 설명 문장에 다음 줄 URL 을 건다. URL 줄은 따로 내지 않는다.
      out.push(p(SIZE.body, link(next, esc(ln))), gap());
      i++;
    } else if (/^Q\.\s/.test(ln)) {
      out.push(p(SIZE.list, `<b>${esc(ln)}</b>`), gap());
    } else if (/^(\d+\.\s|▶\s)/.test(ln) && / · /.test(ln)) {
      out.push(p(SIZE.list, boldTerm(ln)), gap());
    } else {
      out.push(p(SIZE.body, esc(ln)), gap());
    }
  }
}

export interface NaverRichOptions {
  /** 본문에 넣을 사진(데이터 URI 권장). 없으면 사진 없이 만든다 — 자리를 지어내지 않는다. */
  images?: string[];
  /**
   * CTA 사진(마지막 자리)의 링크. 기본 = 진단 페이지(naver-format.json cta_url, 승인된 글 그대로).
   * KC1: 새 원고는 `NAVER_KAKAO_CTA_URL`(카톡 채널)을 넘긴다.
   */
  ctaUrl?: string;
}

/** KC1 — 새 원고의 CTA 링크. 단일 출처 BRAND.social.kakao. */
export const NAVER_KAKAO_CTA_URL = BRAND.social.kakao;

/**
 * osmu toNaverText 출력 → 네이버 붙여넣기용 HTML.
 *
 * 사진: 원고에 `[이미지N]` 자리가 있으면 그 자리에 N번째 사진(자리표시 글자는 남기지 않는다).
 *   사진이 모자라면 그 자리표시는 13px 로 남긴다(사람이 넣을 자리).
 *   자리가 하나도 없는 옛 원고는 ① 맨 앞 ② 소제목 중간 ③ 마지막 소제목 앞.
 * 구분선(`─────────────`) 뒤는 전부 필수안내사항으로 보고 13px 로 낸다.
 */
export function toNaverRichHtml(text: string, opts: NaverRichOptions = {}): string {
  const images = opts.images ?? [];
  const { blocks, noticeText } = bodyBlocks(text);

  const markerBlocks = blocks.map((b, i) => (IMG_MARKER_LINE.test(b[0]) ? i : -1)).filter((i) => i >= 0);
  const lastMarker = markerBlocks[markerBlocks.length - 1];

  // 옛 원고(자리표시 없음) — 사진 자리를 소제목 기준으로 잡는다
  const slots = new Map<number, number>();
  const out: string[] = [];
  if (!markerBlocks.length) {
    const headIdx = blocks.map((b, i) => (headOf(b) ? i : -1)).filter((i) => i >= 0);
    if (images.length >= 2 && headIdx.length >= 2) slots.set(headIdx[Math.floor(headIdx.length / 2)], 1);
    if (images.length >= 3 && headIdx.length >= 3) slots.set(headIdx[headIdx.length - 1], 2);
    if (images[0]) out.push(img(images[0]), gap());
  }

  let seq = 0;
  blocks.forEach((b, i) => {
    const slot = slots.get(i);
    if (slot !== undefined && images[slot]) out.push(img(images[slot]), gap(), gap());

    const first = b[0];

    // 사진 자리 — N번째 사진 + 바로 밑 줄은 사진 설명(14px 가운데)
    const mk = first.match(IMG_MARKER_LINE);
    if (mk) {
      seq++;
      const n = mk[1] ? (CIRCLED.includes(mk[1]) ? CIRCLED.indexOf(mk[1]) + 1 : Number(mk[1])) : seq;
      const src = images[n - 1];
      if (!src) {
        // 사진이 없으면 자리표시를 남긴다 — 본문과 구분되게 작게(지울 줄). 제목 크기로 내지 않는다.
        out.push(p(SIZE.notice, esc(first)), gap());
        if (b.length > 1) lines(b.slice(1), out);
        return;
      }
      out.push(img(src, i === lastMarker ? (opts.ctaUrl ?? CTA_URL) : undefined));
      if (b.length > 1) out.push(caption(b.slice(1).map(esc).join("<br>")));
      out.push(gap());
      return;
    }

    // 필수 유의문구 2종 — 본문 어디에 있든 13px
    if (b.every(isNoticeLine)) {
      b.forEach((l) => out.push(p(SIZE.notice, esc(l))));
      out.push(gap());
      return;
    }

    // 한 줄 조언 — blockquote
    if (isAdviceBlock(b)) {
      const rest = b.slice(1).map(esc).join("<br>");
      out.push(
        `<blockquote>${p(SIZE.list, `<b>${esc(first)}</b>`)}` +
        (rest ? p(SIZE.advice, rest) : "") + "</blockquote>",
        gap(),
      );
      return;
    }

    // 표 — 19px 굵은 제목 + <table>
    if (isTableBlock(b)) {
      const title = first.match(TABLE_HEAD)![1];
      if (title) out.push(p(SIZE.list, `<b>${esc(title)}</b>`));
      out.push(table(b.slice(1)), gap());
      return;
    }

    // 블록 첫 줄이 소제목이면 24px 로 떼고 나머지는 본문
    if (headOf(b)) {
      out.push(gap(), p(SIZE.head, esc(first)), gap());
      lines(b.slice(1), out);
      return;
    }

    lines(b, out);
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

/** 붙여넣은 뒤 확인용 — 소제목(24px 로 나가는 블록 첫 줄) 목록. 서식이 살아 있으면 손댈 필요가 없다. */
export function naverHeadings(text: string): string[] {
  return bodyBlocks(text).blocks.map(headOf).filter((h): h is string => h !== null);
}
