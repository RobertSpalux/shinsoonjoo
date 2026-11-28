/**
 * CF1b — 텍스트 노드 diff 0 증명 (§6.11-9). 측정 이벤트·모바일 여백 변경이 화면 문구를 바꾸지 않음을 검증한다.
 * 변경 전후 렌더 HTML 에서 태그를 걷어낸 텍스트를 골든(cf1b-text.golden.txt)과 비교한다.
 * 골든은 변경 전(main 2c5a21e) 트리에서 `--write` 로 생성했다. 이후 변경은 이 시험이 막는다.
 * 실행: npx tsx src/lib/cf1b-text-diff.test.mts   (골든 재생성: -- --write)
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(here, "cf1b-text.golden.txt");

function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const Diagnosis = (await import("../app/diagnosis/page")).default;
const CtaEnd = (await import("../components/news/ArticleCtaEnd")).default;
const CtaInline = (await import("../components/news/ArticleCtaInline")).default;

const parts: string[] = [];
parts.push("## /diagnosis\n" + textOf(renderToStaticMarkup(createElement(Diagnosis))));
parts.push("## ArticleCtaEnd\n" + textOf(renderToStaticMarkup(createElement(CtaEnd, { slug: "x" }))));
parts.push("## ArticleCtaInline\n" + textOf(renderToStaticMarkup(createElement(CtaInline, { slug: "x" }))));
try {
  const Depth = (await import("../components/news/ArticleScrollDepth")).default;
  parts.push("## ArticleScrollDepth\n" + textOf(renderToStaticMarkup(createElement(Depth, { slug: "x" }))));
} catch {
  parts.push("## ArticleScrollDepth\n");
}
const actual = parts.join("\n\n") + "\n";

if (process.argv.includes("--write")) {
  writeFileSync(goldenPath, actual, "utf8");
  console.log("golden written:", goldenPath);
} else {
  if (!existsSync(goldenPath)) throw new Error("골든 없음");
  const golden = readFileSync(goldenPath, "utf8");
  if (golden !== actual) {
    const g = golden.split("\n");
    const a = actual.split("\n");
    for (let i = 0; i < Math.max(g.length, a.length); i++) {
      if (g[i] !== a[i]) {
        console.error(`텍스트 노드 diff @${i + 1}\n  골든: ${g[i]}\n  현재: ${a[i]}`);
        break;
      }
    }
    process.exit(1);
  }
  console.log("OK — 텍스트 노드 diff 0건 (" + actual.split("\n").length + "줄)");
}
