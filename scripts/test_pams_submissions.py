#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PAMS 접수 → ad_reviews 행 자동 생성 판정 — python scripts/test_pams_submissions.py (네트워크 없음)"""
import os
import sys
import unittest
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import pams_kit as kit  # noqa: E402
import pams_submissions as ps  # noqa: E402

NOW = datetime(2026, 10, 2, 18, 0, tzinfo=kit.KST)
SLUGS = {7: "ltc", 8: "manual", 13: "corn", 11: "eswl"}
# 2026-10-02 감시기 실제 기록 모양 그대로
APPLY = {
    "1002_13호_본진": {"게시명": "티눈 제거도 수술비 보험금 나오나 질병수술비 약관의 피부질환 조항이 가릅니다",
                     "접수": {"시각": "2026-10-02T16:52:13+09:00", "seq": "656424", "진행사항": "심사중", "신청일시": "2026-10-02 16:51"}},
    "1002_11호_본진": {"게시명": "체외충격파 실비…",
                     "접수": {"시각": "2026-10-02T14:50:11+09:00", "진행사항": "심사중", "신청일시": "2026-10-02 14:21",
                            "사람조작": "2026-10-02T14:21:09+09:00 | alert | 정상적으로 저장되었습니다. | https://pams.kr/fc/gumsocheck/jumgumpyosave.jsp?nowdt=0&srcgbn=0&seq=656168"}},
    "0930_8호_본진": {"접수": {"시각": "2026-10-01T18:29:28+09:00", "seq": "655459", "진행사항": "심사중", "신청일시": "2026-10-01 18:29"}},
    "1001_7호_네이버": {"게시명": "부모님 …", "접수": {"시각": "2026-10-01T20:42:32+09:00", "seq": "655494", "진행사항": "심사중",
                                               "신청일시": "2026-10-01 20:42"}},
    "0929_스레드_간병가족": {"접수": {"시각": "2026-09-30T07:56:54+09:00", "진행사항": "심사중"}},
    "1002_9호_본진": {"접수": None},
}


