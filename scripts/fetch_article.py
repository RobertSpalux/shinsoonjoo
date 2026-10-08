#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
기사 한 편 읽기 전용 조회 — premium_articles 한 행을 JSON 으로 출력한다(쓰기 없음).

    python scripts/fetch_article.py <slug> [--cols a,b,c] [--out file.json]

기본 열: 제목·본진 마크다운·네이버 본문·요약·태그 등. 형식 기준(4호·16호 등)을 읽을 때 쓴다.
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

DEFAULT_COLS = ("slug,title,naver_title,category,seed_key,summary,tags,key_points,faq_json,verify_claims,"
                "main_website_markdown,naver_blog_content,raw_source_name,raw_source_url")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--cols", default=DEFAULT_COLS)
    ap.add_argument("--out")
    a = ap.parse_args()
    url, h = kit._rest(kit.load_env())
    r = requests.get(url, params={"slug": "eq." + a.slug, "select": a.cols, "limit": "1"}, headers=h, timeout=30)
    if r.status_code != 200 or not r.json():
        print("기사를 찾지 못했습니다 — slug='" + a.slug + "' (" + str(r.status_code) + ")")
        sys.exit(1)
    text = json.dumps(r.json()[0], ensure_ascii=False, indent=2)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as fp:
            fp.write(text)
    else:
        print(text)


if __name__ == "__main__":
    main()
