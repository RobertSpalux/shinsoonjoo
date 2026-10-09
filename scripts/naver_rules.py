#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
네이버 규칙 10 기계 검사 — WRITING-SPEC §4-4 「네이버 채널」(2026-10-09 TR2 실측).

    python scripts/naver_rules.py --title "…" [--keyword "…"] [--naver-txt 파일]   # 제목·원고 단독 검사
    python scripts/naver_rules.py --plan                                            # 승부 키워드 15 제안 제목 전수 검사

왜: TR2(2026-10-09) — 네이버 블로그 탭 상위 60편 중앙값이 제목 34자·본문 2,775자(공백 제외)·FAQ 31/60·
    요약 28/60·내부링크 24/60 였다. 우리는 45~50자 「— 부제」형 제목에 2,238자·FAQ 0·요약 0·내부링크 0.
    프롬프트에 적는 것만으로는 안 지켜진다(제목 30자 이내 지시가 있었는데도 45~50자가 나갔다) → 코드가 잰다.

검사 6종(순수 함수 — test_naver_rules.py):
  ① 제목 길이 30~40자(공백 포함)          ② 키워드 낱말 전부 + 첫 낱말이 맨 앞(5자 안)
  ③ 제목 특수문자 ' ? " & 금지(팜스 게시명 규칙 — 게시명 = 실제 제목이어야 한다, CLAUDE.md §6.4)
  ④ 본문 공백 제외 2,500~3,500자          ⑤ 「자주 묻는 질문 N가지」 아래 Q. 3개 이상 + 「핵심 요약」 줄
  ⑥ 내부링크(우리 네이버 글·본진 기사 URL) 2~3개 — 4개 이상은 경고

