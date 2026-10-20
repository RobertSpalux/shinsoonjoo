#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""주간 유입 지수 — 순수 부분. python scripts/test_content_index_weekly.py (네트워크 없음)"""
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import content_index_weekly as c  # noqa: E402


def blog_html(*posts):
    return " ".join(f'<a href="https://blog.naver.com/{b}/{n}">x</a><a href="https://blog.naver.com/{b}/{n}">dup</a>' for b, n in posts)


class Keyword(unittest.TestCase):
    def test_main_keyword_wins(self):
        self.assertEqual(c.keyword_for({"main_keyword": " 일배책 누수 ", "title": "아무 제목"}), ("일배책 누수", "main_keyword"))

    def test_auto_from_naver_title(self):
        a = {"main_keyword": None, "naver_title": "실비 청구 기간 3년 — 놓치면 안 되는 것", "title": "x"}
        self.assertEqual(c.keyword_for(a), ("실비 청구 기간", "auto"))

    def test_none(self):
        self.assertEqual(c.keyword_for({"title": ""}), (None, None))


class Rank(unittest.TestCase):
    def test_dedup_order(self):
        h = blog_html(("a", "111111"), (c.OURS, "222222"), ("b", "333333"))
        self.assertEqual(c.blog_posts(h), [("a", "111111"), (c.OURS, "222222"), ("b", "333333")])

    def test_this_post(self):
        posts = [("a", "1111111"), (c.OURS, "2222222"), (c.OURS, "3333333")]
        self.assertEqual(c.our_rank(posts, "3333333"), (3, 3, True))

    def test_other_post_of_ours(self):
        posts = [("a", "1111111"), (c.OURS, "2222222")]
        self.assertEqual(c.our_rank(posts, "9999999"), (2, 2, False))
        self.assertEqual(c.our_rank(posts, None), (2, 2, None))

    def test_out(self):
        self.assertEqual(c.our_rank([("a", "1111111")] * 1, "1"), (None, 1, None))

    def test_log_no(self):
        self.assertEqual(c.naver_log_no("https://blog.naver.com/insightlab-daily/224012345678"), "224012345678")
        self.assertEqual(c.naver_log_no("https://m.blog.naver.com/PostView.naver?blogId=x&logNo=224012345678"), "224012345678")
        self.assertIsNone(c.naver_log_no(None))


class Verdict(unittest.TestCase):
    def test_refresh_when_out(self):
        self.assertEqual(c.verdicts({"naver_measured": True, "naver_blog_rank": None}), [c.V_REFRESH])

    def test_boost_4_to_15(self):
        self.assertEqual(c.verdicts({"naver_measured": True, "naver_blog_rank": 4}), [c.V_BOOST])
        self.assertEqual(c.verdicts({"naver_measured": True, "naver_blog_rank": 15}), [c.V_BOOST])
        self.assertEqual(c.verdicts({"naver_measured": True, "naver_blog_rank": 3}), [])
        self.assertEqual(c.verdicts({"naver_measured": True, "naver_blog_rank": 16}), [])

    def test_unmeasured_is_not_refresh(self):
        self.assertEqual(c.verdicts({"naver_blog_rank": None}), [])

    def test_snippet(self):
        self.assertEqual(c.verdicts({"gsc_impressions": 27, "gsc_clicks": 0}), [c.V_SNIPPET])
        self.assertEqual(c.verdicts({"gsc_impressions": 27, "gsc_clicks": 1}), [])
        self.assertEqual(c.verdicts({"gsc_impressions": 0, "gsc_clicks": 0}), [])
        self.assertEqual(c.verdicts({"gsc_impressions": None, "gsc_clicks": None}), [])


class Bits(unittest.TestCase):
    def test_arrow(self):
        self.assertEqual(c.arrow(3, 7), "▲4")
        self.assertEqual(c.arrow(9, 2), "▼7")
        self.assertEqual(c.arrow(5, 5), "＝")
        self.assertEqual(c.arrow(None, 5), "▼밖")
        self.assertEqual(c.arrow(5, None), "new")

    def test_gsc_window(self):
        self.assertEqual(c.gsc_window(date(2026, 10, 26)), (date(2026, 10, 17), date(2026, 10, 23)))

    def test_bucket(self):
        self.assertEqual(c.source_bucket("blog.naver.com"), "네이버 블로그")
        self.assertEqual(c.source_bucket("m.search.naver.com"), "네이버 검색")
        self.assertEqual(c.source_bucket("google"), "구글·기타 검색")
        self.assertEqual(c.source_bucket("(direct)"), "직접")
        self.assertTrue(c.is_internal_source("localhost:8765"))
        self.assertFalse(c.is_internal_source("google"))

    def test_naver_measure_offline(self):
        pages = iter([blog_html(("a", "1111111"), (c.OURS, "2222222")), "<div>insightlab-daily</div>"])
        r = c.naver_measure("x", "2222222", get=lambda u: next(pages), sleep=lambda s: None)
        self.assertEqual(r, {"naver_blog_rank": 2, "naver_blog_n": 2, "naver_post_matched": True,
                             "naver_integ_blog": True, "naver_integ_main": False})

    def test_compose(self):
        rows = [{"slug": "a", "keyword": "일배책 누수", "naver_measured": True, "naver_blog_rank": 6, "naver_integ_blog": False,
                 "gsc_impressions": 11, "gsc_clicks": 0, "ga_sessions": 4, "conv_events": {"kakao_click": 1},
                 "verdicts": [c.V_BOOST, c.V_SNIPPET]},
                {"slug": "b", "keyword": "부담보 해제", "naver_measured": True, "naver_blog_rank": None,
                 "verdicts": [c.V_REFRESH], "errors": {"gsc": "x"}}]
        t = c.compose((date(2026, 10, 12), date(2026, 10, 18)), rows, {"a": {"naver_blog_rank": 9}}, {"a": "일배책 누수 (3호)"})
        self.assertIn("30위 안 1편", t)
        self.assertIn("6위 ▲3 「일배책 누수」 일배책 누수 (3호)", t)
        self.assertIn("카톡 1", t)
        self.assertIn("■ 갱신 대상 1편", t)
        self.assertIn("※ 조회 실패: gsc", t)

    def test_db_row_has_no_internal_keys(self):
        r = c.db_row({"slug": "a", "naver_measured": True, "verdicts": []})
        self.assertNotIn("naver_measured", r)
        self.assertIsNone(r["errors"])


if __name__ == "__main__":
    unittest.main()
