#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sql/006 대비 — ad_reviews 를 글 기준으로 읽는 곳이 전부 지식iN(channel=kin) 행을 거르는지, kin 행 본문이 006 체크에 맞는지.

    python scripts/test_not_kin.py
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import pams_kit as kit  # noqa: E402
import content_analysis  # noqa: E402
import kin_pipeline  # noqa: E402
import pams_folder_tidy  # noqa: E402
import pams_queue  # noqa: E402
import pams_submissions  # noqa: E402
import publish_approved  # noqa: E402
import weekly_lead_report  # noqa: E402


class FakeResp:
    status_code = 200

    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data

    def raise_for_status(self):
        pass


class NotKinFilter(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.orig = (kit._rest, kit.requests.get)

        def fake_get(url, params=None, **_):
            self.calls.append((url, dict(params or {})))
            return FakeResp([])

        kit._rest = lambda env: ("https://x.supabase.co/rest/v1/premium_articles", {})
        # 모듈마다 import requests 한 같은 모듈 객체라 한 번 바꾸면 전부 바뀐다
        kit.requests.get = fake_get

    def tearDown(self):
        kit._rest, kit.requests.get = self.orig

    def review_calls(self):
        return [p for u, p in self.calls if u.endswith("/ad_reviews")]

    def assert_all_filtered(self):
        calls = self.review_calls()
        self.assertTrue(calls, "ad_reviews 조회가 없다")
        for p in calls:
            self.assertEqual(p.get("channel"), "neq.kin", p)

    def test_publish_approved(self):
        publish_approved.fetch_rows({})
        publish_approved.fetch_pending({})
        self.assert_all_filtered()

    def test_pams_queue(self):
        pams_queue.fetch_reviews({})
        self.assert_all_filtered()

    def test_pams_submissions(self):
        pams_submissions.fetch_reviews({})
        self.assert_all_filtered()

    def test_pams_folder_tidy(self):
        pams_folder_tidy.fetch_rows({})
        self.assert_all_filtered()

    def test_weekly_lead_report(self):
        weekly_lead_report.review_counts({}, "2026-10-01", "2026-10-08")
        self.assert_all_filtered()

    def test_content_analysis(self):
        content_analysis.db_reviews_and_titles({})
        self.assert_all_filtered()

    def test_publish_approved_survives_none_article(self):
        """필터가 빠져 kin 행이 섞여도 plan 은 그 행을 건너뛴다(글이 없으므로) — 마지막 방어선 확인."""
        rows = [{"id": "k", "article_id": None, "channel": "kin", "status": "approved"}]
        self.assertEqual(publish_approved.plan(rows, {}, "2026-10-09"), [])


class KinRecordBody(unittest.TestCase):
    def setUp(self):
        self.orig = (kit._rest, kin_pipeline.requests.post)
        kit._rest = lambda env: ("https://x.supabase.co/rest/v1/premium_articles", {})
        self.posted = []

        def fake_post(url, json=None, **_):
            self.posted.append(json)
            r = FakeResp([{"id": "new"}])
            r.status_code = 201
            return r

        kin_pipeline.requests.post = fake_post

    def tearDown(self):
        kit._rest, kin_pipeline.requests.post = self.orig

    def test_body_matches_006_check(self):
        rec = {"id": "1009_지식인_1", "question_url": "q", "answer_sha256": "h", "kin_answer_id": "uuid-1"}
        rid, _ = kin_pipeline.record_review({}, rec, "2026-10-1234", "2026-10-09", "2027-10-08")
        self.assertEqual(rid, "new")
        b = self.posted[0]
        self.assertEqual((b["channel"], b["review_type"], b["kin_answer_id"]), ("kin", "jisikin", "uuid-1"))
        self.assertNotIn("article_id", b)

    def test_no_kin_answer_id_does_not_post(self):
        rid, msg = kin_pipeline.record_review({}, {"id": "x", "question_url": "q", "answer_sha256": "h"},
                                              "2026-10-1234", "2026-10-09", "2027-10-08")
        self.assertIsNone(rid)
        self.assertEqual(self.posted, [])
        self.assertIn("kin_answers", msg)


if __name__ == "__main__":
    unittest.main()