⚠️ 심의 규칙이 이긴다. 이 검사는 §6.10 금지어·금액·출처 검사를 대신하지 않는다(그건 preflight 다른 항목).
⚠️ 키워드 정본 = configs/naver_keywords.json (slug → 키워드). 등록 안 된 글은 ② 를 건너뛰고 그 사실을 적는다.
"""
import argparse
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYWORDS_JSON = os.path.join(ROOT, "configs", "naver_keywords.json")

RULES_FROM = "2026-10-10"      # 이 날짜 이후 만든 초안부터 실패로 막는다(그 전 미접수 초안은 preflight 가 경고로)
TITLE_MIN, TITLE_MAX = 30, 40
BODY_MIN, BODY_MAX = 2500, 3500
FIRST_WORD_WITHIN = 5          # 키워드 첫 낱말이 이 글자 안에서 시작해야 「맨 앞」
FAQ_MIN = 3
LINK_MIN, LINK_MAX = 2, 3
TITLE_BANNED_CHARS = "'?\"&"   # 팜스 게시명 금지 특수문자 — 게시명과 실제 제목이 같아야 하므로 제목에서도 뺀다

FAQ_HEAD = re.compile(r"^자주 묻는 질문(?: \d+가지)?$")
SUMMARY_HEAD = re.compile(r"^핵심 요약(?: \d+가지)?$")
Q_LINE = re.compile(r"^Q\.\s*\S")
# 내부링크 = 우리 네이버 블로그 글 · 본진 기사. 진단(/diagnosis)·홈은 내부링크가 아니다(§6.6 진단 CTA 는 별도 게이트).
INTERNAL_URL = re.compile(r"https?://(?:m\.)?blog\.naver\.com/insightlab-daily/\d+|https?://(?:www\.)?goodfinance\.kr/news/[a-z0-9-]+")


# ── 순수 판정 ────────────────────────────────────────────────
def title_len(t):
    return len((t or "").strip())


def check_title(title, keyword=None):
    """→ (실패 목록, 메모 목록). 메모는 통과를 막지 않는다."""
    t = (title or "").strip()
    fails, notes = [], []
    n = title_len(t)
    if not TITLE_MIN <= n <= TITLE_MAX:
        fails.append(f"제목 {n}자 — {TITLE_MIN}~{TITLE_MAX}자 밖")
    bad = sorted({c for c in t if c in TITLE_BANNED_CHARS})
    if bad:
        fails.append("제목 특수문자 " + " ".join(bad) + " — 팜스 게시명 금지(질문형은 「~나요」로 끝내고 ? 를 붙이지 않는다)")
    if keyword:
        words = keyword.split()
        missing = [w for w in words if w not in t]
        if missing:
            fails.append("키워드 낱말 빠짐: " + ", ".join(missing))
        elif t.find(words[0]) > FIRST_WORD_WITHIN:
            fails.append(f"키워드 첫 낱말 「{words[0]}」이 {t.find(words[0]) + 1}번째 글자 — 맨 앞({FIRST_WORD_WITHIN}자 안)으로")
    else:
        notes.append("키워드 미등록 — configs/naver_keywords.json 에 slug·keyword 를 적으면 키워드 위치까지 잰다")
    return fails, notes


def body_len(text):
    return len(re.sub(r"\s+", "", text or ""))


def _block_after(rows, head_re):
    """head_re 에 맞는 첫 줄의 위치와 그 뒤 줄들. 없으면 (-1, [])."""
    for i, ln in enumerate(rows):
        if head_re.match(ln):
            return i, rows[i + 1:]
    return -1, []


def check_body(text, own_urls=()):
    """→ (실패 목록, 메모 목록). own_urls: 이 글 자신의 URL — 내부링크로 세지 않는다."""
    fails, notes = [], []
    rows = [ln.strip() for ln in (text or "").split("\n")]
    n = body_len(text)
    if not BODY_MIN <= n <= BODY_MAX:
        fails.append(f"본문 {n:,}자(공백 제외) — {BODY_MIN:,}~{BODY_MAX:,}자 밖")

    i, after = _block_after(rows, FAQ_HEAD)
    if i < 0:
        fails.append("「자주 묻는 질문 N가지」 소제목 없음")
    else:
        qs = []
        for ln in after:
            if SUMMARY_HEAD.match(ln):
                break
            if Q_LINE.match(ln):
                qs.append(ln)
        if len(qs) < FAQ_MIN:
            fails.append(f"FAQ 질문 {len(qs)}개 — 「Q. …」 {FAQ_MIN}개 이상")
        m = re.search(r"(\d+)가지$", rows[i])
        if m and int(m.group(1)) != len(qs):
            fails.append(f"FAQ 소제목 개수({m.group(1)})와 질문 수({len(qs)})가 다르다")

    if not any(SUMMARY_HEAD.match(ln) for ln in rows):
        fails.append("「핵심 요약」 소제목 없음")

    own = {u.rstrip("/") for u in own_urls}
    links = sorted({u.rstrip("/") for u in INTERNAL_URL.findall(text or "")} - own)
    if len(links) < LINK_MIN:
        fails.append(f"내부링크 {len(links)}개 — 관련 글 {LINK_MIN}~{LINK_MAX}개(심의필 붙은 글만)")
    elif len(links) > LINK_MAX:
        notes.append(f"내부링크 {len(links)}개 — {LINK_MAX}개 넘음(경고)")
    return fails, notes


def load_keywords(path=KEYWORDS_JSON):
    try:
        with open(path, encoding="utf-8") as fp:
            return json.load(fp)
    except FileNotFoundError:
        return {"articles": {}, "plan": []}


def keyword_for(slug, data=None):
    data = data or load_keywords()
    return (data.get("articles") or {}).get(slug or "")


def check_article(article, data=None):
    """preflight 용 — DB 행 그대로. → (ok, 설명)."""
    nv_t = article.get("naver_title") or ""
    text = article.get("naver_blog_content") or ""
    if not nv_t and not text:
        return True, "네이버 원고 없음 — 검사 생략"
    kw = keyword_for(article.get("slug"), data)
    f1, n1 = check_title(nv_t, kw)
    own = [f"https://goodfinance.kr/news/{article.get('slug')}"] if article.get("slug") else []
    f2, n2 = check_body(text, own)
    fails, notes = f1 + f2, n1 + n2
    if fails:
        return False, " / ".join(fails) + "  → WRITING-SPEC §4-4 네이버 규칙 10"
    return True, f"통과 — 제목 {title_len(nv_t)}자 · 본문 {body_len(text):,}자" + ("" if not notes else " · " + " / ".join(notes))


# ── 실행 ────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--title")
    ap.add_argument("--keyword")
    ap.add_argument("--naver-txt")
    ap.add_argument("--plan", action="store_true", help="configs/naver_keywords.json plan 의 제안 제목 전수 검사")
    a = ap.parse_args()
    bad = 0
    if a.plan:
        for p in load_keywords().get("plan", []):
            f, _ = check_title(p["title"], p["keyword"])
            mark = "통과" if not f else "실패"
            bad += bool(f)
            print(f"  [{p['no']:>2}] {mark} {title_len(p['title'])}자 · {p['title']}" + ("" if not f else "  ← " + " / ".join(f)))
    if a.title:
        f, n = check_title(a.title, a.keyword)
        bad += bool(f)
        print("제목:", "통과" if not f else " / ".join(f), *n)
    if a.naver_txt:
        f, n = check_body(open(a.naver_txt, encoding="utf-8").read())
        bad += bool(f)
        print("본문:", "통과" if not f else " / ".join(f), *n)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