class Pending(unittest.TestCase):
    def test_missing_rows_found(self):
        got = {(p["slug"], p["channel"], p["seq"]) for p in ps.pending(APPLY, [], SLUGS, NOW)}
        self.assertEqual(got, {("corn", "main", "656424"), ("eswl", "main", "656168"),
                               ("manual", "main", "655459"), ("ltc", "naver", "655494")})

    def test_existing_active_row_skips(self):
        rv = [{"slug": "corn", "channel": "main", "status": "submitted", "notes": ""}]
        self.assertNotIn("corn", [p["slug"] for p in ps.pending(APPLY, rv, SLUGS, NOW)])

    def test_rejected_then_bowan_same_seq_skips(self):
        """반송 → [보완] 은 같은 seq — 새 행을 만들지 않는다(감시기가 기존 행 상태를 바꾼다)."""
        rv = [{"slug": "manual", "channel": "main", "status": "rejected", "notes": "PAMS 실제 접수 … PAMS seq 655459 …"}]
        self.assertNotIn("manual", [p["slug"] for p in ps.pending(APPLY, rv, SLUGS, NOW)])

    def test_rejected_then_new_submission_creates(self):
        rv = [{"slug": "corn", "channel": "main", "status": "rejected", "notes": "PAMS seq 600000"}]
        self.assertIn("corn", [p["slug"] for p in ps.pending(APPLY, rv, SLUGS, NOW)])

    def test_slug_keys_from_1021(self):
        """10/21 부터 키가 MMDD_<slug>_채널 — AR1: N호 만 받던 KEY_RX 가 4건을 놓쳤다."""
        ap = {
            "1020_corporate-policy-owner-beneficiary-check_본진": {"게시명": "법인", "접수": {
                "시각": "2026-10-21T10:13:29+09:00", "진행사항": "심사중", "신청일시": "2026-10-21 10:12",
                "사람조작": "x | https://pams.kr/fc/gumsocheck/jumgumpyosave.jsp?nowdt=0&srcgbn=0&seq=669989 | 키트 1020_corporate-policy-owne"}},
            "1020_health-checkup-retest-recommendation-disclosure_본진": {"접수": {
                "시각": "2026-10-21T11:15:22+09:00", "seq": "670243", "진행사항": "심사중", "신청일시": "2026-10-21 11:14"}},
            "1021_annuity-start-age-payout-type-check_본진": {"접수": {
                "시각": "2026-10-22T10:45:50+09:00", "seq": "671383", "진행사항": "심사중", "신청일시": "2026-10-22 10:45"}},
            "1021_존재하지 않는 slug_본진": {"접수": {"시각": "2026-10-22T10:45:50+09:00", "seq": "1", "진행사항": "심사중"}},
        }
        now = datetime(2026, 10, 22, 12, 0, tzinfo=kit.KST)
        got = {(p["slug"], p["seq"]) for p in ps.pending(ap, [], SLUGS, now)}
        self.assertEqual(got, {("corporate-policy-owner-beneficiary-check", "669989"),
                               ("health-checkup-retest-recommendation-disclosure", "670243"),
                               ("annuity-start-age-payout-type-check", "671383")})

    def test_slug_keys_skip_retroactive_rows(self):
        """관제탑 소급 행(submitted · notes 「관제탑 소급」)이 있으면 중복 생성 금지."""
        ap = {"1021_annuity-start-age-payout-type-check_본진": {"접수": {
            "시각": "2026-10-22T10:45:50+09:00", "seq": "671383", "진행사항": "심사중", "신청일시": "2026-10-22 10:45"}}}
        now = datetime(2026, 10, 22, 12, 0, tzinfo=kit.KST)
        rv = [{"slug": "annuity-start-age-payout-type-check", "channel": "main", "status": "submitted", "notes": "관제탑 소급"}]
        self.assertEqual(ps.pending(ap, rv, SLUGS, now), [])

    def test_old_records_and_threads_ignored(self):
        later = datetime(2026, 10, 9, tzinfo=kit.KST)
        self.assertEqual(ps.pending(APPLY, [], SLUGS, later), [], "3일 넘은 접수 기록으로는 행을 만들지 않는다")

    def test_note(self):
        p = ps.pending(APPLY, [], SLUGS, NOW)
        n = ps.note_for([x for x in p if x["slug"] == "corn"][0], {"hash": "ab" * 32, "zip": r"C:\x\1002_13호_본진.zip"})
        self.assertIn("PAMS seq 656424", n)          # 다음 바퀴에 같은 seq 로 두 번 만들지 않게
        self.assertIn("키트 해시 sha256 " + "ab" * 32 + " (1002_13호_본진.zip)", n)

    def test_pams_auto_hook_isolated(self):
        src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pams_auto.py"), encoding="utf-8").read()
        i = src.index("pams_submissions.sync(env, state")
        self.assertIn("except Exception", src[i:i + 300])
        self.assertLess(i, src.index("review_lock.stamp(env, state"), "행을 먼저 만들어야 같은 바퀴에 원고해시가 기록된다")


TITLE32 = "연금보험 수령액, 어떻게 정해지나요? 종신형 확정기간형과 공시이율 기준"
# 2026-11-04 감시기 실제 기록 모양(게시명은 공백·문장부호가 떨어져 있다)
ROW32 = {"게시명": "연금보험수령액어떻게정해지나요종신형확정기간형과공시이율기준", "진행사항": "반송",
         "신청일시": "2026-11-03 09:52", "seq": "682637"}
ART32 = {"slug": "annuity-payout-amount-type-rate-check", "title": "연금 수령액 기준", "naver_title": TITLE32, "ad_reviews": []}
OTHER = {"slug": "other-article", "title": "전혀 다른 글 제목입니다 보험 점검", "naver_title": "다른 네이버 제목입니다 점검", "ad_reviews": []}
NOW32 = datetime(2026, 11, 4, 10, 0, tzinfo=kit.KST)


