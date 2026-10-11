// 버튼 1번 — 지금 보고 있는 네이버 비공개 글 탭을 텍스트 PDF 로 인쇄해 Downloads\PAMS접수\ 에 저장한다.
// 그다음은 pams_auto(SHIN_PAMS_KIT, 10분 주기)가 짝 맞추기 · 원고 대조 · zip 을 한다.
//
// 하지 않는 것: 글쓰기·발행·공개 전환·클릭 자동화 · 쿠키·비밀번호 읽기 · 외부 전송.
// 사람이 로그인해 열어 둔 탭을 그대로 인쇄만 한다(Page.printToPDF — 크롬 인쇄와 같은 경로, 텍스트가 살아 있다).
import { checkTab, postViewUrl, captureName } from "./lib.js";

// 결과는 버튼 배지(OK / ! / X)와 버튼에 마우스를 올리면 보이는 설명으로 알린다.
const say = async (badge, message) => {
  await chrome.action.setBadgeText({ text: badge });
  await chrome.action.setTitle({ title: message });
};

async function frameSrc(tabId) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.querySelector("iframe#mainFrame")?.getAttribute("src") || null,
  });
  return r?.result ?? null;
}

async function hasPrivateMark(tabId) {
  const rs = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => (document.body?.innerText || "").includes("비공개"),
  });
  return rs.some((r) => r.result);
}

function waitLoaded(tabId) {
  return new Promise((resolve) => {
    const on = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(on);
        setTimeout(resolve, 1500); // 이미지·글꼴
      }
    };
    chrome.tabs.onUpdated.addListener(on);
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  const gate = checkTab(tab.url);
  if (!gate.ok) return say("X", "인쇄하지 않음 — " + gate.why);

  // PC 화면이면 본문 iframe 주소로 같은 탭을 연다(바깥 틀만 찍히는 것을 막는다).
  const inner = postViewUrl(await frameSrc(tab.id), tab.url);
  if (inner) {
    await chrome.tabs.update(tab.id, { url: inner });
    await waitLoaded(tab.id);
  }
  const marked = await hasPrivateMark(tab.id);
  const { title } = await chrome.tabs.get(tab.id);

  const target = { tabId: tab.id };
  await chrome.debugger.attach(target, "1.3");
  let data;
  try {
    ({ data } = await chrome.debugger.sendCommand(target, "Page.printToPDF", {
      printBackground: true,
      paperWidth: 8.27,
      paperHeight: 11.69, // A4
      marginTop: 0.47, marginBottom: 0.47, marginLeft: 0.39, marginRight: 0.39,
    }));
  } finally {
    await chrome.debugger.detach(target);
  }

  const filename = captureName(title);
  await chrome.downloads.download({
    url: "data:application/pdf;base64," + data,
    filename,
    conflictAction: "overwrite",
    saveAs: false,
  });
  await say(
    marked ? "OK" : "!",
    "PAMS접수에 저장 — " + filename.replace("PAMS접수/", "") +
      (marked ? "" : "\n화면에서 「비공개」 글자를 못 찾았습니다 — 비공개 상태가 PDF 에 보이는지 열어 확인하세요"),
  );
});
