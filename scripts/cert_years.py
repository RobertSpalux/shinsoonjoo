#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
우수인증설계사 「8년 연속」 표기 — 정본 자구 로더 + 단독 표기 검출기.

정본은 src/lib/brand.ts 의 CERT_8Y_LABEL 한 줄이다(자구 하드코딩 금지).
근거: 심의 반송(9·11·12호, 2026-10-06) 「8년 연속」 단독 표기는 과거 이력을 현재 유지로 오인시킴 → 「[2018~2025]」 병기.
쓰는 곳: scripts/preflight.py(「우수인증 기간」 검사)
테스트: python scripts/test_cert_years.py
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND_TS = os.path.join(ROOT, "src", "lib", "brand.ts")

_BARE = re.compile(r"8년\s*연속")
# 기간이 이미 붙은 「2018년부터 8년 연속」 은 단독 표기가 아니다.
_PERIOD_OK = re.compile(r"2018년\s*부터\s*8년\s*연속")


def load_label(brand_ts=BRAND_TS):
    ts = open(brand_ts, encoding="utf-8").read()
    m = re.search(r'export const CERT_8Y_LABEL\s*=\s*"([^"]+)"', ts)
    if not m:
        raise SystemExit("[파서 오류] brand.ts 에서 CERT_8Y_LABEL 을 찾지 못했습니다.")
    return m.group(1)


def find_bare(text, label=None):
    """정본 자구(label) 밖에서 나온 「8년 연속」 표기를 돌려준다. 없으면 []."""
    if not text:
        return []
    label = label or load_label()
    s = text.replace(label, "\u0000")
    s = _PERIOD_OK.sub("\u0001", s)
    out = []
    for m in _BARE.finditer(s):
        a, b = max(0, m.start() - 12), min(len(s), m.end() + 12)
        out.append(s[a:b].replace("\u0000", label).replace("\u0001", "2018년부터 8년 연속").replace("\n", " "))
    return out
