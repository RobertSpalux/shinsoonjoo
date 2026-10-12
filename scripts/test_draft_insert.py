#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""draft_insert 저장값 — 순수 부분 시험. python scripts/test_draft_insert.py"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import draft_insert as di  # noqa: E402
import pams_kit as kit  # noqa: E402

META = {k: "x" for k in di.REQUIRED}
META.update(tags=["a"], key_points=["b"], faq_json=[{"question": "q", "answer": "a"}], verify_claims=[{"claim": "c"}])


class NaverOnly(unittest.TestCase):
    def test_normal_keeps_main(self):
        row = di.build_row(META, " 본진 ", "네이버")
        self.assertEqual(row["main_website_markdown"], "본진")
        self.assertFalse(kit.naver_only(row))

    def test_naver_only_stores_null(self):
        """SH16 — 본진판 없음이 DB 에 드러나게 빈 문자열이 아니라 NULL."""
        row = di.build_row({**META, "naver_only": True}, "", "네이버")
        self.assertIsNone(row["main_website_markdown"])
        self.assertNotIn("naver_only", row, "premium_articles 에 없는 칸은 보내지 않는다")
        self.assertTrue(kit.naver_only(row))
        self.assertFalse(row["is_main_published"])

    def test_naver_only_with_main_text_refused(self):
        with self.assertRaises(kit.KitError):
            di.build_row({**META, "naver_only": True}, "본진 원고", "네이버")

    def test_empty_main_without_flag_refused(self):
        with self.assertRaises(kit.KitError):
            di.build_row(META, "  ", "네이버")

    def test_sh15_metas_are_naver_only(self):
        for slug in ("silson-claim-deadline-3year-start-point", "daily-liability-nusu-own-home-tenant-landlord",
                     "whole-life-cancel-refund-keep-options"):
            with open(os.path.join(kit.ROOT, "assets", "naver", slug, "meta.json"), encoding="utf-8") as fp:
                m = json.load(fp)
            self.assertIs(m.get("naver_only"), True, slug)


if __name__ == "__main__":
    unittest.main(verbosity=1)
