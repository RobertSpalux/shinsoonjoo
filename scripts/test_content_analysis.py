#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""콘텐츠 성과 분석 — 순수 부분. py -3.14 -X utf8 scripts/test_content_analysis.py (네트워크 없음)"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import content_analysis as c  # noqa: E402


class Pure(unittest.TestCase):
    def test_norm_path(self):
        self.assertEqual(c.norm_path("/news/a/?utm=1"), "/news/a")
        self.assertEqual(c.norm_path("https://goodfinance.kr/news/a#x"), "/news/a")
        self.assertEqual(c.norm_path("https://goodfinance.kr/"), "/")
        self.assertEqual(c.norm_path(""), "/")

    def test_merge_sources(self):
        m = c.merge_sources([("/news/a", "blog.naver.com", "referral", 3), ("/news/a?x=1", "google", "organic", 2),
                             ("/news/a", "l.threads.com", "referral", 1), ("/", "(direct)", "(none)", 4)])
        self.assertEqual(m["/news/a"]["합계"], 6)
        self.assertEqual(m["/news/a"]["네이버 블로그"], 3)
        self.assertEqual(m["/news/a"]["검색"], 2)
        self.assertEqual(m["/news/a"]["스레드"], 1)
        self.assertEqual(c.source_totals(m)["합계"], 10)

    def test_merge_gsc_weighted(self):
        g = c.merge_gsc([("https://goodfinance.kr/news/a", 1, 10, 2.0), ("https://goodfinance.kr/news/a/", 0, 30, 6.0)])
        self.assertEqual(g["/news/a"], {"clicks": 1, "imps": 40, "pos": 5.0})

    def test_ctr_and_rate(self):
        self.assertEqual(c.ctr(1, 0), "—")
        self.assertEqual(c.ctr(1, 40), "2.5%")
        self.assertEqual(c.funnel_rate(0, 0), "—")
        self.assertEqual(c.funnel_rate(10, 3), "30%")

    def _lines(self):
        titles = {"1": {"slug": "a", "title": "가", "issue": 1}, "2": {"slug": "b", "title": "나", "issue": 2}}
        rv = [{"article_id": "1", "channel": "main", "status": "approved", "posted_url": "u"},
              {"article_id": "1", "channel": "naver", "status": "approved", "posted_url": "u2"},
              {"article_id": "2", "channel": "main", "status": "approved", "posted_url": "u3"},
              {"article_id": "2", "channel": "naver", "status": "approved", "posted_url": None},
              {"article_id": "2", "channel": "threads", "status": "submitted", "posted_url": "x"}]
        src = c.merge_sources([("/news/a", "blog.naver.com", "referral", 3), ("/news/b", "google", "organic", 5)])
        ev = c.merge_events([("/news/a", "kakao_cta_click", 2), ("/news/a", "diagnosis_complete", 3)])
        gsc = c.merge_gsc([("https://goodfinance.kr/news/b", 0, 50, 8.0)])
        return c.article_lines(rv, titles, src, ev, gsc)

    def test_article_lines_filters_and_sorts(self):
        L = self._lines()
        self.assertEqual([(l["issue"], l["channel"]) for l in L], [(1, "네이버"), (1, "본진"), (2, "본진")])

    def test_article_lines_values(self):
        L = {(l["issue"], l["channel"]): l for l in self._lines()}
        self.assertEqual(L[(1, "본진")]["kakao_click"], 2)
        self.assertEqual(L[(1, "네이버")]["sessions_from_this_channel"], 3)
        self.assertIsNone(L[(1, "네이버")]["kakao_click"])
        self.assertEqual(L[(2, "본진")]["kakao_click"], 0)   # 0 은 0 으로

    def test_no_click_and_makers(self):
        L = self._lines()
        self.assertEqual([l["slug"] for l in c.no_click_articles(L)], ["b"])
        self.assertEqual([l["slug"] for l in c.consult_makers(L)], ["a"])

    def test_render_smoke(self):
        t = c.render((__import__("datetime").date(2026, 7, 20),) * 2, self._lines(), [("/", 1)], c.source_totals({}), None, ["x"])
        self.assertIn("조회 실패(GA4)", t)


if __name__ == "__main__":
    unittest.main()
