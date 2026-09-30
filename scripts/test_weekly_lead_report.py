#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""유효 리드 주간 리포트 — 순수 부분. python scripts/test_weekly_lead_report.py (네트워크 없음)"""
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import weekly_lead_report as w  # noqa: E402


class Period(unittest.TestCase):
    def test_monday_run(self):
        (s, e), (ps, pe) = w.last_week(date(2026, 10, 5))   # 월요일 발송
        self.assertEqual((s, e), (date(2026, 9, 28), date(2026, 10, 4)))
        self.assertEqual((ps, pe), (date(2026, 9, 21), date(2026, 9, 27)))

    def test_midweek(self):
        (s, e), _ = w.last_week(date(2026, 9, 30))
        self.assertEqual((s, e), (date(2026, 9, 21), date(2026, 9, 27)))


class Bits(unittest.TestCase):
    def test_delta(self):
        self.assertEqual(w.delta(5, 3), "5 (▲2)")
        self.assertEqual(w.delta(1, 4), "1 (▼3)")
        self.assertEqual(w.delta(2, 2), "2 (＝)")
        self.assertEqual(w.delta(None, 2), "조회 실패")

    def test_bucket(self):
        self.assertEqual(w.source_bucket("m.blog.naver.com", "referral"), "네이버 블로그")
        self.assertEqual(w.source_bucket("l.threads.com", "referral"), "스레드")
        self.assertEqual(w.source_bucket("google", "organic"), "검색")
        self.assertEqual(w.source_bucket("(direct)", "(none)"), "기타")

    def test_slug(self):
        self.assertEqual(w.slug_of("/news/abc-def?x=1"), "abc-def")
        self.assertIsNone(w.slug_of("/diagnosis"))

    def test_replies_count_account_and_range(self):
        db = {"1": {"계정": "goodfinance", "때": "2026-09-22T10:00:00+0000", "답글시각": "2026-09-22T11:00:00+09:00"},
              "2": {"계정": "goodfinance", "때": "2026-09-29T10:00:00+09:00"},
              "3": {"계정": "baksatravel", "때": "2026-09-23T10:00:00+09:00"}}
        self.assertEqual(w.count_replies(db, date(2026, 9, 21), date(2026, 9, 27)), (1, 1))


class Compose(unittest.TestCase):
    def setUp(self):
        self.week = (date(2026, 9, 21), date(2026, 9, 27)); self.prev = (date(2026, 9, 14), date(2026, 9, 20))
        self.cur = {"funnel": {"diagnosis_start": 10, "diagnosis_complete": 6, "kakao_cta_click": 3},
                    "articles": {"a": {"합계": 5, "네이버 블로그": 3, "검색": 2, "검색클릭": 4}, "z": {"합계": 0}},
                    "reviews": {"승인": 2, "게시": 1}, "threads": {"받음": 4, "답글": 3}}
        self.pre = {"funnel": {"diagnosis_start": 8, "diagnosis_complete": 6, "kakao_cta_click": 1},
                    "articles": {"a": {"합계": 2}}, "reviews": {"승인": 0, "게시": 0}, "threads": {"받음": 1, "답글": 1}}

    def test_sections_and_delta(self):
        t = w.compose(self.week, self.prev, self.cur, self.pre, {"a": "9호"})
        self.assertIn("시작 10 (▲2) → 완료 6 (＝) → 카카오 3 (▲2)", t)
        self.assertIn("완료율 60% · 카카오 전환 50%", t)
        self.assertIn("9호 5 (▲3) — 네이버 블로그 3 · 검색 2 · 검색클릭 4", t)
        self.assertIn("승인 2 (▲2) · 게시위치 등록 1 (▲1)", t)
        self.assertIn("받은 댓글 4 (▲3) · 답글 3 (▲2)", t)

    def test_no_vanity_metrics(self):
        t = w.compose(self.week, self.prev, self.cur, self.pre, {})
        for bad in ("조회수", "팔로워", "노출", "페이지뷰"):
            self.assertNotIn(bad, t)

    def test_zero_rows_hidden(self):
        t = w.compose(self.week, self.prev, self.cur, self.pre, {})
        self.assertNotIn("  z ", t)

    def test_failure_isolated(self):
        cur = dict(self.cur, funnel=None, reviews=None)
        t = w.compose(self.week, self.prev, cur, self.pre, {})
        self.assertIn("조회 실패(GA4)", t)
        self.assertIn("조회 실패(DB)", t)
        self.assertIn("받은 댓글 4", t)


if __name__ == "__main__":
    unittest.main(verbosity=1)
