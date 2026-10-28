#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
지식iN 질문 수집기 — 네이버 검색 API(kin)만 쓴다. 로그인·스크래핑·우회 없음.

    python scripts/kin_harvest.py                  # 수집 → %LOCALAPPDATA%\\SHIN\\kin_candidates.json + 요약 출력
    python scripts/kin_harvest.py --no-baseline    # 첫 실행에도 후보를 낸다(나이 「미확인」 표시)
    python scripts/kin_harvest.py --out <파일.json>

소재(우리 것만): 실손 청구 · 고지의무 · 부담보 · 간병 · 간편심사 · 리모델링 점검 · 갱신 보험료 · 보장 공백 · 연금 수령 · 치아.

🔴 API 가 주지 않는 것 — 지어내지 않는다(2026-10-09 실측: items 에 title·link·description 만 있다).
  · **작성일이 없다.** 그래서 「최근 7일」(FRESH_HOURS, KIN1 전 72시간)은 **우리 대장의 첫 관측 시각**으로 정한다.
    첫 실행은 보이는 질문을 전부 「기준선」으로 적고 후보로 내지 않는다(옛 질문이 새 질문 행세를 못 하게).
    그다음부터 대장에 없던 docId = 지난 바퀴 이후 새로 보인 질문. 첫 관측 72시간이 지나면 후보에서 빠진다.
  · **채택·마감 여부가 없다.** → 「마감」 칸은 늘 「미확인(API 미제공)」. 게시 직전 로버트가 화면에서 본다.
  · **답변 수가 없다.** 대신 link 의 answerNo(검색에 걸린 답변 번호)의 최댓값을 하한으로 쓴다.
    answerNo ≥ ANSWERS_MAX 면 「답변 다수」로 뺀다.
  · 질문 본문 전문이 없다. description 은 질문 또는 **남의 답변** 조각이다.
    🔴 KQ2(2026-10-19): 조각을 그대로 「요약」에 넣었더니 kin_answers.question_body 에 남의 답변
    (「[ 핵심 결론 ] 질문자님의…」「…상담 문의해 주시기 바랍니다」)이 들어가 초안이 질문이 아니라 남의 답을 보고 써졌다.
    → 「질문 본문」은 **질문 조각만** 모은다(question_snippet). 둘 다 지켜야 질문 조각으로 친다:
      ① link 에 answerNo 가 없다 — answerNo 가 붙은 결과는 그 답변에 걸린 검색 결과라 description 이 답변 조각이다.
      ② 조각에 답변 표지(ANSWER_LIKE_RE — 「질문자님」「핵심 결론」「문의해 주시기 바랍니다」 등)가 없다.
    🔴 KQ4(2026-10-19 실측): 승인 8건을 다시 받으니 **모든 결과에 answerNo 가 붙어 있었고**, description 은 질문 일부 +
      그 답변 일부가 섞인 조각이었다 → ①만으로는 질문 조각 0건. 그래서 ③ 서로 다른 answerNo 조각에 그대로 겹치는 글
      (shared_spans — 질문 글은 답변마다 되풀이된다)도 질문 조각으로 친다. answerNo=0 은 질문으로 친다([가설] 1건 관측).
    질문 조각이 하나도 없으면 그 질문은 후보에서 뺀다(「질문 본문 없음」) — 남의 답을 질문 대신 쓰지 않는다.
    「snippets」(전체 조각)는 소재·개인정보·회사명 제외 판정에만 쓰고, 초안·DB 에는 넘기지 않는다.
  · 질문 상세 페이지 GET 은 하지 않는다 — kin.naver.com/robots.txt(KQ3 2026-10-19 실측)가 ClaudeBot·anthropic-ai 등을
    Disallow: / 로 막고 AI 학습·RAG 목적 봇 접근을 금지한다. 사람이 원문을 옮기는 경로도 쓰지 않는다(KQ4 로버트).
    그래서 HTML 선택자가 아니라 검색 API 의 link·description 으로 가르고, 질문 의도는 제목 + 질문 조각으로만 잡는다
    (kin_pipeline.question_intent — 못 잡으면 후보에서 뺀다).

