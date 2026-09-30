/**
 * 댓글 답글 게이트 테스트 — `npx tsx src/lib/compliance/reply-terms.test.mts`
 * docs/THREADS-REPLY-RULES.md §4 예시 10쌍: 나쁜 예 10개는 전부 막고, 좋은 예 10개는 0건.
 * (나쁜 예·좋은 예 문장은 문서와 글자 그대로. 7·10번 댓글은 문서의 자리표시를 실제 꼴로 채웠다.)
 */
import { checkReplyTerms } from "./reply-terms";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log("  ✓", name);
  } else {
    fail++;
    console.log("  ✗ FAIL:", name, extra);
  }
};

const GOOD_LINK = "개인마다 계약이 달라 여기서 말씀드리기 어려워요. 프로필 링크로 상담 남겨 주시면 직접 보고 말씀드릴게요.";

const PAIRS: { comment: string; bad: string; good: string; expect: string }[] = [
  { comment: "간병보험 뭐 들면 돼요?", bad: "○○사 간병보험 추천해요. 제일 좋아요.", good: GOOD_LINK, expect: "recommend" },
  {
    comment: "저 암보험 3개 있는데 충분한가요?",
    bad: "3개면 충분합니다! 걱정 마세요.",
    good: "갯수보다 담보별로 합쳐 보면 달라지는 경우가 많아요. 프로필 링크로 상담 남겨 주시면 직접 보고 말씀드릴게요.",
    expect: "assertive",
  },
  {
    comment: "보험료 한 달에 얼마 정도 해요?",
    bad: "보통 월 5만원대면 돼요.",
    good: "나이·담보·납기에 따라 많이 달라서 숫자로 말씀드리기 어려워요. 프로필 링크로 상담 남겨 주시면 직접 보고 말씀드릴게요.",
    expect: "premium",
  },
  { comment: "글 잘 봤어요, 도움 됐어요", bad: "감사합니다! 무료 상담도 해드려요~", good: "읽어 주셔서 고맙습니다.", expect: "banned" },
  {
    comment: "지인한테 들었는데 해지하는 게 낫나요?",
    bad: "네, 당장 해지하고 새로 드세요.",
    good: "해지는 되돌리기 어려워서, 담보별로 펼쳐 보고 판단하시는 게 안전해요. 바로 해지하지 마시고요.",
    expect: "assertive",
  },
  {
    comment: "다이렉트가 더 싸지 않아요?",
    bad: "다이렉트는 보장이 약해서 비추예요.",
    good: "가입 경로보다 지금 계약에 어떤 담보가 얼마나 있는지가 먼저라고 생각해요.",
    expect: "slander",
  },
  {
    comment: "저희 엄마도 봉와직염으로 입원 중이세요 ㅠ",
    bad: "○○병이면 수술비 특약 꼭 청구하세요!",
    good: "마음이 많이 쓰이시겠어요. 어머님 빨리 회복하시길 바랄게요.",
    expect: "echo",
  },
  {
    comment: "설계사들은 다 자기 실적 때문에 파는 거 아니에요?",
    bad: "맞아요, 다른 설계사들은 그래요.",
    good: "저는 필요 없는 건 제안하지 않는 걸 원칙으로 하고 있어요.",
    expect: "slander",
  },
  {
    comment: "청구하면 무조건 나오나요?",
    bad: "그럼요, 100% 나옵니다.",
    good: "약관과 서류에 따라 달라져요. 가입하신 계약을 봐야 정확히 말씀드릴 수 있어요.",
    expect: "assertive",
  },
  {
    comment: "부모님 거 한번 봐주실 수 있어요? 010-1234-5678",
    bad: "네 전화드릴게요! (번호 되받기)",
    good: "댓글에 연락처는 지우시는 게 안전해요. 프로필 링크로 상담 남겨 주시면 직접 보고 말씀드릴게요.",
    expect: "contact",
  },
];

console.log("[1] 나쁜 예 10개 — 전부 막는다");
PAIRS.forEach((p, i) => {
  const r = checkReplyTerms(p.bad, p.comment);
  ok(`#${i + 1} 나쁜 예 막힘 (${p.expect})`, !r.pass && r.findings.some((f) => f.rule === p.expect), JSON.stringify(r.findings));
});

console.log("\n[2] 좋은 예 10개 — 0건");
PAIRS.forEach((p, i) => {
  const r = checkReplyTerms(p.good, p.comment);
  ok(`#${i + 1} 좋은 예 통과`, r.pass, JSON.stringify(r.findings));
});

console.log("\n[3] 개별 규칙");
ok("월 3만원 초반", !checkReplyTerms("월 3만원 초반이면 됩니다").pass);
ok("2만원 대", !checkReplyTerms("2만원 대로 가능해요").pass);
ok("M사 이니셜", !checkReplyTerms("M사 상품이 괜찮아요").pass);
ok("삼성화재 사명", !checkReplyTerms("삼성화재 쪽을 보세요").pass);
ok("오픈채팅", !checkReplyTerms("오픈채팅으로 오세요").pass);
ok("외부 URL", !checkReplyTerms("https://bit.ly/abc 참고하세요").pass);
ok("등록 명의 URL 은 허용", checkReplyTerms("자세한 건 goodfinance.kr 에 정리해 두었어요.").pass);
ok("댓글 병명 되받기(뇌졸중)", !checkReplyTerms("뇌졸중 진단이면 담보가 중요해요", "아버지가 뇌졸중이셨어요").pass);
ok("병명 없는 공감은 통과", checkReplyTerms("많이 놀라셨겠어요. 빨리 회복하시길 바랄게요.", "아버지가 뇌졸중이셨어요").pass);
ok("「기분」「공부」 같은 일상어는 통과", checkReplyTerms("오늘 기분이 좋아지는 글이네요. 저도 공부가 됐어요.").pass);
ok("「걱정」 공감은 통과", checkReplyTerms("걱정이 많으셨겠어요.").pass);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
