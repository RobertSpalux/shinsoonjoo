/**
 * style-gate 단위 테스트 — `npx tsx src/lib/style-gate.test.mts`
 * 경어체 통과 / 평서체 적발 / 표·인용·제목·개조식 오탐 가드를 고정한다.
 */
import {
  scanPlainStyle,
  PLAIN_RATIO_THRESHOLD,
  PLAIN_COUNT_THRESHOLD,
  type StyleCheckable,
} from "./style-gate";

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
const fields = (o: StyleCheckable) => scanPlainStyle(o).map((v) => v.field);
const clean = (o: StyleCheckable) => scanPlainStyle(o).length === 0;

console.log("[경어체 정상 — 위반 0]");
ok(
  "본진 경어체 → clean",
  clean({
    main_website_markdown:
      "보험을 몇 개 갖고 계신지는 아십니다. 그런데 총액은 모르십니다. 상담에서 확인해 드립니다. 함께 살펴보겠습니다.",
  })
);
ok(
  "~요 종결 → clean",
  clean({ main_website_markdown: "지금 확인해 보세요. 어렵지 않아요. 궁금하면 물어봐 주세요." })
);
ok(
  "HTML(블로그스팟) 경어체 → clean",
  clean({
    blogspot_content:
      "<h2>고지의무</h2>\n<ul>\n<li>정확히 알리셔야 합니다.</li>\n<li>3년이 지나면 해지되지 않습니다.</li>\n</ul>",
  })
);

console.log("[평서체 — 위반 감지]");
{
  const v = scanPlainStyle({
    main_website_markdown:
      "보험을 몇 개 갖고 있는지는 안다. 그런데 총액은 모른다. 이것이 문제다. 합쳐보면 오천만원이다.",
  });
  ok("평서체 본진 → 위반", v.length === 1 && v[0].field === "main_website_markdown");
  ok("plainCount·total 집계", !!v[0] && v[0].plainCount === 4 && v[0].total === 4);
  ok("ratio 1.0", !!v[0] && v[0].ratio === 1);
  ok("samples ≤ 3", !!v[0] && v[0].samples.length <= 3 && v[0].samples.length > 0);
}
ok(
  "아니다 → plain 감지(summary)",
  fields({ summary: "그것은 정답이 아니다." }).includes("summary")
);
ok(
  "네이버 평서체 → 위반(naver_blog_content)",
  fields({ naver_blog_content: "이것은 사실이다. 저것도 사실이다. 결론은 명확하다." }).includes(
    "naver_blog_content"
  )
);
ok(
  "faq 답변 평서체 → 위반(faq_json)",
  fields({
    faq_json: [{ question: "질문입니다?", answer: "납입면제는 안 된다. 갱신형이다. 확인이 필요하다." }],
  }).includes("faq_json")
);
ok(
  "HTML(블로그스팟) 평서체 → 위반",
  fields({
    blogspot_content:
      "<ul>\n<li>정확히 알려야 한다.</li>\n<li>3년이 지나면 해지된다.</li>\n<li>이것이 핵심이다.</li>\n</ul>",
  }).includes("blogspot_content")
);

console.log("[오탐 가드 — 위반 0]");
ok(
  "표·인용·제목에만 평서체 → clean",
  clean({
    main_website_markdown:
      "이 표는 보장을 정리한 것입니다.\n\n| 담보 | 값 |\n| 사망 | 이것이 전부다 |\n\n> 인용은 이렇다.\n\n## 제목은 이렇다\n\n합산은 상담에서 확인하십니다.",
  })
);
ok(
  "개조식 명사형 종결 → clean",
  clean({ key_points: ["보장 공백 점검", "중복 담보 정리", "실손 세대 확인"] })
);
ok(
  "주석 마커(CTA/advice)만 있는 줄 → 무시",
  clean({ main_website_markdown: "지금부터 함께 살펴보겠습니다.\n\n<!--CTA-->\n\n결론을 말씀드립니다." })
);
{
  // 긴 경어체 본문에 평서체 1문장만 섞이면 관용(ratio<0.15 & count<3)
  const honor = Array.from({ length: 10 }, (_, i) => `${i + 1}번 항목을 확인하십니다.`).join(" ");
  ok("장문 1문장 슬립 → 관용(clean)", clean({ main_website_markdown: honor + " 그런데 하나는 빠졌다." }));
}

console.log("[임계·형태]");
ok("임계 상수 export", PLAIN_RATIO_THRESHOLD === 0.15 && PLAIN_COUNT_THRESHOLD === 3);
{
  const v = scanPlainStyle({ main_website_markdown: "이것이 문제다. 저것도 문제다. 결론이다. 끝이다." })[0];
  ok(
    "StyleViolation 형태(field·plainCount·total·ratio·samples)",
    !!v &&
      typeof v.field === "string" &&
      Number.isInteger(v.plainCount) &&
      Number.isInteger(v.total) &&
      typeof v.ratio === "number" &&
      Array.isArray(v.samples)
  );
}

console.log(`\n결과: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
