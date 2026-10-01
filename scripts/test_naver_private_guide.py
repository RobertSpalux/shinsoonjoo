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
        self.assertIn("저장 위치를 Downloads\\PAMS접수\\ 로", j)       # 저장만 하면 zip 자동
        self.assertIn("압축은 하지 않는다", j)
        self.assertIn("7호.pdf", j)

    def test_keyword_example_from_title(self):
        self.assertEqual(g.keyword_of("백내장 실비 청구했는데 통원으로만 나왔다면 — 입원 필요성이 기록에 남아야 합니다"), "백내장")
        s = "\n".join(g.steps("10호", "백내장 실비 청구했는데 통원으로만 나왔다면", 3, "b"))
        self.assertIn("핵심어(예: 백내장)", s)
        self.assertIn("백내장.pdf", s)

    def test_title_only_once_in_a_box(self):
        """2026-10-01 7호: 제목처럼 보이는 줄이 둘이라 헷갈렸다 — 제목은 맨 위 상자 하나뿐, 할 일 목록에는 다시 쓰지 않는다."""
        self.assertFalse(any("제목 그대로" in l for l in self.s), "할 일 목록에 제목을 다시 쓰지 않는다")
        box = g.title_box("제목 그대로")
        self.assertEqual(box[0], g.TITLE_BOX)
        self.assertEqual(sum(1 for l in box if l.strip() == "제목 그대로"), 1)
        self.assertIn("📄", box[-1])                     # 본문 끝 본진 링크 줄은 제목이 아님
        j = "\n".join(self.s)
        self.assertIn("맨 위 상자의 제목", j)
        self.assertIn("따옴표 문장은 본문 첫 줄이니 지우지 않는다", j)
        self.assertIn("자리표시 줄([이미지…])만 지운다", j)
        self.assertNotIn("**", j, "png·txt 에 마크다운 별표가 그대로 찍힌다")
        # 한 장 png 는 들여쓴 보조 줄을 싣지 않는다 — 첫 줄 경고는 번호 줄 안에 있어야 png 에도 나온다
        h = g.one_page_html("7호", "slug", "제목", self.s, 3)
        self.assertIn("본문 첫 줄이니 지우지 않는다", h)

    def test_title_trailing_punct_refused(self):
        self.assertEqual(g.check_title(" 제목 "), "제목")
        for t in ("제목.", "제목?", "제목…", ""):
            with self.assertRaises(kit.KitError):
                g.check_title(t)

    def test_one_page_title_box(self):
        h = g.one_page_html("7호", "slug", "부모님 제목", self.s, 3)
        self.assertEqual(h.count("부모님 제목"), 1)
        self.assertIn("제목 칸에 붙여 넣을 제목", h)

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