class Unmatched(unittest.TestCase):
    """LG1 — 신청서 채우기 실패(ok:false) 후 손으로 낸 접수는 pams_apply_대기.json 에 없다. 감시기 짝없음 기록으로 덮는다."""

    def test_title_match_creates_naver_row(self):
        todo, bad = ps.pending_unmatched([ROW32], [], [ART32, OTHER], [], NOW32)
        self.assertEqual(bad, [])
        self.assertEqual([(p["slug"], p["channel"], p["seq"]) for p in todo],
                         [("annuity-payout-amount-type-rate-check", "naver", "682637")])
        self.assertEqual(todo[0]["게시명"], "", "PAMS 목록 게시명(공백 없음)을 행 제목으로 쓰지 않는다")
        self.assertIn("PAMS seq 682637", ps.note_for(todo[0]))

    def test_kit_txt_match_wins(self):
        kits = [("annuity-payout-amount-type-rate-check", "naver", TITLE32.replace("?", ""))]
        todo, _ = ps.pending_unmatched([ROW32], [], [OTHER], kits, NOW32)
        self.assertEqual([(p["slug"], p["channel"]) for p in todo], [("annuity-payout-amount-type-rate-check", "naver")])
        self.assertEqual(todo[0]["via"], "키트 txt 게시명")

    def test_no_duplicate_of_manual_row_245f6e3b(self):
        """관제탑 수동 행(notes 에 seq 682637)이 있으면 — 상태가 무엇이든 — 새 행을 만들지 않는다."""
        for st in ("submitted", "rejected", "approved"):
            rv = [{"slug": ART32["slug"], "channel": "naver", "status": st, "notes": "관제탑 수동 연결 · PAMS seq 682637"}]
            self.assertEqual(ps.pending_unmatched([ROW32], rv, [ART32], [], NOW32), ([], []), st)

    def test_seq_prefix_is_not_a_match(self):
        rv = [{"slug": "x", "channel": "main", "status": "submitted", "notes": "PAMS seq 6826370"}]
        todo, _ = ps.pending_unmatched([ROW32], rv, [ART32], [], NOW32)
        self.assertEqual(len(todo), 1)

    def test_active_row_without_seq_is_reported_not_duplicated(self):
        rv = [{"slug": ART32["slug"], "channel": "naver", "status": "submitted", "notes": ""}]
        todo, bad = ps.pending_unmatched([ROW32], rv, [ART32], [], NOW32)
        self.assertEqual(todo, [])
        self.assertIn("진행 중 행", bad[0]["사유"])

    def test_no_candidate_and_ambiguous_are_reported(self):
        _, bad = ps.pending_unmatched([ROW32], [], [OTHER], [], NOW32)
        self.assertEqual(bad[0]["사유"], "후보 없음")
        twin = dict(ART32, slug="twin")
        todo, bad = ps.pending_unmatched([ROW32], [], [ART32, twin], [], NOW32)
        self.assertEqual(todo, [])
        self.assertIn("후보 2개", bad[0]["사유"])

    def test_old_rows_ignored(self):
        later = datetime(2026, 12, 1, tzinfo=kit.KST)
        self.assertEqual(ps.pending_unmatched([ROW32], [], [ART32], [], later), ([], []))

    def test_alert_once_by_fingerprint(self):
        import tempfile, json as js
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "u.json")
            js.dump({"행": [ROW32]}, open(path, "w", encoding="utf-8"), ensure_ascii=False)
            sent, state = [], {}
            for _ in range(3):   # 바퀴가 여러 번 돌아도 같은 건은 한 번만
                ps.unmatched_todo({}, state, sent.append, lambda m: None, path=path, reviews=[], articles=[OTHER], kits=[])
            self.assertEqual(len(sent), 1)
            self.assertIn("682637", sent[0])

    def test_missing_or_empty_file(self):
        self.assertEqual(ps.unmatched_todo({}, {}, print, print, path=r"Z:\none\x.json", reviews=[], articles=[], kits=[]), [])

    def test_kit_titles_reads_header_and_title(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "_접수완료"))
            open(os.path.join(d, "_접수완료", "k.txt"), "w", encoding="utf-8").write(
                "[PAMS 접수 문자열] 32호 · 네이버 · annuity-payout-amount-type-rate-check\n\n게시명: 제목 하나\n광고형태: 바이럴\n")
            self.assertEqual(ps.kit_titles([d]), [("annuity-payout-amount-type-rate-check", "naver", "제목 하나")])


if __name__ == "__main__":
    unittest.main(verbosity=1)
