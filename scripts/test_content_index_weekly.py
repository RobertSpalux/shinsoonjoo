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

    def test_gsc_range_backfill(self):
        # 11/9 실행: 10/26주는 GSC 가 찼다 → 그 주 그대로 / 11/2주(지난주)는 −3일까지 7일
        self.assertEqual(c.gsc_range_for((date(2026, 10, 26), date(2026, 11, 1)), date(2026, 11, 9)),
                         (date(2026, 10, 26), date(2026, 11, 1)))
        self.assertEqual(c.gsc_range_for((date(2026, 11, 2), date(2026, 11, 8)), date(2026, 11, 9)),
                         (date(2026, 10, 31), date(2026, 11, 6)))

    def test_db_row_has_no_internal_keys(self):
        r = c.db_row({"slug": "a", "naver_measured": True, "verdicts": []})
        self.assertNotIn("naver_measured", r)
        self.assertIsNone(r["errors"])


class CatchUp(unittest.TestCase):
    """FN1 — 11/2 실행 실패로 10/26주가 빠졌다. 다음 실행이 빠진 주를 같이 잰다."""
    def test_missing_week_is_backfilled(self):
        have = {date(2026, 10, 12), date(2026, 10, 19)}
        self.assertEqual(c.weeks_to_measure(have, date(2026, 11, 2)), [date(2026, 10, 26), date(2026, 11, 2)])

    def test_nothing_missing(self):
        have = {date(2026, 10, 12), date(2026, 10, 19), date(2026, 10, 26)}
        self.assertEqual(c.weeks_to_measure(have, date(2026, 11, 2)), [date(2026, 11, 2)])

    def test_last_week_always_measured_even_if_present(self):
        have = {date(2026, 10, 12), date(2026, 10, 19), date(2026, 10, 26), date(2026, 11, 2)}
        self.assertEqual(c.weeks_to_measure(have, date(2026, 11, 2)), [date(2026, 11, 2)])

    def test_lookback_limit(self):
        # 4주 넘게 빈 주는 소급하지 않는다(지난주 포함 4주)
        self.assertEqual(c.weeks_to_measure(set(), date(2026, 11, 30)),
                         [date(2026, 11, 9), date(2026, 11, 16), date(2026, 11, 23), date(2026, 11, 30)])

    def test_not_before_first_week(self):
        self.assertEqual(c.weeks_to_measure(set(), date(2026, 10, 19)), [date(2026, 10, 12), date(2026, 10, 19)])

    def test_backfill_skips_naver(self):
        calls = []
        orig = (c.fetch_naver_urls, c.gsc_pages, c.ga4_landing)
        c.fetch_naver_urls = lambda env: {}
        c.gsc_pages = lambda ros, s, e: calls.append((s, e)) or {}
        c.ga4_landing = lambda ros, s, e: {}
        try:
            arts = [{"id": "1", "slug": "a", "title": "실비 청구 기간", "is_main_published": True, "is_naver_published": True}]
            rows = c.measure({}, {}, (date(2026, 10, 26), date(2026, 11, 1)), date(2026, 11, 9), log=lambda m: None,
                             naver=lambda *a: self.fail("소급 주에 네이버를 재면 안 된다"), backfill=True, articles=arts)
        finally:
            c.fetch_naver_urls, c.gsc_pages, c.ga4_landing = orig
        self.assertEqual(calls, [(date(2026, 10, 26), date(2026, 11, 1))])
        self.assertEqual(rows[0]["errors"]["naver"], c.NAVER_BACKFILL_NOTE)
        self.assertEqual(rows[0]["verdicts"], [])
        self.assertEqual(rows[0]["ga_sessions"], 0)


class Retry(unittest.TestCase):
    def test_transient_then_ok(self):
        n = {"i": 0}

        def fn():
            n["i"] += 1
            if n["i"] < 3:
                raise c.requests.ConnectionError("down")
            return "ok"
        self.assertEqual(c.retry(fn, sleep=lambda s: None), "ok")
        self.assertEqual(n["i"], 3)

    def test_gives_up(self):
        def fn():
            raise c.requests.Timeout("t")
        with self.assertRaises(c.requests.Timeout):
            c.retry(fn, sleep=lambda s: None)

    def test_non_transient_not_retried(self):
        n = {"i": 0}

        def fn():
            n["i"] += 1
            raise RuntimeError("저장 실패 409")
        with self.assertRaises(RuntimeError):
            c.retry(fn, sleep=lambda s: None)
        self.assertEqual(n["i"], 1)

    def test_log_file(self):
        import tempfile
        p = os.path.join(tempfile.mkdtemp(), "x", "l.log")
        c.log_line("시작", path=p)
        c.log_line("끝", path=p)
        with open(p, encoding="utf-8") as fp:
            self.assertEqual(len(fp.read().splitlines()), 2)


if __name__ == "__main__":
    unittest.main()
