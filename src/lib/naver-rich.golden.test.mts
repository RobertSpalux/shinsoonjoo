/**
 * 네이버 서식 HTML 골든 테스트 — 22·23호 손작업 정답본과 「태그·크기 순서」가 같은지(공백 무시).
 * `npx tsx src/lib/naver-rich.golden.test.mts`
 *
 * 정답본(__fixtures__/naver-rich/22.html · 23.html)은 2026-10-14 관제탑이 손으로 만든 html 이다.
 * 정식 경로(toNaverRichHtml)가 한 번도 규격을 낸 적이 없어 24호가 24px 소제목 0개로 나갔다(NF1).
 *
 * 함께 검사: 글자는 한 자도 바뀌지 않는다(텍스트 노드 diff 0). 빠지는 것은 구조 표시뿐 —
 *   `[이미지N]` 줄 · `[표N]` 머리 · 표 칸 구분 ` | ` · 구분선. URL 줄은 링크(href)로 옮겨 간다.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toNaverRichHtml, naverHeadings } from "./naver-rich";
import NAVER_FORMAT from "../../configs/naver-format.json";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "naver-rich");
const read = (n: string) => readFileSync(join(FIX, n), "utf-8");

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log("  ✓", name);
  } else {
    fail++;
    console.log("  ✗ FAIL:", name, detail);
  }
};

/** 태그·크기 순서 — `p15` `/p` `b` `table` `a:https://…` … */
function shape(html: string): string[] {
  const body = html.includes("<body") ? html.slice(html.indexOf(">", html.indexOf("<body")) + 1, html.lastIndexOf("</body>")) : html;
  const out: string[] = [];
  for (const m of body.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/gi)) {
    const [, close, tag, attrs] = m;
    const size = attrs.match(/font-size:(\d+)px/)?.[1] ?? "";
    const href = tag === "a" ? ":" + (attrs.match(/href="([^"]*)"/)?.[1] ?? "") : "";
    out.push(`${close}${tag.toLowerCase()}${size}${href}`);
  }
  return out;
}

const decode = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** html 에 보이는 글자(링크 주소 포함) — 낱말 단위 */
function htmlWords(html: string): string[] {
  const t = html
    // 글자 링크는 주소까지(원고의 URL 줄) · 사진 링크(CTA)는 원고에 없는 주소라 뺀다
    .replace(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, inner) => (inner.includes("<img") ? " " : ` ${inner} ${href} `))
    .replace(/<[^>]+>/g, " ");
  return decode(t).split(/\s+/).filter(Boolean);
}

/** 원고 글자에서 구조 표시만 뺀 것 — 낱말 단위 */
function textWords(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !/^\[이미지\s*[①②③④⑤⑥⑦⑧⑨⑩0-9]*\]$/.test(l))
    .map((l) => l.replace(/^\[표\s*\d*\]\s*/, ""))
    .join("\n")
    .replace(NAVER_FORMAT.notice_rule, " ")
    .split(/\s+/)
    .filter((w) => w && w !== "|");
}

function firstDiff(a: string[], b: string[]): string {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return `@${i}: 정답 ${a.slice(i, i + 4).join(" ")} / 생성 ${b.slice(i, i + 4).join(" ")}`;
  return "";
}

for (const no of ["22", "23"]) {
  console.log(`\n[${no}호] 정답본 대조`);
  const text = read(`${no}.txt`);
  const images = [1, 2, 3, 4, 5].map((i) => `1014_${no}호_네이버비공개_이미지${i}.png`);
  const html = toNaverRichHtml(text, { images });
  const want = shape(read(`${no}.html`));
  const got = shape(html);
  ok(`태그·크기 순서 일치 (${want.length}개)`, JSON.stringify(want) === JSON.stringify(got), firstDiff(want, got));
  const tw = textWords(text), hw = htmlWords(html);
  ok("글자 diff 0", JSON.stringify(tw) === JSON.stringify(hw), firstDiff(tw, hw));
  ok("자리표시 글자 없음", !/\[이미지|\[표\d/.test(html));
  ok("색·폰트 지정 없음", !/color|font-family/.test(html));
}

console.log("\n[24호] 소제목 · 표 · 링크");
{
  const text = read("24.txt");
  const html = toNaverRichHtml(text, { images: [1, 2, 3, 4, 5].map((i) => `img${i}.png`) });
  const heads = naverHeadings(text);
  ok("소제목 10개", heads.length === 10, heads.join(" / "));
  ok("24px = 소제목 수", (html.match(/font-size:24px/g) ?? []).length === heads.length);
  ok("「알아두실 용어 4가지」 24px(밑에 본문이 붙어도)", html.includes('<p style="font-size:24px;">알아두실 용어 4가지</p>'));
  ok("표 1개", (html.match(/<table/g) ?? []).length === 1);
  ok("Q 19px 3개", (html.match(/<p style="font-size:19px;"><b>Q\. /g) ?? []).length === 3);
  ok("링크 3개(CTA 1 + 함께 읽으면 2)", (html.match(/<a href=/g) ?? []).length === 3);
  ok("CTA 사진에 진단 링크", html.includes(`<a href="${NAVER_FORMAT.cta_url}" target="_blank"><img src="img5.png"`));
  ok("URL 줄이 따로 남지 않음", !/<p style="font-size:15px;">https?:/.test(html));
  ok("글자 diff 0", JSON.stringify(textWords(text)) === JSON.stringify(htmlWords(html)), firstDiff(textWords(text), htmlWords(html)));
}

console.log(`\n${pass} 통과 · ${fail} 실패`);
if (fail) process.exit(1);
