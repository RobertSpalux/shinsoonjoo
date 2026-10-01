/**
 * 네이버 붙여넣기 HTML — 사진 자리표시·따옴표 첫 문장이 소제목(24px)으로 나가지 않는지 고정한다.
 * `npx tsx src/lib/naver-rich.test.mts`
 * (실측 사고 2026-10-01: 「[이미지①]」과 그 밑 따옴표 문장이 둘 다 24px 라 제목처럼 보였고,
 *  자리표시를 지우면서 본문 첫 줄이 같이 지워졌다 — 7호 비공개 글 · 10호 승인본)
 */
import { toNaverRichHtml, naverHeadings } from "./naver-rich";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) {
    pass++;
    console.log("  ✓", name);
  } else {
    fail++;
    console.log("  ✗ FAIL:", name);
  }
};

const TEXT = [
  "[이미지①]",
  "",
  '"등급 나왔으니까 보험에서도 뭐가 나오겠지."',
  "",
  "부모님 장기요양등급을 받으신 분들이 흔히 하시는 생각입니다.",
  "",
  "알아두실 용어 4가지",
  "",
  "1. 장기요양등급 · 요양이 필요한 정도",
].join("\n");

const html = toNaverRichHtml(TEXT);
const heads = naverHeadings(TEXT);

console.log("\n[1] 소제목 판정");
ok("자리표시는 소제목 아님", !heads.includes("[이미지①]"));
ok("따옴표 첫 문장은 소제목 아님", !heads.some((h) => h.startsWith('"')));
ok("진짜 소제목은 그대로", heads.includes("알아두실 용어 4가지"));

console.log("\n[2] 크기");
ok("자리표시는 13px", html.includes('<p style="font-size:13px;">[이미지①]</p>'));
ok("따옴표 첫 문장은 본문 15px", html.includes('<p style="font-size:15px;">&quot;등급 나왔으니까 보험에서도 뭐가 나오겠지.&quot;</p>'));
ok("소제목은 24px", html.includes('<p style="font-size:24px;">알아두실 용어 4가지</p>'));
ok("24px 은 소제목 하나뿐", html.split("font-size:24px").length - 1 === 1);

console.log("\n[3] 글자는 그대로(서식만)");
ok("첫 줄 글자 보존", html.includes("등급 나왔으니까 보험에서도 뭐가 나오겠지."));

console.log(`\n${pass} 통과 · ${fail} 실패`);
if (fail) process.exit(1);
