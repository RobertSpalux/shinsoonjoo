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


class Conditional(unittest.TestCase):
    """2026-10-02 8호 본진 — 조건 붙은 승인(비고 GA명장)이 자동 공개됐다가 반송됐다."""
    REMARK8 = "[GA명장]: 2026년 GA명장 증빙자료를 첨부하세요. 혹은 [22~25년 GA명장] 등의 표현으로 수정해주시기 바랍니다."

    def test_condition_remark(self):
        self.assertIsNone(pa.condition_remark(ROW))
        self.assertIsNone(pa.condition_remark({**ROW, "notes": f"접수 메모\n{pa.REMARK_PREFIX} {pa.STANDARD_REMARK}"}),
                          "표준 승인 문구는 조건이 아니다")
        self.assertEqual(pa.condition_remark({**ROW, "notes": f"x\n{pa.REMARK_PREFIX} {self.REMARK8}"}), self.REMARK8)
        self.assertEqual(pa.condition_remark({**ROW, "notes": "진행사항 조건부 승인"}), "조건부 승인")

    def test_plan_holds_conditional(self):
        cond = {**ROW, "notes": f"{pa.REMARK_PREFIX} {self.REMARK8}"}
        p = pa.plan([cond], ART, T)
        self.assertFalse(p[0]["ok"])
        self.assertIn("조건 붙은 승인", p[0]["why"])
        self.assertEqual(p[0]["cond"], self.REMARK8)
        self.assertTrue(pa.plan([ROW], ART, T)[0]["ok"], "조건 없는 승인은 그대로 자동 공개")

    def test_rejected_live(self):
        arts = {"a1": {"id": "a1", "slug": "s1", "is_main_published": True},
                "a2": {"id": "a2", "slug": "s2", "is_main_published": True},
                "a3": {"id": "a3", "slug": "s3", "is_main_published": False}}
        rows = [{"id": "x1", "article_id": "a1", "channel": "main", "status": "rejected", "created_at": "2026-10-01T09:00"},
                {"id": "x2", "article_id": "a2", "channel": "main", "status": "rejected", "created_at": "2026-09-01T09:00"},
                {"id": "x3", "article_id": "a2", "channel": "main", "status": "approved", "created_at": "2026-09-05T09:00"},
                {"id": "x4", "article_id": "a3", "channel": "main", "status": "rejected", "created_at": "2026-10-01T09:00"},
                {"id": "x5", "article_id": "a1", "channel": "naver", "status": "approved", "created_at": "2026-10-02T09:00"}]
        got = [(a["slug"], r["id"]) for a, r in pa.rejected_live(rows, arts)]
        self.assertEqual(got, [("s1", "x1")], "최근 본진 행이 반송이고 공개 중인 글만 — 재승인 글·이미 비공개 글 제외")


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
        self.assertEqual(lines[0], "✅ [본진 자동 게시] 6호")   # 제목을 못 받으면 호수만
        m2 = pa.publish_msg("caregiver-daily-benefit-support-vs-use", "u", {**ROW, "id": "329a6c53-b597", "review_authority": "프라임에셋"},
                            "간병인 지원일당과 사용일당, 내 간병비보험 증권엔 어느 쪽이 들어 있나요")
        self.assertEqual(m2.split("\n")[0],"✅ [본진 자동 게시] 간병인 지원일당과 사용일당, 내 간병비보험 증권엔 어느 쪽이 들어 있나요 (6호)")
        self.assertEqual(lines[1], "① 발행: https://goodfinance.kr/news/x")
        self.assertEqual(lines[2], "② 라이브 심의필 확인: 프라임에셋 심의필 제2026-09-7998호 (2026.09.30~2027.09.29)")
        self.assertTrue(lines[3].startswith("③ posted_url 기록: ad_reviews 329a6c53"))
        self.assertTrue(lines[4].startswith("④ 팜스 게시위치(＋)"))


