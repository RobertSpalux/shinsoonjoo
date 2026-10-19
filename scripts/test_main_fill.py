#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""본진판 채우기 게이트 — python scripts/test_main_fill.py (네트워크·DB 호출 없음)

실손 밖 글(연금)도 세금·비과세 유의문구 원문이 본진에 있으면 금소법 게이트를 통과해야 하고,
문구가 빠지면 여전히 막혀야 한다(MN3 21호, 2026-10-19).
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import draft_weekly as dw  # noqa: E402
import main_fill as mf  # noqa: E402

CFG = dw.load_topics()
TAX = CFG["notices"]["taxAdvice"][0] + "."
TAX_FREE = CFG["notices"]["taxFree"][0]
BODY = "연금저축보험을 중도해지하면 연금 외 수령으로 분류되어 세금이 달라집니다. 비과세 연금보험은 요건을 유지해야 합니다."


def fin(main, category="연금·노후·세테크"):
    art = {"title": "연금보험 해지하면 왜 세금이 다를까", "category": category, "naver_blog_content": ""}
    patch = {"title": art["title"], "main_website_markdown": main}
    return dict((n, (ok, d)) for n, ok, d in mf.gates(art, patch))["금소법 게이트(rules_finance_gate)"]


class FinanceGate(unittest.TestCase):
    def test_annuity_with_notices_passes(self):
        ok, d = fin("\n\n".join([BODY, TAX, TAX_FREE]))
        self.assertTrue(ok, d)

    def test_annuity_tax_without_notice_fails(self):
        # 세무사 문구 검사는 비과세 문구(「세무사 등 전문가」 포함)로도 충족된다 — draft_weekly.finance_gate 와 같은 규칙
        ok, d = fin("연금저축보험을 중도해지하면 연금 외 수령으로 분류되어 세금이 달라집니다.")
        self.assertFalse(ok)
        self.assertIn("세무사", d)

    def test_annuity_without_tax_free_notice_fails(self):
        ok, d = fin("\n\n".join([BODY, TAX]))
        self.assertFalse(ok)
        self.assertIn("비과세", d)

    def test_annuity_words_scanned(self):
        ok, d = fin("\n\n".join([BODY, "연금으로 목돈을 만들 수 있습니다.", TAX, TAX_FREE]))
        self.assertFalse(ok)
        self.assertIn("연금 목적 왜곡", d)


if __name__ == "__main__":
    unittest.main()
