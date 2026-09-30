#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
상록수 초안 저장 — **주제 중복 검사를 통과해야만** premium_articles 에 넣는다.

    python scripts/draft_insert.py <meta.json> <main.md> <naver.txt>          # 검사만(드라이런)
    python scripts/draft_insert.py <meta.json> <main.md> <naver.txt> --insert # 검사 통과 시 저장

meta.json: slug · title · naver_title · category · seed_key · summary · tags[] · key_points[] · faq_json[] · verify_claims[]
           (+ raw_source_name · raw_source_url · raw_source_fulltext)
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("meta")
    ap.add_argument("main_md")
    ap.add_argument("naver_txt")
    ap.add_argument("--insert", action="store_true")
    a = ap.parse_args()
    env = kit.load_env()
    try:
        row = build_row(json.load(open(a.meta, encoding="utf-8")), open(a.main_md, encoding="utf-8").read(),
                        open(a.naver_txt, encoding="utf-8").read())
        topic_guard.guard(env, {"slug": row["slug"], "title": row["title"], "naver_title": row["naver_title"]})
    except kit.KitError as e:
        print(str(e))
        sys.exit(1)
    print("주제 중복 검사 통과 —", row["slug"])
    if not a.insert:
        print("(드라이런 — --insert 를 붙이면 저장)")
        return
    url, h = kit._rest(env)
    r = requests.post(url, json=row, headers={**h, "Prefer": "return=representation"}, timeout=30)
    if not r.ok:
        print("저장 실패:", r.status_code, r.text[:300])
        sys.exit(1)
    print("저장:", r.json()[0]["id"], r.json()[0]["slug"])


if __name__ == "__main__":
    main()