제외: 답변 다수 · 특정 회사·상품 비교/추천 요청 · 개인정보(전화·주민번호·이메일·증권번호)가 보이는 질문.
"""
import argparse
import html
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

KST = timezone(timedelta(hours=9))
STATE_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "SHIN")
LEDGER = os.path.join(STATE_DIR, "kin_seen.json")
CANDIDATES = os.path.join(STATE_DIR, "kin_candidates.json")
APIHUB = "https://naverapihub.apigw.ntruss.com/search/v1/kin"   # naver_research.py 와 같은 게이트웨이
# 🔴 KIN1(2026-10-29 실측): 10/26 부터 .env.local 키가 APIHUB·OPENAPI 둘 다 401 → 수집 0건인데 ✅ 로 보고됐다.
#    robert-os shared/.env 의 NAVER_CLIENT_ID/SECRET(네이버 개발자센터 키)는 OPENAPI 에서 200. 그 키를 먼저 쓴다.
OPENAPI = "https://openapi.naver.com/v1/search/kin.json"
SHARED_ENV = os.environ.get("ROBERT_OS_ENV", r"D:\robert-os\shared\.env")
FRESH_HOURS = 168    # KIN1 — 최근성 7일(첫 관측 기준). 더 새로운 질문은 kin_pipeline.score 가 위로 올린다
ANSWERS_MAX = 3      # 검색에 걸린 answerNo 가 이 이상이면 「답변 다수」
DISPLAY = 30
SLEEP = 0.15

# 소재 → 검색어. 소재 이름은 kin_pipeline 의 「같은 소재 반복 금지」 단위다.
TOPICS = {
    "실손청구": ["실비 청구", "실손보험 청구", "실비 청구 거절"],
    "고지의무": ["고지의무", "보험 가입 고지", "알릴의무 위반"],
    "부담보": ["부담보", "부담보 해제", "부담보 조건"],
    "간병": ["간병인보험", "간병비보험", "간병보험"],
    "간편심사": ["간편심사보험", "유병자보험", "간편보험 가입"],
    "리모델링점검": ["보험 리모델링", "보험 정리", "보험 중복 가입", "보험 점검"],
    # KIN1(2026-10-29 관제탑) — 갱신 보험료 · 보장 공백 · 연금 수령 · 치아
    "갱신보험료": ["갱신 보험료 인상", "갱신형 보험료", "실비 갱신 보험료"],
    "보장공백": ["보장 공백", "보험 보장 부족", "보장 부족 보험"],
    "연금수령": ["연금보험 수령", "연금저축보험 수령", "연금보험 연금 개시"],
    "치아": ["치아보험", "치아보험 청구", "치아보험 면책"],
}

COMPARE_RE = re.compile(r"비교|어디\s*가|어느\s*(?:회사|보험사|곳|상품)|추천|vs|VS|중에\s*(?:뭐|어떤|어느)|순위|갈아타")
PII_RE = re.compile(
    r"0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}"          # 전화
    r"|\d{6}\s*-\s*[1-4]\d{6}"                    # 주민번호
    r"|[\w.+-]+@[\w-]+\.[\w.]+"                   # 이메일
    r"|증권\s*번호|계약\s*번호"
)
# 「고지」「청구」 같은 검색어는 법률·노무 질문까지 끌고 온다(2026-10-09 첫 실수집: 후보 91건 중 다수가 폭행·상속·실업급여).
# 지식iN 분류 40103…(경제 > 금융 > 보험 — 실측 link 의 dirId 401030201·401030203·4010302) 이거나 제목에 보험 낱말이 있어야 한다.
INSURANCE_DIR = "40103"
ALLOW_DIRS = (INSURANCE_DIR,)
# 「고지의무」「고지사항」 단독은 제목 신호로 치지 않는다 — 부동산 중개·매매(공인중개사 고지의무)에도 쓰는 낱말이다
# (KQ1 2026-10-16: 「부동산 중개인 고지의무위반」 dirId=60103 이 이 낱말 하나로 통과해 심의까지 받았다).
INSURANCE_TITLE_RE = re.compile(r"보험|(?<!과)실비|실손|부담보(?!증)|(?:가입|상해|병력|질병)\s*(?:시\s*)?고지"
                                r"|알릴\s*의무|간병인?보험|간병인\s*가입|유병자|간편\s*심사|특약")
# 보험 맥락 낱말 — 제목+본문 조각에 하나는 있어야 한다. 「고지」「알릴 의무」는 넣지 않는다(다른 분야와 겹친다).
# 조각의 「실비」는 「실제 비용」 뜻이 많아 넣지 않는다(제목의 「실비」는 INSURANCE_TITLE_RE 가 본다).
CONTEXT_RE = re.compile(r"보험|실손|보장|담보|특약|약관|청구|가입|해지|납입|유병자|간편\s*심사")
# 부동산(601…)·법률(602…)·노무(610…)·대출(402…) 분류는 제목에 **우리 소재 낱말**(CORE_RE)이 있어야 남긴다
# (「간병인 낙상 보상책임」「부담보증」「4대보험 상실」「전세대출 보험」 — 2026-10-09 실수집에서 섞여 들어온 것,
#  「부동산 중개인 고지의무위반」 — 2026-10-16 KQ1).
OUTSIDE_DIRS = ("601", "602", "610", "402")
CORE_RE = re.compile(r"(?<!과)실비|실손|부담보(?!증)|고지\s*의무|알릴\s*의무|간병인?보험|유병자|간편\s*심사|리모델링")
# 우리 소재가 아닌 보험(공적보험·자동차·펫·급여) — 우리 낱말이 함께 있으면 남긴다(자동차 사고는 그래도 뺀다)
OFF_TOPIC_RE = re.compile(r"건강보험\s*(?:료|지역|직장|피부양)|국민연금|고용보험|산재보험|4대\s*보험|자동차보험|대인\s*접수|대물"
                          r"|펫\s*보험|강아지|고양이|반려|전세\s*대출|이혼|월급")
# 법률 질문은 보험 분류(dirId)로 올라오기도 하고, 답변 조각의 「실비」(= 실제 비용)가 실손청구 검색에 걸린다
# (「치매 어머니가 상속인인 경우 상속재산분할협의와 성년후견」 — 조각 「기본 실비가 수십만 원」). 분류와 무관하게
# 제목에 법률 낱말이 있고 보험 신호어가 없으면 뺀다.
# 시효·청구 기한은 보험 신호어가 있어도, 제목이든 본문 조각이든 걸리면 뺀다 — 기산점·중단 사유가 사안마다 달라
# 답변에서 사실을 검증할 수 없다(SH7 관제탑 결정).
DEADLINE_RE = re.compile(r"시효|청구\s*기한|청구기간|기한\s*(?:지나|넘)")
LEGAL_RE = re.compile(r"상속|후견|소송|고소|고발|합의금|이혼|양육비|채무|파산|회생|한정승인|유언|증여|형사|민사|변호사|판결|재판|"
                      + DEADLINE_RE.pattern)
# 보험 분류로 들어왔어도 제목·본문 조각 어디에도 보험 신호어가 없으면 뺀다. 조각의 「실비」 단독은 「실제 비용」 뜻이 많아
# 신호로 치지 않는다(제목의 「실비」는 INSURANCE_TITLE_RE 가 신호로 본다).
SIGNAL_RE = re.compile(r"보험|실손|부담보(?!증)|고지|알릴\s*의무|보장|담보|특약|유병자|간편\s*심사|보험금|청구")
# 답변 조각 표지 — 질문자는 자기 글에 이렇게 쓰지 않는다. KQ2 실측(kin_answers.question_body 에 들어간 남의 답변):
# 495435597 「[ 핵심 결론 ] 질문자님의 2년 6개월 전 검진 결과는…」 · 495514489 「…손해사정서 작성… 상담 문의해 주시기 바랍니다」
# 495555117 「[ 핵심 결론 ] 실손보험 가입이 거절되었더라도…」 · KQ1 회귀표 「…점검해 두셔야 합니다」.
# 표지가 없는 답변 조각(KQ1 「…냉혹한 구조를 모르고 가입 직후 병원에」)은 이 정규식으로 못 가린다 — ① answerNo 가 막는다.
ANSWER_LIKE_RE = re.compile(
    r"질문\s*자\s*(?:님|분)|핵심\s*결론|\[\s*(?:결론|답변|요약|정리)|결론부터|답변\s*드(?:립|리)|말씀\s*드리(?:면|자면)|"
    r"(?:문의|연락|상담)\s*(?:해\s*)?주시(?:기|면)|상담\s*(?:문의|신청|가능)|손해\s*사정\s*(?:사|서)|설계사\s*입니다|"
    r"도움이\s*되(?:셨|시길|었으면)|채택|참고\s*하시(?:기|면)|하셔야\s*합니다|두셔야\s*합니다|보셔야\s*합니다|"
    r"권해\s*드립|추천\s*드립|드리겠습니다|안녕하세요[^.?!]{0,30}(?:입니다|설계사|손해사정|전문)"
)
DOC_RX = re.compile(r"docId=(\d+)")
DIR_RX = re.compile(r"dirId=(\d+)")
ANS_RX = re.compile(r"answerNo=(\d+)")


def clean(s):
    return html.unescape(re.sub(r"</?b>", "", s or "")).strip()


def load_env(env_file=None):
    """pams_kit.load_env(저장소 .env.local). env_file 을 주면 그 파일의 값을 덧입힌다 —
    .env.local 이 없는 git worktree 에서 돌릴 때 본 저장소의 .env.local 을 가리키는 용도(읽기만)."""
    import pams_kit as kit
    env = kit.load_env()
    if env_file:
        with open(env_file, encoding="utf-8-sig") as fp:
            for line in fp:
                k, _, v = line.strip().partition("=")
                if k and v and not k.startswith("#"):
                    env[k.strip()] = v.strip().strip('"').strip("'")
    if not (env.get("NAVER_CLIENT_ID") and env.get("NAVER_CLIENT_SECRET")):
        raise SystemExit("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 이 없습니다(.env.local)")
    return env


def insurer_names():
    """banned-terms.ts INSURERS — 금지어 대장이 단일 출처(pams_threads 와 같은 파서)."""
    import preflight
    with open(preflight.BANNED_TS, encoding="utf-8") as f:
        ts = f.read()
    m = re.search(r"const INSURERS = \[(.*?)\];", ts, re.S)
    return re.findall(r'"([^"]+)"', m.group(1)) if m else []


REPLY_TS = os.path.join(os.path.dirname(HERE), "src", "lib", "compliance", "reply-terms.ts")
def disease_dict(path=REPLY_TS):
    """reply-terms.ts DISEASES·DRUG_BRANDS·DISEASE_SUFFIX·NOT_DISEASE — 되받기 게이트와 같은 사전(단일 출처)."""
    with open(path, encoding="utf-8") as f:
        ts = f.read()

    def arr(name):
        m = re.search(rf"const {name} = \[(.*?)\];", ts, re.S)
        return re.findall(r'"([^"]+)"', m.group(1)) if m else []
    m = re.search(r"const DISEASE_SUFFIX\s*=\s*/(.+?)/g;", ts)
    return arr("DISEASES"), arr("DRUG_BRANDS"), re.compile(m.group(1)) if m else None, arr("NOT_DISEASE")


def title_disease(title, dicts=None):
    """제목의 병명·약 상품명(첫 것) 또는 None. 게이트가 되받기로 어차피 막으니 수집 단계에서 뺀다(SH6).
    게이트(reply-terms diseasesIn)와 같은 판정 — 「암」은 「암보험」「암진단비」에도 들어 있지만 게이트가 답변의 「암」을
    되받기로 막으므로 여기서도 뺀다(SH6 실수집 「암진단비를 줄이고 싶은데」 3회차까지 막힘)."""
    diseases, drugs, suffix, not_disease = dicts or disease_dict()
    t = title or ""
    for d in drugs + diseases:
        if d in t:
            return d
    if suffix:
        for m in suffix.finditer(t):
            if not any(m.group(0).endswith(x) for x in not_disease):
                return m.group(0)
    return None


# ── 순수 함수(테스트 대상) ─────────────────────────────────────
def question_url(link):
    """답변 앵커(answerNo)를 뗀 질문 URL. docId 가 없으면 None."""
    d, r = DOC_RX.search(link or ""), DIR_RX.search(link or "")
    if not d:
        return None
    base = "https://kin.naver.com/qna/detail.naver?"
    return base + (f"dirId={r.group(1)}&" if r else "") + f"docId={d.group(1)}"


def question_snippet(link, snip):
    """이 검색 결과의 description 이 **질문자 글** 조각인가(모듈 머리말 KQ2 — answerNo 없음 + 답변 표지 없음).
    answerNo=0 도 질문으로 친다(KQ4 실측 — 495435597 의 answerNo=0 조각이 질문 본문 그대로였다. [가설] 1건 관측)."""
    a = ANS_RX.search(link or "")
    return bool(snip) and (not a or a.group(1) == "0") and not ANSWER_LIKE_RE.search(snip)


# ── 여러 답변 조각에 겹치는 글 = 질문 본문(KQ4 2026-10-19 실측) ─────────────
# 10/19 승인 8건을 검색 API 로 다시 받아 보니 **모든 결과에 answerNo 가 붙어 있었다**(0 포함). description 은
# 「질문 본문 일부 … 그 답변 일부」가 섞인 조각이라 KQ2 필터(answerNo 없음)만으로는 질문 조각이 0건 → 전 후보가
# 「질문 본문 없음」으로 빠진다. 그런데 질문 본문은 **답변마다 같은 글로 되풀이**되고, 답변 글은 그 답변에만 있다.
# → 서로 다른 answerNo 조각 두 개 이상에 SHARED_MIN 자 이상 그대로 겹치는 부분만 질문 본문으로 쓴다.
#   한 답변에만 있는 글(남의 답변·우리 답변)은 들어오지 않는다. 겹친 글에도 답변 표지가 있으면 버린다.
SHARED_MIN = 12


def shared_spans(descs_by_answer, n=SHARED_MIN):
    """{answerNo: [description…]} → 서로 다른 답변 조각에 n 자 이상 겹치는 글(나온 순서, 포함 관계 중복 제거)."""
    from difflib import SequenceMatcher
    found = []
    keys = list(descs_by_answer)
    for x in keys:
        for d in descs_by_answer[x]:
            marks = []
            for y in keys:
                if y == x:
                    continue
                for e in descs_by_answer[y]:
                    sm = SequenceMatcher(None, d, e, autojunk=False)
                    marks += [(m.a, m.a + m.size) for m in sm.get_matching_blocks() if m.size >= n]
            marks.sort()
            merged = []
            for s, t in marks:
                if merged and s <= merged[-1][1]:
                    merged[-1][1] = max(merged[-1][1], t)
                else:
                    merged.append([s, t])
            for s, t in merged:
                for piece in re.split(r"\.{2,}|…", d[s:t]):
                    piece = piece.strip(" .,")
                    if len(piece) >= n and not ANSWER_LIKE_RE.search(piece):
                        found.append(piece)
    out = []
    for p in sorted(found, key=len, reverse=True):   # 긴 것부터 — 이미 고른 글에 들어 있는 조각은 버린다
        if not any(p in q for q in out):
            out.append(p)
    order = {p: min(i for i, f in enumerate(found) if f == p) for p in out}
    return sorted(out, key=order.get)


def group_items(items_by_topic):
    """{소재: [API item]} → {docId: 질문}. 같은 질문이 여러 답변·여러 소재로 걸려도 하나로 묶는다.
    snippets = 모든 조각(제외 판정용) · body = 질문 조각만(초안·DB 용, question_snippet + 답변 조각끼리 겹친 글 shared_spans)."""
    out, by_answer = {}, {}
    for topic, items in items_by_topic.items():
        for it in items:
            link = it.get("link") or ""
            d = DOC_RX.search(link)
            if not d:
                continue
            doc = d.group(1)
            a, r = ANS_RX.search(link), DIR_RX.search(link)
            q = out.setdefault(doc, {"docId": doc, "dirId": r.group(1) if r else "", "url": question_url(link),
                                     "title": clean(it.get("title")), "snippets": [], "body": [], "topics": [],
                                     "answers_seen": 0})
            snip = clean(it.get("description"))
            if snip and snip not in q["snippets"]:
                q["snippets"].append(snip)
            if question_snippet(link, snip) and snip not in q["body"]:
                q["body"].append(snip)
            elif a and snip:
                descs = by_answer.setdefault(doc, {}).setdefault(a.group(1), [])
                if snip not in descs:
                    descs.append(snip)
            if topic not in q["topics"]:
                q["topics"].append(topic)
            if a:
                q["answers_seen"] = max(q["answers_seen"], int(a.group(1)))
    for doc, descs in by_answer.items():
        for s in shared_spans(descs):
            if not any(s in b for b in out[doc]["body"]):
                out[doc]["body"].append(s)
    return out


def scope_exclusion(title, text, dir_id):
    """보험 질문인지 두 겹으로 본다 — 분류(허용·차단 dirId)와 제목, 그리고 제목+조각의 보험 맥락 낱말.
    제외 사유 또는 None. kin_pipeline 이 키트를 만들기 직전에 한 번 더 부른다."""
    d, title = str(dir_id or ""), title or ""
    allowed = d.startswith(ALLOW_DIRS)
    if not (allowed or INSURANCE_TITLE_RE.search(title)):
        return "보험 질문 아님(분류·제목)"
    if not (CONTEXT_RE.search(text or "") or re.search(r"(?<!과)실비", title)
            or (allowed and SIGNAL_RE.search(text or ""))):   # 보험 분류 안에서는 「고지의무」도 보험 뜻이다
        return "보험 맥락 낱말 없음(겹치는 낱말 단독)"
    if d.startswith(OUTSIDE_DIRS) and not (CORE_RE.search(title) and re.search(r"보험|(?<!과)실비|실손", title)):
        return "부동산·법률·노무·대출 분류(제목에 보험·우리 소재 낱말 없음)"
    return None


def exclusion(q, insurers=(), dicts=None):
    """제외 사유(문자열) 또는 None. dicts = disease_dict() 결과(없으면 읽는다)."""
    text = q["title"] + " " + " ".join(q["snippets"])
    d, title = str(q.get("dirId") or ""), q["title"]
    if not (d.startswith(ALLOW_DIRS) or INSURANCE_TITLE_RE.search(title)):
        return "보험 질문 아님(분류·제목)"
    if DEADLINE_RE.search(text):
        return "법률(시효·기한) — 사실 검증 불가"
    legal = LEGAL_RE.search(title)
    if legal and not INSURANCE_TITLE_RE.search(title):
        return f"법률 질문({legal.group(0)}) — 제목에 보험 신호어 없음"
    if not (INSURANCE_TITLE_RE.search(title) or SIGNAL_RE.search(text)):
        return "보험 분류지만 제목·본문에 보험 신호어 없음"
    scope = scope_exclusion(title, text, d)   # 맥락 낱말 · 차단 분류
    if scope:
        return scope
    if OFF_TOPIC_RE.search(title) and not (CORE_RE.search(title) and not re.search(r"대인|대물|자동차", title)):
        return f"우리 소재 아님({OFF_TOPIC_RE.search(title).group(0)})"
    dz = title_disease(title, dicts)
    if dz:
        return f"제목 병명 — 되받기 불가피({dz})"
    if q["answers_seen"] >= ANSWERS_MAX:
        return f"답변 다수(answerNo≥{q['answers_seen']})"
    m = COMPARE_RE.search(q["title"])
    if m:
        return f"비교·추천 요청({m.group(0)})"
    hit = next((n for n in insurers if n and n in text), None)
    if hit:
        return f"특정 회사 언급({hit})"
    if PII_RE.search(text):
        return "개인정보 노출"
    if "body" in q and not q["body"]:   # KQ2 — 검색 조각이 남의 답변뿐이면 질문자가 무엇을 물었는지 모른다
        return "질문 본문 없음(검색 조각이 답변뿐)"
    return None


def apply_ledger(questions, ledger, now, baseline_if_empty=True):
    """대장에 첫 관측 시각을 적고 → (후보 목록, 기준선이었나). ledger 를 고쳐서 돌려준다."""
    first_run = not ledger.get("seen")
    seen = ledger.setdefault("seen", {})
    baseline = first_run and baseline_if_empty
    for doc in questions:
        seen.setdefault(doc, {"first": now.isoformat(), "baseline": baseline})
    cutoff = now - timedelta(hours=FRESH_HOURS)
    out = []
    for doc, q in questions.items():
        rec = seen[doc]
        if rec.get("baseline"):
            continue
        first = datetime.fromisoformat(rec["first"])
        if first < cutoff:
            continue
        q = dict(q)
        q["first_seen"] = rec["first"]
        q["age"] = "미확인(첫 실행)" if first_run else f"첫 관측 {int((now - first).total_seconds() // 3600)}시간 전"
        out.append(q)
    # 오래된 기록은 정리(60일) — 대장이 끝없이 커지지 않게. 지운 질문이 검색에 다시 걸리면 「새 질문」으로
    # 보이므로 넉넉히 둔다(최신순 30건 안에 두 달 묵은 질문이 다시 걸리는 일은 드물다). 기준선 표시는 남긴다.
    old = now - timedelta(days=60)
    for doc in [d for d, r in seen.items() if datetime.fromisoformat(r["first"]) < old and not r.get("baseline")]:
        seen.pop(doc)
    return out, baseline


def summarize(q):
    """질문 본문(질문 조각만 — KQ2·KQ4). 답변 조각은 넣지 않는다. 400자 — 의도 게이트(묻는 것·상황)가 볼 만큼."""
    s = " / ".join(q.get("body", []))
    return (s[:SUMMARY_MAX] + "…") if len(s) > SUMMARY_MAX else s


SUMMARY_MAX = 400


# ── 수집 ────────────────────────────────────────────────────
def shared_naver_keys(path=SHARED_ENV):
    """robert-os shared/.env 의 NAVER_CLIENT_ID·SECRET(네이버 개발자센터 키) — 없으면 (None, None). 값은 출력하지 않는다."""
    keys = {}
    try:
        with open(path, encoding="utf-8-sig") as fp:
            for line in fp:
                k, _, v = line.strip().partition("=")
                if k.strip() in ("NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET") and v:
                    keys[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return keys.get("NAVER_CLIENT_ID"), keys.get("NAVER_CLIENT_SECRET")


def routes(env, shared=None):
    """시도 순서 [(이름, URL, 헤더)] — ① shared/.env 키 → 개발자센터 OPENAPI ② .env.local 키 → OPENAPI ③ .env.local 키 → APIHUB."""
    sid, ssec = shared if shared is not None else shared_naver_keys()
    lid, lsec = env.get("NAVER_CLIENT_ID", ""), env.get("NAVER_CLIENT_SECRET", "")
    out = []
    if sid and ssec:
        out.append(("openapi(shared)", OPENAPI, {"X-Naver-Client-Id": sid, "X-Naver-Client-Secret": ssec}))
    if lid and lsec:
        out.append(("openapi(.env.local)", OPENAPI, {"X-Naver-Client-Id": lid, "X-Naver-Client-Secret": lsec}))
        out.append(("apihub(.env.local)", APIHUB, {"X-NCP-APIGW-API-KEY-ID": lid, "X-NCP-APIGW-API-KEY": lsec}))
    return out


def search(env, query, display=DISPLAY, routes_=None, get=None):
    """첫 200 응답의 items. 모두 실패하면 RuntimeError(경로별 HTTP 상태) — 조용히 0건이 되지 않게(KIN1)."""
    get = get or requests.get
    tried = []
    for name, url, headers in (routes_ if routes_ is not None else routes(env)):
        r = get(url, params={"query": query, "display": display, "start": 1, "sort": "date"}, headers=headers, timeout=15)
        if r.status_code == 200:
            return r.json().get("items", [])
        tried.append(f"{name} {r.status_code}")
    raise RuntimeError("네이버 검색 API 실패 — " + (" · ".join(tried) or "키 없음(shared/.env·.env.local)"))


def collect(env, now=None, baseline_if_empty=True, search_fn=None, ledger_path=LEDGER):
    now = now or datetime.now(KST)
    live = search_fn is None
    search_fn = search_fn or (lambda q: search(env, q))
    by_topic, errors, n_queries = {}, [], 0
    for topic, queries in TOPICS.items():
        items = []
        for q in queries:
            n_queries += 1
            try:
                items += search_fn(q)
            except Exception as e:  # noqa: BLE001 — 한 검색어 실패가 수집 전체를 막지 않는다
                errors.append(f"{q}: {e}")
            if live:
                time.sleep(SLEEP)
        by_topic[topic] = items
    questions = group_items(by_topic)
    try:
        ledger = json.load(open(ledger_path, encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        ledger = {}
    fresh, baseline = apply_ledger(questions, ledger, now, baseline_if_empty)
    insurers, dicts = insurer_names(), disease_dict()
    cands, dropped = [], []
    for q in fresh:
        why = exclusion(q, insurers, dicts)
        row = {"url": q["url"], "docId": q["docId"], "title": q["title"], "summary": summarize(q),
               "topic": q["topics"][0], "topics": q["topics"], "answers_seen": q["answers_seen"],
               "age": q["age"], "first_seen": q["first_seen"], "closed": "미확인(API 미제공)"}
        (dropped if why else cands).append({**row, "excluded": why} if why else row)
    os.makedirs(os.path.dirname(ledger_path), exist_ok=True)
    with open(ledger_path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(ledger, f, ensure_ascii=False)
    os.replace(ledger_path + ".tmp", ledger_path)
    return {"at": now.isoformat(), "baseline": baseline, "seen_total": len(questions),
            "candidates": cands, "excluded": dropped, "errors": errors, "queries": n_queries}


def main():
    ap = argparse.ArgumentParser(description="지식iN 질문 수집(네이버 검색 API)")
    ap.add_argument("--no-baseline", action="store_true", help="첫 실행에도 후보를 낸다(나이 미확인)")
    ap.add_argument("--out", default=CANDIDATES)
    ap.add_argument("--ledger", default=LEDGER, help="첫 관측 대장(시험용으로 바꿀 때만)")
    ap.add_argument("--env-file", help="다른 .env.local 을 읽는다(worktree 에서 돌릴 때)")
    a = ap.parse_args()
    res = collect(load_env(a.env_file), baseline_if_empty=not a.no_baseline, ledger_path=a.ledger)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    json.dump(res, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"질문 {res['seen_total']}건 관측 · 후보 {len(res['candidates'])} · 제외 {len(res['excluded'])}"
          + (" · 첫 실행 — 기준선만 적음(다음 바퀴부터 후보)" if res["baseline"] else "")
          + (f" · 검색 실패 {len(res['errors'])}" if res["errors"] else ""))
    for c in res["candidates"][:20]:
        print(f"- [{c['topic']}] {c['title']}  {c['url']}  ({c['age']} · 답변≥{c['answers_seen']} · 마감 {c['closed']})")
    print(f"→ {a.out}")


if __name__ == "__main__":
    main()
