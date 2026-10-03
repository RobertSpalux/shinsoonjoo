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


if __name__ == "__main__":
    unittest.main(verbosity=1)
