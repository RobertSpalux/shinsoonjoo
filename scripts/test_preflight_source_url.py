#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""preflight 출처 URL 완전 일치 — python scripts/test_preflight_source_url.py (네트워크 없음)"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import preflight as p  # noqa: E402

FULL = "https://www.fss.or.kr/fss/bbs/B0000188/view.do?nttId=219361&menuNo=200218"
LEDGER = {FULL}


class SourceUrl(unittest.TestCase):
    def test_exact_match_passes(self):
        self.assertIsNone(p.source_url_problem(FULL, LEDGER))
        self.assertIsNone(p.source_url_problem("  " + FULL + " ", LEDGER))

    def test_empty_is_not_checked(self):
        self.assertIsNone(p.source_url_problem(None, LEDGER))
        self.assertIsNone(p.source_url_problem("", LEDGER))

    def test_domain_only_is_caught(self):
        self.assertIsNotNone(p.source_url_problem("https://www.fss.or.kr", LEDGER))

    def test_partial_or_other_is_caught(self):
        self.assertIsNotNone(p.source_url_problem(FULL.split("&")[0], LEDGER))
        self.assertIsNotNone(p.source_url_problem("https://example.com/x", LEDGER))

    def test_wired_into_preflight(self):
        s = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "preflight.py"), encoding="utf-8").read()
        self.assertIn('("출처 URL", *check_source_url(article))', s)
        self.assertIn("raw_source_url", s[s.index("def fetch_article("):s.index("def mark_preflight(")])


if __name__ == "__main__":
    unittest.main(verbosity=1)
