#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""preflight 출처 자료명 — 앞머리가 같은 연작 자료 — python scripts/test_preflight_sources.py (네트워크 없음)"""
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import preflight as p  # noqa: E402

A = "주요 분쟁사례로 알아보는 소비자 유의사항 - 수술보험금 청구 관련 -"
B = "주요 분쟁사례로 알아보는 소비자 유의사항 -실손보험 관련유의사항 -"
C = "주요 분쟁사례로 알아보는 소비자 유의사항 -의료과실 사고 및 고지의무 관련 -"
D = "최근 판례로 알아보는 실손보험 등 관련 소비자 유의사항"
LEDGER = [A, B, C, D, "5세대 실손보험 Q&A"]


def flat(s):
    return re.sub(r"\s+", "", s)


class StemVariants(unittest.TestCase):
    def test_one_of_a_series_cited_exactly_passes(self):
        # 2026-10-01 실측: 15호(C 만 인용)가 A·B 때문에 실패했다
        self.assertEqual(p.stem_variants(flat(f"금융감독원은 「{C}」(2025.11.6. 발표)에서 안내했습니다."), LEDGER), [])
        self.assertEqual(p.stem_variants(flat(f"「{A}」와 「{B}」 두 자료"), LEDGER), [])

    def test_shortened_series_title_is_caught(self):
        got = p.stem_variants(flat("금융감독원 「주요 분쟁사례로 알아보는 소비자 유의사항」에서"), LEDGER)
        self.assertEqual(len(got), 1)
        self.assertIn(A, got[0])
        self.assertIn(C, got[0])

    def test_exact_once_and_shortened_once_is_still_caught(self):
        got = p.stem_variants(flat(f"「{C}」에 따르면 … 출처: 주요 분쟁사례로 알아보는 소비자 유의사항 (의료과실)"), LEDGER)
        self.assertEqual(len(got), 1)

    def test_single_title_behaviour_unchanged(self):
        self.assertEqual(p.stem_variants(flat(f"「{D}」"), LEDGER), [])
        got = p.stem_variants(flat("최근 판례로 알아보는 실손보험 유의사항"), LEDGER)   # 8865 반송 꼴(축약)
        self.assertEqual(len(got), 1)
        self.assertIn(D, got[0])

    def test_short_titles_are_skipped(self):
        self.assertEqual(p.stem_variants(flat("5세대 실손보험"), LEDGER), [])

    def test_wired_into_check(self):
        s = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "preflight.py"), encoding="utf-8").read()
        i = s.index("def check_source_titles(")
        self.assertIn("stem_variants(flat,", s[i:i + 2500])


if __name__ == "__main__":
    unittest.main(verbosity=1)
