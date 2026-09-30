# -*- coding: utf-8 -*-
"""publish_approved 순수 판정 시험 — python scripts/test_publish_approved.py"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import publish_approved as pa  # noqa: E402

T = "2026-09-30"
ROW = {"id": "r1", "article_id": "a1", "channel": "main", "status": "approved", "review_no": "2026-09-7998",
       "review_from": "2026-09-30", "review_to": "2027-09-29", "posted_url": None}
ART = {"a1": {"id": "a1", "slug": "s1"}}


class T1(unittest.TestCase):
    def test_review_ok(self):
        self.assertTrue(pa.review_ok(ROW, T)[0])
        self.assertFalse(pa.review_ok({**ROW, "review_no": None}, T)[0], "번호 없으면 게시 금지")
        self.assertFalse(pa.review_ok({**ROW, "review_no": "프라임에셋 심의필 제2026-09-7998호"}, T)[0], "전체 문구는 형식 불일치")
        self.assertFalse(pa.review_ok({**ROW, "review_from": "2026-10-01"}, T)[0], "유효기간 전")
        self.assertFalse(pa.review_ok({**ROW, "review_to": "2026-09-29"}, T)[0], "만료")
        self.assertFalse(pa.review_ok({**ROW, "status": "submitted"}, T)[0])

    def test_plan(self):
        rows = [ROW, {**ROW, "id": "r2", "channel": "naver"}, {**ROW, "id": "r3", "channel": "threads"},
                {**ROW, "id": "r4", "posted_url": "https://x"}, {**ROW, "id": "r5", "article_id": "zz"}]
        p = pa.plan(rows, ART, T)
        self.assertEqual([t["row"]["id"] for t in p], ["r1", "r2"], "main·naver 만, 게시 URL 있는 건 제외")
        self.assertTrue(all(t["ok"] for t in p))

    def test_expiring(self):
        rows = [{**ROW, "review_to": "2026-10-20"}, {**ROW, "id": "x", "review_to": "2026-11-15"},
                {**ROW, "id": "y", "review_to": "2026-09-29"}]
        self.assertEqual([r["id"] for r in pa.expiring(rows, T)], ["r1"], "30일 안만, 이미 지난 것 제외")

    def test_live_has_review(self):
        self.assertTrue(pa.live_has_review("… 프라임에셋 심의필 제2026-09-7998호 (2026.09.30 ~ 2027.09.29)", "2026-09-7998"))
        self.assertFalse(pa.live_has_review("<html>제_____호</html>", "2026-09-7998"))


if __name__ == "__main__":
    unittest.main()
