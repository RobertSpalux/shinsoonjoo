#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GA 명장 표기 — 정본 자구 로더 + 「GA명장」 단독 표기 검출기.

정본은 src/lib/brand.ts 의 GA_MASTER_LABEL 한 줄이다(여기 자구를 하드코딩하지 않는다).
근거: PAMS 7168 승인 조건(2026-09-28) 「[GA명장] → [22년~25년 GA 명장] 등 기간 명시하시어 기재」.
      정본 자구 확정 2026-10-02(로버트·준법 통화): 「22년·25년 GA 명장」 — 22년과 25년 두 해.

쓰는 곳: scripts/preflight.py(「GA 명장 기간」 검사) · naver_images.py · scripts/patch_thumb_brand_line.py
테스트: python scripts/test_ga_master.py
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND_TS = os.path.join(ROOT, "src", "lib", "brand.ts")

# 「GA명장」 「GA 명장」 「GA  명장」 — 공백 유무와 무관하게 잡는다.
_GA_MASTER = re.compile(r"GA\s*명장")


def load_label(brand_ts=BRAND_TS):
    ts = open(brand_ts, encoding="utf-8").read()
    m = re.search(r'export const GA_MASTER_LABEL\s*=\s*"([^"]+)"', ts)
    if not m:
        raise SystemExit("[파서 오류] brand.ts 에서 GA_MASTER_LABEL 을 찾지 못했습니다.")
    return m.group(1)


def find_bare(text, label=None):
    """정본 자구(label) 밖에서 나온 「GA 명장」 표기를 돌려준다. 없으면 []."""
    if not text:
        return []
    label = label or load_label()
    stripped = text.replace(label, "\u0000")
    out = []
    for m in _GA_MASTER.finditer(stripped):
        a, b = max(0, m.start() - 12), min(len(stripped), m.end() + 12)
        out.append(stripped[a:b].replace("\u0000", label).replace("\n", " "))
    return out
