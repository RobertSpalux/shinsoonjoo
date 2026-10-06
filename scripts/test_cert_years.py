#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""「8년 연속」 단독 표기 차단 테스트 — python scripts/test_cert_years.py"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import cert_years  # noqa: E402
import preflight  # noqa: E402

LABEL = cert_years.load_label()


def article(**kw):
    base = {"title": "제목", "naver_title": "네이버 제목", "blogspot_title": None,
            "main_website_markdown": "본문", "naver_blog_content": "네이버 본문",
            "blogspot_content": None, "instagram_caption": None,
            "is_main_published": False, "ad_reviews": []}
    base.update(kw)
    return base


class CertTest(unittest.TestCase):
    def test_label(self):
        self.assertEqual(LABEL, "우수인증설계사 8년 연속 [2018~2025]")

    def test_bare_caught(self):
        for s in ["우수인증설계사 8년 연속", "8년 연속 인증", "우수인증설계사 8년연속"]:
            self.assertTrue(cert_years.find_bare(s, LABEL), s)

    def test_label_and_period_pass(self):
        for s in [LABEL, f"23년 차 · {LABEL}", "2018년부터 8년 연속 우수인증설계사", "", None]:
            self.assertEqual(cert_years.find_bare(s, LABEL), [], s)

    def test_preflight_new_fails_label_passes(self):
        self.assertFalse(preflight.check_cert_years("__x__", article(main_website_markdown="우수인증설계사 8년 연속"), renderers=[])[0])
        self.assertTrue(preflight.check_cert_years("__x__", article(main_website_markdown=LABEL), renderers=[])[0])

    def test_frozen_not_scanned(self):
        a = article(naver_blog_content="8년 연속", ad_reviews=[{"channel": "naver", "status": "approved"}])
        self.assertTrue(preflight.check_cert_years("__x__", a, renderers=[])[0])

    def test_repo_renderers_clean(self):
        ok, detail = preflight.check_cert_years("__x__", article())
        self.assertTrue(ok, detail)


if __name__ == "__main__":
    unittest.main(verbosity=2)
