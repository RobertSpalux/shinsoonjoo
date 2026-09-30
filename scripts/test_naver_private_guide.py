#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""네이버 비공개 게시 안내 — 순수 부분 시험. python scripts/test_naver_private_guide.py"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import naver_private_guide as g  # noqa: E402
import pams_kit as kit  # noqa: E402


class Steps(unittest.TestCase):
    def setUp(self):
        self.s = g.steps("7호", "제목 그대로", 3, "0930_7호_네이버비공개")

    def test_private_and_capture_rules(self):
        j = "\n".join(self.s)
        self.assertIn("「비공개」 → 발행", j)
        self.assertIn("「비공개」 표시가 화면에 보이게", j)
        self.assertIn("공란(제_____호) 그대로", j)
        self.assertIn("「7호」", j)                       # pams_auto 짝맞추기 = 파일명에 N호
        self.assertIn("Downloads\PAMS접수\ 에 저장", j)

    def test_title_verbatim(self):
        self.assertIn("     제목 그대로", self.s)

    def test_images(self):
        self.assertTrue(any("사진 3장" in l for l in self.s))
        self.assertTrue(any("사진 없음" in l for l in g.steps("7호", "t", 0, "b")))

    def test_out_dir_not_capture_folder(self):
        # PAMS접수 바로 아래 png/pdf 는 pams_auto 가 네이버 캡처로 짝짓는다 — 하위 폴더여야 한다
        self.assertNotEqual(os.path.normcase(g.OUT_DIR), os.path.normcase(kit.KIT_DIR))
        self.assertEqual(os.path.normcase(os.path.dirname(g.OUT_DIR)), os.path.normcase(kit.KIT_DIR))

    def test_one_page_no_double_numbering(self):
        h = g.one_page_html("7호", "slug", "제목", self.s, 3)
        self.assertNotIn("<li>1. ", h)
        self.assertEqual(h.count("<li>"), sum(1 for l in self.s if not l.startswith(" ")))

    def test_format_line(self):
        self.assertIn("configs/naver-format.json", g.format_line())
        self.assertNotIn("읽기 실패", g.format_line())


if __name__ == "__main__":
    unittest.main(verbosity=1)
