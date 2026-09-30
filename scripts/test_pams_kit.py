#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PAMS 접수 문자열(.txt) 형식 테스트 — python scripts/test_pams_kit.py

robert-os pams_apply 가 이 .txt 의 줄을 읽어 PAMS 칸을 채운다.
2026-09-30 7호·8호 본진 재채움에서 게시(사용)위치·규격 두 칸이 비었다 — 키트에 줄이 없었다.
본진 키트에 「게시위치:」「규격:」 줄이 반드시 있고, robert-os 파서가 그 값을 그대로 읽는지 고정한다.
네트워크·DB·로컬 서버 없음.
"""
import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_kit as kit  # noqa: E402

ROBERT_OS_APPLY = r"D:\robert-os\finance\pams_apply.py"
SLUG = "manual-therapy-silson-by-rider-managed-benefit"
SRC = ["금융위원회·금융감독원, 5세대 실손보험 Q&A, 2026, 2026.5.6"]
FILES = ["금융위원회·금융감독원, 5세대 실손보험 Q&A, 2026, 2026.5.6.pdf", "제목.pdf"]


def lines(channel, slug=SLUG):
    return kit.kit_lines(slug, channel, "도수치료 실비 제목", "title 정리", SRC, FILES)


class MainKitLines(unittest.TestCase):
    def test_main_has_location_and_spec(self):
        ls = lines("main")
        self.assertIn(f"게시위치: https://goodfinance.kr/news/{SLUG}", ls)
        # 규격은 비운다(로버트 2026-09-30 「규격은 중요하지 않다」) — 값이 없으면 「규격:」 줄 자체가 없다
        self.assertEqual(kit.MAIN_SPEC, "")
        self.assertFalse(any(l.startswith("규격") for l in ls))

    def test_location_is_confirmed_url_pattern(self):
        # PAMS 게시위치 등록 실물(9200호): https://goodfinance.kr/news/health-checkup-retest-disclosure-scope
        self.assertEqual(kit.main_location("health-checkup-retest-disclosure-scope"),
                         "https://goodfinance.kr/news/health-checkup-retest-disclosure-scope")

    def test_spec_not_empty(self):
        orig = kit.MAIN_SPEC   # 값을 다시 넣으면 줄이 생긴다(상수 하나로 되돌릴 수 있게)
        kit.MAIN_SPEC = "해당 없음"
        try:
            self.assertIn("규격: 해당 없음", lines("main"))
        finally:
            kit.MAIN_SPEC = orig

    def test_order_title_then_location_spec_then_form(self):
        ls = lines("main")
        i = {k: next(n for n, l in enumerate(ls) if l.startswith(k)) for k in ("게시명:", "게시위치:", "광고형태:")}
        self.assertLess(i["게시명:"], i["게시위치:"])
        self.assertLess(i["게시위치:"], i["광고형태:"])

    def test_existing_lines_unchanged(self):
        ls = lines("main")
        self.assertEqual(ls[0], f"[PAMS 접수 문자열] 8호 · 본진 · {SLUG}")
        self.assertIn("게시명: 도수치료 실비 제목", ls)
        self.assertIn("광고형태: 홈페이지", ls)
        self.assertIn("- " + SRC[0], ls)
        self.assertEqual(ls[-2:], ["- " + FILES[0], "- " + FILES[1]])

    def test_naver_unchanged(self):
        # 네이버는 게시 URL 이 비공개 게시 뒤에 정해진다 — 이번 범위 밖(줄 없음 유지)
        ls = lines("naver")
        self.assertFalse(any(l.startswith("게시위치:") or l.startswith("규격:") for l in ls))
        self.assertIn("광고형태: 바이럴(블로그 등)", ls)


class TitleLabel(unittest.TestCase):
    """알림 표기 — 글 제목이 앞, 호수는 뒤 괄호로만. 키트 파일명은 그대로."""

    def test_title_first_issue_in_parens(self):
        self.assertEqual(kit.title_label("도수치료 실비, 앞으로도 계속 나올까 — 내 실손의 구조와 특약에 따라 갈립니다", SLUG),
                         "도수치료 실비, 앞으로도 계속 나올까 (8호)")

    def test_no_issue_number_title_only(self):
        self.assertEqual(kit.title_label("호수 없는 글 제목", "no-issue-slug-xyz"), "호수 없는 글 제목")

    def test_no_title_falls_back(self):
        self.assertEqual(kit.title_label(None, SLUG), "8호")
        self.assertEqual(kit.title_label("", "no-issue-slug-xyz"), "no-issue-slug-xyz")

    def test_kit_filename_unchanged(self):
        from datetime import datetime
        self.assertEqual(kit.kit_basename(SLUG, "main", datetime(2026, 9, 30, tzinfo=kit.KST)), "0930_8호_본진")


@unittest.skipUnless(os.path.exists(ROBERT_OS_APPLY), "robert-os pams_apply.py 없음")
class RobertOsParser(unittest.TestCase):
    """robert-os 파서(키트읽기)로 실제로 읽어 본다 — 줄 이름이 어긋나면 여기서 깨진다."""

    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("pams_apply", ROBERT_OS_APPLY)
        cls.pa = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.pa)

    def test_parse_main(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "0930_8호_본진.txt"
            p.write_text("\n".join(lines("main")) + "\n", encoding="utf-8")
            r = self.pa.키트읽기(p)
        self.assertEqual(r["게시명"], "도수치료 실비 제목")
        self.assertEqual(r["게시위치"], f"https://goodfinance.kr/news/{SLUG}")
        self.assertEqual(r["규격"], "")   # 줄이 없으면 robert-os 파서는 빈 값으로 읽는다(칸 비움)
        self.assertEqual(r["광고형태"], "홈페이지")
        self.assertEqual(self.pa.광고형태코드(r), "homp")
        self.assertIn(SRC[0], r["증빙자료명"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
