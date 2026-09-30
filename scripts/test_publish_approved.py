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


class T2(unittest.TestCase):
    def test_review_line(self):
        self.assertEqual(pa.review_line({**ROW, "review_authority": "프라임에셋"}),
                         "프라임에셋 심의필 제2026-09-7998호 (2026.09.30~2027.09.29)")

    def test_copy_images_numbered(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            names = pa.copy_images("caregiver-daily-benefit-support-vs-use", d, "0930_6호_네이버")
            self.assertEqual(names, [f"0930_6호_네이버_이미지{i}.png" for i in (1, 2, 3)], "순서 번호 파일명")
            self.assertTrue(all(os.path.getsize(os.path.join(d, n)) > 0 for n in names), "실물 복사")
            self.assertEqual(pa.copy_images("no-such-slug", d, "x"), [], "사진 없으면 빈 목록 — 지어내지 않는다")

    def test_match_rss(self):
        arts = {"a1": {"naver_title": "간병인 쓰고 간병비보험 청구하려면 — 영수증 말고도 챙길 서류가 있습니다"}}
        row = {**ROW, "channel": "naver"}
        items = [("간병인 쓰고 간병비보험 청구하려면 —  영수증 말고도 챙길 서류가 있습니다", "https://blog.naver.com/x/1"),
                 ("다른 글", "https://blog.naver.com/x/2")]
        ok, ask = pa.match_rss(items, [row], arts)
        self.assertEqual([l for _, l in ok], ["https://blog.naver.com/x/1"], "공백 차이 무시, 제목 완전 일치만")
        ok, ask = pa.match_rss(items + [(items[0][0], "https://blog.naver.com/x/3")], [row], arts)
        self.assertEqual((ok, len(ask)), ([], 1), "같은 제목 2개면 묻는다")
        ok, ask = pa.match_rss([("간병인 쓰고", "https://x")], [row], arts)
        self.assertEqual((ok, ask), ([], []), "부분 일치는 짝이 아니다")

    def test_plan_flags(self):
        arts = {"a1": {"id": "a1", "slug": "s1", "is_naver_published": False}}
        nv = {**ROW, "channel": "naver", "posted_url": "https://blog.naver.com/x/1"}
        self.assertEqual([f[2] for f in pa.plan_flags([nv], arts, T)], ["is_naver_published"])
        self.assertEqual(pa.plan_flags([{**nv, "posted_url": None}], arts, T), [], "URL 없으면 켜지 않는다")
        self.assertEqual(pa.plan_flags([{**nv, "review_to": "2026-09-29"}], arts, T), [], "만료면 켜지 않는다")
        self.assertEqual(pa.plan_flags([nv], {"a1": {**arts["a1"], "is_naver_published": True}}, T), [])
        th = {**nv, "channel": "threads", "posted_url": "https://www.threads.com/@goodfinance_sj/post/x"}
        self.assertEqual([f[2] for f in pa.plan_flags([th], {"a1": {**arts["a1"], "is_threads_published": False}}, T)],
                         ["is_threads_published"], "스레드도 게시 URL 이 있으면 배포 체크 ON")

    def test_publish_msg(self):
        m = pa.publish_msg("caregiver-daily-benefit-support-vs-use", "https://goodfinance.kr/news/x",
                           {**ROW, "id": "329a6c53-b597", "review_authority": "프라임에셋"})
        lines = m.split("\n")
        self.assertEqual(len(lines), 5, "텔레그램 1통 = 머리 + ①~④")
        self.assertTrue(lines[0].startswith("✅ [본진 자동 게시] 6호"))
        self.assertEqual(lines[1], "① 발행: https://goodfinance.kr/news/x")
        self.assertEqual(lines[2], "② 라이브 심의필 확인: 프라임에셋 심의필 제2026-09-7998호 (2026.09.30~2027.09.29)")
        self.assertTrue(lines[3].startswith("③ posted_url 기록: ad_reviews 329a6c53"))
        self.assertTrue(lines[4].startswith("④ 팜스 게시위치(＋)"))


if __name__ == "__main__":
    unittest.main()
