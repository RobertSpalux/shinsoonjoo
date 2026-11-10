#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
상담 안내 한 줄 — 「쓸 때부터」 원고에 넣어 PAMS 심의를 같이 받는다 (LK1, 2026-11-10).

왜: 네이버 순방문은 늘었는데(주 227→433) 2주 유효 리드 0. 승인된 본진·네이버 80건 본문 어디에도
    카카오톡 채널로 가는 문장이 없었다. 로버트(11/10 15:59) 「어차피 쓸 때부터 넣어서 심의받으면 되잖아」.

규칙:
  · 모델은 「검색 의도 구절」(consult_intent) 하나만 쓴다. 문장의 나머지(채널 이름·「문의하실 수 있습니다」)와
    링크는 코드가 고정으로 붙인다 — KC1(CTA 사진 문구 코드 고정)과 같은 방식. 모델이 자유롭게 쓴 상담 유인 문장은
    draft_weekly 금소법 게이트(「상담 유인」)가 그대로 막는다. 이 정본 줄만 그 검사에서 뺀다.
  · 자리: 「한 줄 조언」 바로 뒤 한 곳(본문 끝). 키트 PDF·네이버 캡처에 그대로 보인다 = 심의 원고에 들어간다.
  · 안내형만: 「무료」·단정(가능합니다·받으실 수 있습니다)·약속(해 드립니다)·비교추천·다급함 금지.
  · 이미 심의받은 글에는 넣지 않는다(원안 변경). 새 원고와 아직 접수 전인 원고만.

  본진: …싶으시면, [카카오톡 채널 「신순주의선한금융」](http://pf.kakao.com/_xoxdBwX/chat)으로 문의하실 수 있습니다.
        클릭은 AnalyticsClient 가 kakao_click 으로 잰다(pf.kakao.com 링크 위임).
  네이버: …싶으시면, 카카오톡 채널 「신순주의선한금융」으로 문의하실 수 있습니다.
          https://goodfinance.kr/go/kakao?ref=<slug>      ← 다음 줄 URL. naver-rich 가 문장 전체에 링크를 건다.
        클릭은 /go/kakao 가 세고 카카오 채팅으로 보낸다(src/app/go/kakao/route.ts).
"""
import re

CHANNEL_NAME = "신순주의선한금융"                         # 카카오 채널 이름(PAMS 사전등록 「기타」 승인, pams_kakao.py)
KAKAO_CHAT_URL = "http://pf.kakao.com/_xoxdBwX/chat"     # brand.ts BRAND.social.kakaoChat 와 같은 값(시험이 대조)
GO_URL = "https://goodfinance.kr/go/kakao?ref={slug}"    # 네이버 → 클릭 집계 → 카카오 채팅
TAIL = f"카카오톡 채널 「{CHANNEL_NAME}」으로 문의하실 수 있습니다."
MAIN_TAIL = f"[카카오톡 채널 「{CHANNEL_NAME}」]({KAKAO_CHAT_URL})으로 문의하실 수 있습니다."

ADVICE_HEAD = re.compile(r"^(?:>\s*)?(?:▶\s*|\*\*)?신순주 지사장의 한 줄 조언")
INTENT_SHAPE = re.compile(r"^[가-힣0-9A-Za-z·,()\s]{10,70}싶으시면$")
INTENT_BANNED = [
    ("무료", re.compile(r"무료")),
    ("단정", re.compile(r"가능합니다|받으실\s*수\s*있|나옵니다|됩니다|보장됩니다")),
    ("약속", re.compile(r"해\s*드리|드립니다|챙겨\s*드|찾아\s*드|받게\s*해")),
    ("비교·추천", re.compile(r"추천|비교|더\s*나은|유리|순위")),
    ("다급함", re.compile(r"지금|바로|당장|늦기\s*전|서두|놓치")),
    ("절감 오인", re.compile(r"보험료를?\s*(?:줄|아끼|아낄|절감)|절감")),
    ("셀프체크", re.compile(r"이것만")),
]
# 글 주제(검색 의도) → 의도 구절 예시. 모델 프롬프트와 보고서 표가 같이 쓴다.
INTENT_EXAMPLES = [
    ("신경성형술 실비", "내 실손에서 신경성형술이 입원·통원 어느 쪽으로 보상되는지 계약을 펼쳐 함께 보고 싶으시면"),
    ("종신보험 만기·해지", "해지하기 전에 해약환급금과 유지 방법을 내 계약 기준으로 함께 점검하고 싶으시면"),
    ("위내시경 실비", "내 실손 약관에서 이번 검사가 어느 조항에 걸리는지 계약을 펼쳐 함께 보고 싶으시면"),
    ("실손 비갱신형", "내 실손의 보험료 갱신 주기와 다음 재가입 시점을 증권 기준으로 함께 보고 싶으시면"),
    ("사망보험금 유동화", "유동화 비율을 정하기 전에 전 계약의 사망보장 합계를 함께 보고 싶으시면"),
    ("부담보 해제", "내 계약의 부담보 조건과 해제 시점을 약관 기준으로 함께 보고 싶으시면"),
    ("연금 수령액", "내 연금 계약의 수령 형태와 개시 나이를 증권 기준으로 함께 보고 싶으시면"),
]


def check_intent(intent):
    """의도 구절 → 문제 목록(비면 통과). 순수 함수."""
    s = (intent or "").strip()
    if not s:
        return ["상담 안내 의도 구절(consult_intent)이 없다"]
    out = []
    if not INTENT_SHAPE.match(s):
        out.append(f"의도 구절 형식 — 10~70자, 「…싶으시면」으로 끝 (지금 「{s[:40]}」)")
    for name, rx in INTENT_BANNED:
        m = rx.search(s)
        if m:
            out.append(f"의도 구절 {name} 「{m.group(0)}」")
    return out


def naver_block(intent, slug):
    """네이버판에 넣을 두 줄(문장, URL)."""
    return f"{intent.strip()}, {TAIL}", GO_URL.format(slug=slug)


def main_line(intent):
    return f"{intent.strip()}, {MAIN_TAIL}"


def find_lines(text):
    """원고 안의 상담 안내 정본 줄(본진·네이버 둘 다). URL 줄은 포함하지 않는다."""
    return [ln.strip() for ln in (text or "").split("\n") if TAIL in ln or MAIN_TAIL in ln]


def intent_of(line):
    for tail in (MAIN_TAIL, TAIL):
        if line.endswith(tail):
            return line[: -len(tail)].rstrip().rstrip(",").strip()
    return None


def _advice_end(rows):
    """한 줄 조언 블록이 끝나는 줄 번호(그 블록 마지막 줄 다음). 없으면 None."""
    for i, ln in enumerate(rows):
        if ADVICE_HEAD.match(ln.strip()) or ln.strip() == "> <!-- advice -->":
            j = i + 1
            # 본진 blockquote(> …)는 「>」 줄이 이어지는 동안, 네이버는 빈 줄 전까지
            quote = ln.lstrip().startswith(">")
            while j < len(rows) and (rows[j].lstrip().startswith(">") if quote else rows[j].strip()):
                j += 1
            return j
    return None


def insert(text, intent, channel, slug):
    """원고에 상담 안내를 한 줄 조언 바로 뒤에 넣는다. 이미 있으면 그대로. → 새 원고. 한 줄 조언이 없으면 ValueError."""
    if find_lines(text):
        return text
    rows = text.split("\n")
    at = _advice_end(rows)
    if at is None:
        raise ValueError("한 줄 조언 블록이 없어 상담 안내 자리를 정할 수 없다")
    block = list(naver_block(intent, slug)) if channel == "naver" else [main_line(intent)]
    return "\n".join(rows[:at] + [""] + block + rows[at:])


def issues(text, channel, slug=None):
    """원고(본진·네이버) 상담 안내 검사 → 문제 목록. 정확히 1줄 · 의도 구절 규칙 · 자리(한 줄 조언 뒤) · 네이버는 다음 줄 URL."""
    lines = find_lines(text)
    if len(lines) != 1:
        return [f"상담 안내 줄 {len(lines)}개 — 정확히 1줄(한 줄 조언 바로 뒤)"]
    line = lines[0]
    out = [f"상담 안내 {m}" for m in check_intent(intent_of(line))]
    rows = [r.strip() for r in text.split("\n")]
    k = rows.index(line)
    end = _advice_end(text.split("\n"))
    if end is None or not (end <= k <= end + 1):
        out.append("상담 안내 자리 — 한 줄 조언 바로 뒤가 아니다")
    if channel == "naver":
        want = GO_URL.format(slug=slug) if slug else None
        nxt = rows[k + 1] if k + 1 < len(rows) else ""
        if not nxt.startswith("https://goodfinance.kr/go/kakao?ref=") or (want and nxt != want):
            out.append(f"네이버 상담 안내 다음 줄 URL — {want or 'https://goodfinance.kr/go/kakao?ref=<slug>'} 이어야 한다(클릭 집계)")
    elif MAIN_TAIL not in line:
        out.append("본진 상담 안내 — 카카오 채널 링크(마크다운) 형식이 아니다")
    return out
