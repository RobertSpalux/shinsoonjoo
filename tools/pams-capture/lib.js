// 순수 함수 — background.js 와 scripts/pams_capture.test.mts 가 같이 쓴다.

const NAVER_HOST = /^https:\/\/(m\.)?blog\.naver\.com\//;
const OWN_BLOG = "insightlab-daily"; // §6.4 사전등록 네이버 블로그 — 이 블로그 글만 인쇄한다

/** 인쇄해도 되는 탭인가 → { ok, why }. 우리 네이버 블로그 글 화면만. */
export function checkTab(url) {
  if (!url || !NAVER_HOST.test(url)) return { ok: false, why: "네이버 블로그 탭이 아닙니다" };
  if (!url.includes(OWN_BLOG)) return { ok: false, why: `${OWN_BLOG} 블로그 글이 아닙니다` };
  return { ok: true, why: "" };
}

/** PC 화면은 본문이 iframe(mainFrame) 안에 있다 — 그 주소(PostView)를 그대로 열어 인쇄한다. */
export function postViewUrl(frameSrc, base) {
  if (!frameSrc) return null;
  try {
    const u = new URL(frameSrc, base);
    return /PostView\.naver/i.test(u.pathname) ? u.href : null;
  } catch {
    return null;
  }
}

/** 탭 제목 → 파일명. pams_auto 는 파일명이 네이버 제목의 조각이면 그 글과 짝을 맞춘다(match_capture by_title). */
export function captureName(tabTitle) {
  const t = (tabTitle || "")
    .replace(/\s*[:|]\s*네이버\s*블로그\s*$/, "")
    .replace(/[\\/:*?"<>|]/g, "") // 공백이 아니라 지운다 — 짝 맞추기는 공백을 뺀 제목 조각으로 본다
    .replace(/\s+/g, " ")
    .trim();
  return `PAMS접수/${t || "네이버_캡처"}.pdf`;
}
