// tools/pams-capture/lib.js — 탭 판정 · iframe 본문 주소 · 파일명.
//   npx tsx scripts/pams_capture.test.mts
import { checkTab, postViewUrl, captureName } from "../tools/pams-capture/lib.js";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗ FAIL:", name); }
};

ok("우리 블로그 글 → 인쇄", checkTab("https://blog.naver.com/insightlab-daily/224400000001").ok);
ok("모바일 화면 → 인쇄", checkTab("https://m.blog.naver.com/insightlab-daily/224400000001").ok);
ok("남의 블로그 → 거절", !checkTab("https://blog.naver.com/someone/1").ok);
ok("네이버 아님 → 거절", !checkTab("https://pams.example.com/").ok);
ok("빈 주소 → 거절", !checkTab(undefined as unknown as string).ok);

ok("iframe PostView → 절대 주소",
  postViewUrl("/PostView.naver?blogId=insightlab-daily&logNo=1", "https://blog.naver.com/insightlab-daily/1")
    === "https://blog.naver.com/PostView.naver?blogId=insightlab-daily&logNo=1");
ok("iframe 없음 → null", postViewUrl(null, "https://blog.naver.com/x") === null);
ok("PostView 아닌 iframe → null", postViewUrl("/other.naver", "https://blog.naver.com/x") === null);

const name = captureName("종신보험 사망보험금 질병사망 상해사망 합쳐서 보는 이유 : 네이버 블로그");
ok("탭 제목 꼬리 제거", name === "PAMS접수/종신보험 사망보험금 질병사망 상해사망 합쳐서 보는 이유.pdf");
ok("파일명 금지 문자 제거", captureName('a/b:c?"d" e') === "PAMS접수/abcd e.pdf");
ok("빈 제목 → 기본 이름", captureName("") === "PAMS접수/네이버_캡처.pdf");

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
