#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
보험료 표기 게이트 — 법정 한도 금액 예외 테스트. python scripts/test_premium_statutory.py

RV42(2026-11-16) PAMS seq 699198 반송 ③: 심사자가 「월적립식 연금보험은 5년 이상 납입,
10년 이상 유지, 월 보험료 150만원 이내, 일시납 연금보험은 10년 이상 유지, 총 납입보험료
1억원 이하」를 그대로 기재하라고 지정했다. 이 문장은 견적이 아니라 소득세법 요건이다.
면제는 좁게 — 맥락어(요건·세법·시행령) + 문장 안 금액이 전부 한도 꼴일 때만.
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import preflight  # noqa: E402

RV42 = ("보험차익이 과세에서 제외되려면 월적립식 연금보험은 5년 이상 납입, 10년 이상 유지, "
        "월 보험료 150만원 이내, 일시납 연금보험은 10년 이상 유지, 총 납입보험료 1억원 이하 "
        "요건을 갖추어야 합니다(2017년 4월 1일 이후 체결 계약 기준).")


def run(body):
    art = {"main_website_markdown": body, "ad_reviews": []}
    return preflight.check_premium_notation(art)


class PremiumStatutory(unittest.TestCase):
    def test_rv42_sentence_passes(self):
        ok, detail = run(RV42)
        self.assertTrue(ok, detail)

    def test_quote_still_blocked(self):
        ok, _ = run("이 설계의 월 보험료는 51만원입니다.")
        self.assertFalse(ok)

    def test_rough_quote_without_ctx_blocked(self):
        # 「이하」 꼴이어도 법령·요건 맥락어가 없으면 견적 대략 안내 — 막힌다
        ok, _ = run("월 보험료 3만원 이하로 준비할 수 있습니다.")
        self.assertFalse(ok)

    def test_mixed_quote_in_ctx_blocked(self):
        # 맥락어가 있어도 한도 꼴 아닌 금액이 섞이면 면제하지 않는다
        ok, _ = run("요건을 갖춘 계약의 월 보험료는 51만원이고 한도는 150만원 이하입니다.")
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main(verbosity=2)
