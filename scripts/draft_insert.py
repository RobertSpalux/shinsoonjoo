#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
상록수 초안 저장 — **주제 중복 검사를 통과해야만** premium_articles 에 넣는다.

    python scripts/draft_insert.py <meta.json> <main.md> <naver.txt>          # 검사만(드라이런)
    python scripts/draft_insert.py <meta.json> <main.md> <naver.txt> --insert # 검사 통과 시 저장

meta.json: slug · title · naver_title · category · seed_key · summary · tags[] · key_points[] · faq_json[] · verify_claims[]
           (+ raw_source_name · raw_source_url · raw_source_fulltext · naver_keyword)
naver_keyword: 장부에 아직 없는 새 글의 키워드. 드라이런은 이 값으로 재고, --insert 가 저장에 성공하면 장부에 적는다(SH10).
네이버 규칙 10(제목 30~40자·키워드 맨 앞·본문 2,500~3,500자·FAQ 3·핵심 요약·내부링크 2~3)을 먼저 본다 —
           키워드는 configs/naver_keywords.json 의 articles[slug] (2026-10-09 신설, WRITING-SPEC §4-4).
저장값 고정: content_type=evergreen · needs_human_review=true · 발행 플래그 전부 false (WORKFLOW-EVERGREEN-B STEP 5-1).

🔴 초안을 DB 에 직접 넣는 다른 길(MCP SQL·REST 수작업)을 쓰지 않는다 — 검사를 건너뛰게 된다.
   2026-09-30: 이미 발행된 주제를 다시 쓰라는 지시가 하루 두 번 나왔다(부담보 해제 · 단체실손 중지·재개).
"""
import argparse
import json
import os
import sys

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_kit as kit  # noqa: E402
import topic_guard  # noqa: E402
import naver_rules  # noqa: E402

REQUIRED = ("slug", "title", "naver_title", "category", "seed_key", "summary", "tags", "key_points", "faq_json", "verify_claims")


def build_row(meta, main_md, naver_txt):
    miss = [k for k in REQUIRED if not meta.get(k)]
    if miss:
        raise kit.KitError("meta.json 에 빠진 값: " + ", ".join(miss))
    row = {k: meta[k] for k in REQUIRED}
    row.update(
        content_type="evergreen", main_website_markdown=main_md.strip(), naver_blog_content=naver_txt.strip(),
        raw_source_name=meta.get("raw_source_name"), raw_source_url=meta.get("raw_source_url"),
        raw_source_fulltext=meta.get("raw_source_fulltext"),
        needs_human_review=True, is_main_published=False, is_naver_published=False, is_blogspot_published=False,
        is_instagram_published=False, is_threads_published=False)
    return row


def resolve_keyword(slug, meta_kw=None, data=None):
    """→ (키워드, 장부에 새로 적어야 하나). 장부(configs/naver_keywords.json)가 정본이고, 없으면 meta.json 의 naver_keyword.
    둘 다 있는데 다르면 막는다 — 제목이 노리는 키워드가 둘이 되면 preflight 와 초안 게이트가 서로 다른 판정을 한다."""
    kw = naver_rules.keyword_for(slug, data)
    meta_kw = (meta_kw or "").strip() or None
    if kw and meta_kw and kw != meta_kw:
        raise kit.KitError(f"네이버 키워드 불일치 — 장부 「{kw}」 · meta.json 「{meta_kw}」", gate=True)
    if kw:
        return kw, False
    if meta_kw:
        return meta_kw, True
    raise kit.KitError(f"네이버 키워드 미등록 — meta.json 에 \"naver_keyword\" 를 적거나 configs/naver_keywords.json articles 에 \"{slug}\": \"키워드\" 를 적는다", gate=True)


def register_keyword(slug, kw, path=naver_rules.KEYWORDS_JSON):
    """--insert 때만 — 장부 articles 에 slug → 키워드를 적는다(preflight 가 같은 키워드로 재게). 커밋은 부른 쪽 몫."""
    data = naver_rules.load_keywords(path)
    data.setdefault("articles", {})[slug] = kw
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fp:
        json.dump(data, fp, ensure_ascii=False, indent=2)
        fp.write("\n")
    os.replace(tmp, path)


def naver_gate(row, data=None, meta_kw=None):
    """네이버 규칙 10(WRITING-SPEC §4-4) — 초안 저장 전에 막는다. 키워드는 configs/naver_keywords.json 이 정본.
    preflight 도 같은 판정을 하지만, 저장 뒤에 걸리면 이미 버퍼에 들어간 원고를 고치는 일이 된다.
    → (메모 목록, 장부에 적을 키워드 또는 None)."""
    kw, new = resolve_keyword(row["slug"], meta_kw, data)
    f1, _ = naver_rules.check_title(row["naver_title"], kw)
    f2, notes = naver_rules.check_body(row["naver_blog_content"], [f"https://goodfinance.kr/news/{row['slug']}"])
    if f1 + f2:
        raise kit.KitError("네이버 규칙 10 미충족 — 저장하지 않습니다:\n  · " + "\n  · ".join(f1 + f2), gate=True)
    return notes, (kw if new else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("meta")
    ap.add_argument("main_md")
    ap.add_argument("naver_txt")
    ap.add_argument("--insert", action="store_true")
    a = ap.parse_args()
    env = kit.load_env()
    try:
        meta = json.load(open(a.meta, encoding="utf-8"))
        row = build_row(meta, open(a.main_md, encoding="utf-8").read(), open(a.naver_txt, encoding="utf-8").read())
        notes, new_kw = naver_gate(row, meta_kw=meta.get("naver_keyword"))
        topic_guard.guard(env, {"slug": row["slug"], "title": row["title"], "naver_title": row["naver_title"]})
    except kit.KitError as e:
        print(str(e))
        sys.exit(1)
    print("네이버 규칙 10 통과" + ("" if not notes else " (" + " / ".join(notes) + ")"))
    print("주제 중복 검사 통과 —", row["slug"])
    if new_kw:
        print(f"네이버 키워드 「{new_kw}」 — 장부 미등록(meta.json 값 사용)" + (" → 저장 시 장부에 적는다" if not a.insert else ""))
    if not a.insert:
        print("(드라이런 — --insert 를 붙이면 저장)")
        return
    url, h = kit._rest(env)
    r = requests.post(url, json=row, headers={**h, "Prefer": "return=representation"}, timeout=30)
    if not r.ok:
        print("저장 실패:", r.status_code, r.text[:300])
        sys.exit(1)
    print("저장:", r.json()[0]["id"], r.json()[0]["slug"])
    if new_kw:
        register_keyword(row["slug"], new_kw)
        print(f"장부 기록: configs/naver_keywords.json articles[{row['slug']}] = 「{new_kw}」 — 커밋 필요")


if __name__ == "__main__":
    main()