class Overdue(unittest.TestCase):
    """🔴 게시위치 미등록 = 신규·연장 심의 제한 사유 — 승인 뒤 24시간이 지나도 비어 있으면 알린다."""

    def setUp(self):
        from datetime import datetime, timedelta, timezone
        self.now = datetime(2026, 10, 2, 12, 0, tzinfo=timezone(timedelta(hours=9)))
        self.old = "2026-10-01T02:00:00+00:00"    # 승인 25시간 전(KST 11:00 기준 → 12:00 이면 25시간)
        self.new = "2026-10-02T01:00:00+00:00"    # 2시간 전

    def row(self, **k):
        r = {"id": "r1", "channel": "main", "status": "approved", "review_no": "2026-10-1234",
             "reviewed_at": self.old, "posted_url": None, "url_registered_at": None}
        r.update(k)
        return r

    def test_stages(self):
        got = pa.overdue([self.row(), self.row(id="r2", posted_url="https://goodfinance.kr/news/x")], self.now)
        self.assertEqual([(r["id"], s) for r, s in got], [("r1", "게시 전"), ("r2", "게시위치 등록 대기")])

    def test_not_yet_or_done_or_unknown(self):
        rows = [self.row(reviewed_at=self.new), self.row(url_registered_at="2026-10-01T05:00:00Z"),
                self.row(status="submitted"), self.row(reviewed_at=None), self.row(reviewed_at="엉뚱한값")]
        self.assertEqual(pa.overdue(rows, self.now), [])

    def test_watcher_rows_fall_back_to_review_from(self):
        # 감시기가 승인으로 바꾼 행은 reviewed_at 이 비어 있다(7987·7998 실측) — 심의필일자 0시(KST)부터 센다
        self.assertEqual(len(pa.overdue([self.row(reviewed_at=None, review_from="2026-10-01")], self.now)), 1)   # 36시간
        self.assertEqual(pa.overdue([self.row(reviewed_at=None, review_from="2026-10-02")], self.now), [])        # 12시간

    def test_naive_timestamp_is_utc(self):
        self.assertEqual(len(pa.overdue([self.row(reviewed_at="2026-10-01T02:00:00")], self.now)), 1)

    def test_message_names_the_next_action(self):
        m = pa.overdue_msg("백내장 수술 실손 (10호)", self.row(posted_url="u"), "게시위치 등록 대기", 24)
        self.assertTrue(m.startswith("🔴 게시위치 미등록 24시간+ — 백내장 수술 실손 (10호) 본진 제2026-10-1234호"))
        self.assertIn("감시기", m)
        self.assertIn("심의 제한", m)
        n = pa.overdue_msg("t", self.row(channel="naver"), "게시 전", 24)
        self.assertIn("공개로 전환", n)

    def test_wired_into_run_and_query(self):
        s = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "publish_approved.py"), encoding="utf-8").read()
        self.assertIn("reviewed_at\",\n        \"status\": \"eq.approved\"", s)
        i = s.index("def run(")
        self.assertIn("overdue(rows, datetime.now(KST))", s[i:])
        self.assertIn('key = f"overdue:{r[\'id\']}:{today}"', s[i:])


class Stale(unittest.TestCase):
    def test_stale_submitted(self):
        from datetime import datetime, timedelta, timezone
        now = datetime(2026, 10, 4, 12, 0, tzinfo=timezone.utc)
        rows = [{"id": "a", "status": "submitted", "submitted_at": "2026-10-01T09:00:00Z"},      # 75시간
                {"id": "b", "status": "under_review", "submitted_at": "2026-10-02T12:00:00Z"},   # 48시간
                {"id": "c", "status": "approved", "submitted_at": "2026-09-01T00:00:00Z"},
                {"id": "d", "status": "submitted", "submitted_at": None}]
        self.assertEqual([r["id"] for r in pa.stale_submitted(rows, now)], ["a"])

    def test_wired(self):
        s = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "publish_approved.py"), encoding="utf-8").read()
        i = s.index("def run(")
        self.assertIn("stale_submitted(pending, datetime.now(KST))", s[i:])


if __name__ == "__main__":
    unittest.main()
