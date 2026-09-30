# -*- coding: utf-8 -*-
"""pams_reply_kit 시험 — python scripts/test_pams_reply_kit.py (게이트는 npx tsx 로 실제 실행)."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pams_reply_kit as rk  # noqa: E402

LINK = "개인마다 계약이 달라 여기서 말씀드리기 어려워요. 프로필 링크로 상담 남겨 주시면 직접 보고 말씀드릴게요."
GOOD = [LINK, "읽어 주셔서 고맙습니다.", "해지는 되돌리기 어려워서, 담보별로 펼쳐 보고 판단하시는 게 안전해요. 바로 해지하지 마시고요.",
        "마음이 많이 쓰이시겠어요. 어머님 빨리 회복하시길 바랄게요."]
BAD = ["○○사 간병보험 추천해요. 제일 좋아요.", "보통 월 5만원대면 돼요.", "감사합니다! 무료 상담도 해드려요~",
       "네 전화드릴게요! (번호 되받기)"]
POST = "https://www.threads.com/@goodfinance_sj/post/Dd3Le5YASPf"


class T(unittest.TestCase):
    def test_good_to_sheet_bad_to_blocked(self):
        from openpyxl import load_workbook
        items = [{"post_url": POST, "comment": "부모님 거 봐주세요 010-1234-5678", "reply": r} for r in GOOD + BAD]
        with tempfile.TemporaryDirectory() as d:
            s = rk.build(items, out_dir=d, date="0930")
            self.assertEqual((s["접수"], s["막힘"]), (len(GOOD), len(BAD)))
            self.assertTrue(s["xlsx"].endswith(f"0930_댓글_{len(GOOD)}건.xlsx"))
            wb = load_workbook(s["xlsx"])
            rows = list(wb["접수"].iter_rows(values_only=True))
            self.assertEqual(rows[0][0], "번호")
            self.assertEqual([r[4] for r in rows[1:]], GOOD, "통과분만, 원고 그대로")
            self.assertTrue(all("****" in r[3] and "1234-5678" not in r[3] for r in rows[1:]), "댓글 전화번호는 가린다")
            self.assertEqual(len(list(wb["막힘"].iter_rows(values_only=True))) - 1, len(BAD))

    def test_from_replies_filters(self):
        d = {"댓글": {
            "1": {"계정": "goodfinance", "초안": "읽어 주셔서 고맙습니다.", "상태": "승인", "글": "잘 봤어요", "뿌리글_짧은": "AAA", "링크": "L1"},
            "2": {"계정": "goodfinance", "초안": None, "상태": "승인", "글": "x"},
            "3": {"계정": "baksatravel", "초안": "안녕하세요", "상태": "승인", "글": "y"},
            "4": {"계정": "goodfinance", "초안": "고맙습니다", "상태": "초안", "글": "z"},
        }}
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fp:
            json.dump(d, fp, ensure_ascii=False)
        try:
            items = rk.from_replies(fp.name, "승인")
        finally:
            os.unlink(fp.name)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["post_url"], "https://www.threads.com/@goodfinance_sj/post/AAA")

    def test_empty_reply_stops(self):
        with self.assertRaises(rk.KitError):
            rk.build([{"reply": "  "}], dry_run=True)


if __name__ == "__main__":
    unittest.main()
