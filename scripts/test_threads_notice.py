#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
스레드 필수안내 이미지 렌더 테스트 — python scripts/test_threads_notice.py

- 8683호 재렌더 자구 = 8683 게시본(팜스 스레드 승인본) 10문장 그대로
- 줄바꿈 = 8683 게시본 실측(13줄), 폰트가 달라도 흔들리지 않는다
- 심의필 줄만 인자로 바뀐다(7550), 형식 「제{번호}호 ({시작}~{끝})」
- 번호에 「심의필」·「호」 등 전체 문구를 넣으면 거절한다(이중 표기 방지)
"""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "threads_notice.py")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

APPROVED_8683 = [
    "1. 본 내용은 모집종사자 개인의 의견이며, 계약체결에 따른 이익 또는 손실은 보험계약자 등에게 귀속됩니다.",
    "보험사 상품별로 성별, 연령, 직업(급수)에 따라 가입가능한 담보와 가입금액, 보험료 등은 상이할 수 있습니다.",
    "보험사 상품별로 상이할 수 있으므로,관련한 세부사항은 반드시 약관을 참조 바랍니다.",
    "2. 필수안내사항",
    "신순주,손생보협회 등록번호 - 20030976050033",
    "본 광고는 광고심의기준을 준수하였으며, 유효기간은 심의일로부터 1년입니다.",
    "보험계약자가 기존 보험계약을 해지하고 새로운 보험계약을 체결하는 과정에서",
    "① 질병이력, 연령증가 등으로 가입이 거절되거나 보험료가 인상될 수 있습니다.",
    "②가입 상품에 따라 새로운 면책기간 적용 및 보장 제한 등 기타 불이익이 발생할 수 있습니다.",
    "프라임에셋 심의필 제2026-07-8683호 (2026.07.29~2027.07.28)",
]
# 8683 스레드 게시본 이미지 실측 줄바꿈( | = 줄바꿈)
POSTED_BREAKS_8683 = [
    "1. 본 내용은 모집종사자 개인의 의견이며, 계약체결에 따른 이익 또는 손실은 | 보험계약자 등에게 귀속됩니다.",
    "보험사 상품별로 성별, 연령, 직업(급수)에 따라 가입가능한 담보와 가입금액, | 보험료 등은 상이할 수 있습니다.",
    "보험사 상품별로 상이할 수 있으므로,관련한 세부사항은 반드시 약관을 참조 | 바랍니다.",
    "2. 필수안내사항",
    "신순주,손생보협회 등록번호 - 20030976050033",
    "본 광고는 광고심의기준을 준수하였으며, 유효기간은 심의일로부터 1년입니다.",
    "보험계약자가 기존 보험계약을 해지하고 새로운 보험계약을 체결하는 | 과정에서",
    "① 질병이력, 연령증가 등으로 가입이 거절되거나 보험료가 인상될 수 | 있습니다.",
    "②가입 상품에 따라 새로운 면책기간 적용 및 보장 제한 등 기타 불이익이 | 발생할 수 있습니다.",
    "프라임에셋 심의필 제2026-07-8683호 (2026.07.29~2027.07.28)",
]


def render(no, frm, to):
    d = tempfile.mkdtemp()
    png, dump = os.path.join(d, "n.png"), os.path.join(d, "n.txt")
    r = subprocess.run([sys.executable, SCRIPT, "--review-no", no, "--from", frm, "--to", to,
                        "--out", png, "--dump", dump], capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        return r, None, None
    text = open(dump, encoding="utf-8").read()
    src, shown = text.split("\n\n# 이미지 줄바꿈\n")
    return r, src.rstrip("\n").split("\n"), shown.rstrip("\n").split("\n")


class ThreadsNoticeTest(unittest.TestCase):
    def test_8683_rerender_wording_identical(self):
        r, src, shown = render("2026-07-8683", "2026.07.29", "2027.07.28")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(src, APPROVED_8683)

    def test_8683_line_breaks_match_posted(self):
        _, _, shown = render("2026-07-8683", "2026.07.29", "2027.07.28")
        self.assertEqual(shown, POSTED_BREAKS_8683)

    def test_7550_only_review_line_differs(self):
        _, src, shown = render("2026-09-7550", "2026.09.29", "2027.09.28")
        self.assertEqual(src[:-1], APPROVED_8683[:-1])
        self.assertEqual(src[-1], "프라임에셋 심의필 제2026-09-7550호 (2026.09.29~2027.09.28)")
        self.assertEqual(shown[:-1], POSTED_BREAKS_8683[:-1])

    def test_full_phrase_number_rejected(self):
        r, _, _ = render("프라임에셋 심의필 제2026-09-7550호", "2026.09.29", "2027.09.28")
        self.assertNotEqual(r.returncode, 0)

    def test_bad_date_rejected(self):
        r, _, _ = render("2026-09-7550", "2026-09-29", "2027.09.28")
        self.assertNotEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
