#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
주제 중복 검사 — 이미 있는 글(발행·초안 전부)·TOPIC-BANK ✅ 항목과 겹치면 **생성을 거부**한다.

    python scripts/topic_guard.py --title "회사 실손 있는데 개인 실손도 내야 하나" [--naver-title …] [--slug …]
    → 겹치면 exit 1 + 이유. 통과면 exit 0.

왜: 2026-09-30 하루에 두 번(8호 제안 「부담보 해제」 = 이미 5호 발행 · 10호 지시 「단체실손 중지·재개」 = 9/22 발행)
    이미 낸 주제를 다시 쓰라는 지시가 내려왔다. 사람 기억·표(TOPIC-BANK)로는 못 막는다 → 코드가 막는다.
    **관제탑 지시라도 막는다.** 일부러 나눠 쓰는 경우만 configs/topic_guard_allow.json 에 (새 slug, 기존 slug, 이유)를
    적어 통과시킨다 — 기록 없이 넘어가는 길은 없다.

붙는 곳: ① scripts/draft_insert.py(초안 저장) ② scripts/pams_kit.py build_kit(키트 생성).

판정(순수 함수 — 시험 대상):
  · 핵심어 = 제목·네이버 제목·slug 에서 조사·흔한 말(보험·실손·실비…)을 뺀 낱말.
  · 서술어(받았는데·나오나요·줄었나요…)는 핵심어 수에는 그대로 세되 **겹친 말·주제어로는 치지 않는다**(is_predicate).
    「받았는데」가 글 한 편에만 있다는 이유로 주제어가 되어 12호(본인부담상한제 환급금) 제목이
    7호(장기요양 등급)와 겹친다고 막힌 오탐(2026-09-30)이 있었다.
    핵심어 집합에서 아예 빼지 않는 이유: 집합이 작아지면 겹침 비율이 올라가 일부러 나눠 쓴 글(8호↔9호)이 서로 걸린다(실측).
  · 기간·숫자 낱말(3개월·1년·30일·7개·12회…)도 같은 대접을 한다(is_measure). 16호(해외 체류 3개월 이상 실손보험료 환급)
    제목이 전환 철회 글(「…병원에 다녀왔다면 3개월」)과 「3개월」 하나로 주제어 겹침 판정을 받은 오탐(2026-10-01)이 있었다.
    「5세대」처럼 숫자 뒤에 명사가 붙은 말은 기간·숫자 낱말이 아니다(주제어로 남는다).
  · 주제어: 기존 글 한 편에만 나오는 3글자 이상 핵심어가 겹치면 같은 주제(「부담보 해제」 ↔ 「부담보 5년 지났는데…」).
  · 겹침: 공통 핵심어 2개 이상이면서 작은 쪽의 40% 이상 / 또는 공통 1개라도 작은 쪽의 절반 이상(「부담보 해제」 같은 짧은 주제)
          / 또는 제목 글자 2-gram Dice ≥ 0.5 / 또는 slug 낱말 Jaccard ≥ 0.5.
"""
import argparse
import json
import os
import re
import sys

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_kit as kit  # noqa: E402

TOPIC_BANK = os.path.join(kit.ROOT, "TOPIC-BANK.md")
ALLOW_JSON = os.path.join(kit.ROOT, "configs", "topic_guard_allow.json")

# 어느 글에나 나오는 말 — 주제를 가르지 못한다
GENERIC = {
    "보험", "실손", "실비", "실손보험", "실비보험", "보장", "가입", "청구", "내", "내야", "하나", "하나요", "있는데", "되나", "되나요",
    "무엇", "어느", "쪽이", "기준", "기준은", "정리", "총정리", "방법", "경우", "아니라", "입니다", "합니다", "있나요", "있습니다",
    "왜", "언제", "얼마", "어디까지", "계속", "앞으로", "보험료가", "알려야", "하는", "것과", "아닌", "것", "수", "법", "그리고",
    "2026", "2026년", "바뀐", "되는", "안", "때", "vs", "총", "들어", "나오나요", "나올까", "어떻게", "뭐가", "다른가",
}
# 서술어 — 주제를 가르지 못하는 말. 어미 꼴(받았는데·지났는데·줄었나요·풀렸을까·갈립니다·다녀왔다면 …)과
#   어미 규칙에 안 걸리는 묻는 말·이어 주는 말(PREDICATE_WORDS).
#   명사를 잘못 잡지 않게 두 글자 이상 어미만 적는다. 끝의 「요」는 조사 처리로 이미 떨어진 꼴(줄었나)도 잡는다.
PREDICATE = re.compile(
    r"(는데|은데|던데|나요|가요|까요|을까|일까|할까|될까|습니다|입니다|합니다|됩니다|립니다|릅니다|니다|세요|어요|아요|에요|예요|"
    r"지만|으면|다면|려면|더니|거나|든지|는지|은지|을지|었다|았다|였다|했다|된다|한다|었나|았나|였나|했나|리나|오나)$")
PREDICATE_WORDS = {"받나", "받을", "받은", "받는", "나오는", "나온", "해야", "어떤", "이유", "차이", "무슨", "이런", "그런", "정말", "꼭"}
JOSA = re.compile(r"(으로|에서|에게|까지|부터|이나|보다|처럼|은|는|이|가|을|를|도|에|의|와|과|로|만|나|요)$")
SLUG_GENERIC = {"insurance", "guide", "check", "2026", "by", "or", "vs", "and", "the", "silson", "rider", "benefit"}


# ── 순수 판정 ────────────────────────────────────────────────
def terms(text):
    """핵심어 집합 — 한글·영숫자 낱말에서 조사와 흔한 말을 뺀다."""
    out = set()
    for w in re.findall(r"[0-9A-Za-z가-힣]+", text or ""):
        if w in GENERIC:
            continue
        s = JOSA.sub("", w) if len(w) >= 3 else w
        if len(s) >= 2 and s not in GENERIC:
            out.add(s)
    return out


def is_predicate(w):
    """서술어인가 — 겹친 말·주제어에서 뺀다."""
    return w in PREDICATE_WORDS or (len(w) >= 3 and bool(PREDICATE.search(w)))


# 기간·횟수·수량 — 숫자 + 단위 한 덩어리만(「5세대」「2호」처럼 뒤에 명사가 붙은 말은 아니다)
MEASURE = re.compile(r"^\d+(?:[.,]\d+)?(?:개월|달|년|일|주|회|번|세|살|시간|분|개|건|명|%|만원|원|억원|억|배)?$")
MEASURE_WORDS = {"한달", "두달", "석달", "넉달", "반년", "하루", "이틀", "사흘", "일주일", "한번", "두번"}


def is_measure(w):
    """기간·숫자 낱말인가 — 서술어처럼 겹친 말·주제어에서 뺀다."""
    return w in MEASURE_WORDS or bool(MEASURE.match(w))


def is_filler(w):
    return is_predicate(w) or is_measure(w)


def shared_terms(a, b):
    """부분 포함도 같은 말로 본다(단체실손 ⊃ 단체, 간병비보험 ⊃ 간병)."""
    hit = set()
    for x in a:
        for y in b:
            if x == y or (len(x) >= 2 and len(y) >= 2 and (x in y or y in x)):
                hit.add(min(x, y, key=len))
    return hit


def bigram_dice(a, b):
    ca, cb = re.sub(r"[^0-9A-Za-z가-힣]", "", a or ""), re.sub(r"[^0-9A-Za-z가-힣]", "", b or "")
    A, B = {ca[i:i + 2] for i in range(len(ca) - 1)}, {cb[i:i + 2] for i in range(len(cb) - 1)}
    return 2 * len(A & B) / (len(A) + len(B)) if A and B else 0.0


def slug_jaccard(a, b):
    A = {w for w in (a or "").lower().split("-") if w and w not in SLUG_GENERIC and not w.isdigit()}
    B = {w for w in (b or "").lower().split("-") if w and w not in SLUG_GENERIC and not w.isdigit()}
    return len(A & B) / len(A | B) if A and B else 0.0


def compare(cand, other):
    """cand·other: {slug?, title, naver_title?} → (겹침?, 이유). other 는 {text} 만 있어도 된다(TOPIC-BANK 줄)."""
    ct = terms(" ".join(filter(None, [cand.get("title"), cand.get("naver_title")])))
    ot = terms(" ".join(filter(None, [other.get("title"), other.get("naver_title"), other.get("text")])))
    sh = {w for w in shared_terms(ct, ot) if not is_filler(w)}
    small = min(len(ct), len(ot)) or 1
    ratio = len(sh) / small
    if len(sh) >= 2 and ratio >= 0.4:
        return True, f"핵심어 {len(sh)}개 겹침({', '.join(sorted(sh))})"
    if len(sh) >= 1 and ratio >= 0.5:
        return True, f"짧은 주제의 핵심어가 그대로 겹침({', '.join(sorted(sh))})"
    d = max(bigram_dice(cand.get("title"), other.get("title") or other.get("text")),
            bigram_dice(cand.get("naver_title"), other.get("naver_title")) if cand.get("naver_title") and other.get("naver_title") else 0)
    if d >= 0.5:
        return True, f"제목 글자 겹침 {d:.2f}"
    j = slug_jaccard(cand.get("slug"), other.get("slug"))
    if j >= 0.5:
        return True, f"slug 낱말 겹침 {j:.2f}"
    return False, ""


def bank_done_rows(md_text):
    """TOPIC-BANK 의 ✅ 표 줄 → [{text, slug?, line}] — 시드 표(주제·검색어 각도)와 발행 표(slug·제목) 둘 다."""
    out = []
    for n, line in enumerate((md_text or "").splitlines(), 1):
        if not line.lstrip().startswith("|") or "✅" not in line:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        slugs = re.findall(r"`([a-z0-9][a-z0-9-]{5,})`", line)
        body = [c for c in cells if "✅" not in c and not re.fullmatch(r"[A-Z]\d+|\*\*.*\*\*", c)]
        text = " ".join(re.sub(r"[`*~]|\([^)]*\)", " ", c) for c in body[:3])
        text = re.sub(r"[a-z0-9]+(?:-[a-z0-9]+){2,}", " ", text)   # slug 글자는 핵심어에서 뺀다
        if terms(text):
            out.append({"text": text, "slugs": slugs, "line": n})
    return out


def check(cand, articles, bank_rows, allow=None):
    """→ [충돌 설명]. 비어 있으면 통과. 자기 자신(slug·id 같음)과 allow 에 적힌 짝은 뺀다."""
    allow = allow or []
    ok_pairs = {(a.get("new"), a.get("existing")) for a in allow}
    hits = []
    others = [o for o in articles
              if not ((cand.get("id") and o.get("id") == cand.get("id")) or (cand.get("slug") and o.get("slug") == cand.get("slug")))]
    # 주제어 = 기존 글 **한 편에만** 나오는 3글자 이상 핵심어(부담보·도수치료·장기요양 …). 그 말이 겹치면 같은 주제로 본다.
    #   **본진 제목끼리만** 본다 — 네이버 제목까지 넣으면 일부러 나눠 쓴 글(2호↔5호 「부담보」, 8호↔9호 「선택형」)이 서로 걸린다.
    tsets = [terms(o.get("title") or "") for o in others]
    ct = terms(cand.get("title") or "")
    for o, ot in zip(others, tsets):
        dup, why = compare(cand, o)
        if not dup:
            keys = sorted(w for w in (ct & ot)   # 정확히 같은 말만(「치료」 ⊂ 「도수치료」 같은 부분 포함은 주제어로 안 친다)
                          if len(w) >= 3 and not is_filler(w) and sum(1 for s in tsets if w in s) == 1)
            if keys:
                dup, why = True, f"주제어 겹침({', '.join(keys)}) — 이 말은 기존 글 중 이 글에만 있다"
        if dup and (cand.get("slug"), o.get("slug")) not in ok_pairs:
            state = "발행됨" if o.get("is_main_published") else "초안"
            hits.append(f"기존 글({state}) `{o.get('slug')}` 「{o.get('title')}」 — {why}")
    for r in bank_rows:
        if cand.get("slug") and cand["slug"] in r.get("slugs", []):
            continue   # 자기 글의 발행 기록 줄
        if any(s in {o.get("slug") for o in articles} for s in r.get("slugs", [])) and any(
                f"`{s}`" in h for h in hits for s in r.get("slugs", [])):
            continue   # 같은 글을 이미 위에서 잡았다 — 두 번 말하지 않는다
        dup, why = compare(cand, r)
        if dup and not any((cand.get("slug"), s) in ok_pairs for s in r.get("slugs", [])):
            hits.append(f"TOPIC-BANK {r['line']}행 ✅ 「{r['text'].strip()[:60]}」 — {why}")
    return hits


# ── 조회 · 실행 ───────────────────────────────────────────────
def fetch_articles(env):
    url, h = kit._rest(env)
    return requests.get(url, params={"select": "id,slug,title,naver_title,is_main_published"}, headers=h, timeout=30).json()


def load_allow(path=ALLOW_JSON):
    try:
        return json.load(open(path, encoding="utf-8")).get("allow", [])
    except FileNotFoundError:
        return []


def guard(env, cand, skip_bank=False):
    """겹치면 kit.KitError. 초안 저장·키트 생성이 부른다.
    skip_bank: 이미 접수·승인 이력이 있는 글(자리 잡은 주제)은 TOPIC-BANK 줄과 대조하지 않는다 —
               그 글을 가리키는 「○호에 통합」 줄에 걸려 자기 자신에게 막히지 않게. 다른 글과의 대조는 그대로 한다."""
    bank = [] if skip_bank or not os.path.exists(TOPIC_BANK) else bank_done_rows(open(TOPIC_BANK, encoding="utf-8").read())
    hits = check(cand, fetch_articles(env), bank, load_allow())
    if hits:
        raise kit.KitError("주제 중복 — 생성하지 않습니다:\n  · " + "\n  · ".join(hits)
                           + "\n  (일부러 나눠 쓰는 글이면 configs/topic_guard_allow.json 에 new·existing·reason 을 적는다)",
                           gate=True)   # gate=True → pams_auto 가 같은 원고로 10분마다 다시 시도·알림하지 않는다


def guard_article(env, article):
    """키트 생성용 — DB 행 그대로 받아 검사한다."""
    established = any(r.get("status") in ("submitted", "under_review", "approved") for r in (article.get("ad_reviews") or []))
    guard(env, {"id": article.get("id"), "slug": article.get("slug"), "title": article.get("title"),
                "naver_title": article.get("naver_title")}, skip_bank=established)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", required=True)
    ap.add_argument("--naver-title")
    ap.add_argument("--slug")
    a = ap.parse_args()
    try:
        guard(kit.load_env(), {"title": a.title, "naver_title": a.naver_title, "slug": a.slug})
    except kit.KitError as e:
        print(str(e))
        sys.exit(1)
    print("통과 — 겹치는 글·TOPIC-BANK ✅ 항목 없음")


if __name__ == "__main__":
    main()
