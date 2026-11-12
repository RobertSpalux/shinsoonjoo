#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
세제 혜택 표기 게이트 테스트 — python scripts/test_tax_benefit.py

PAMS 40호 네이버 보완(seq 695568, 2026-11-12):
  ■ 제목·1p 제목 — 세제혜택을 언급하면 「관련 세법 요건 충족 시」를 제목에 함께
  ■ 5p — 「세액공제 혜택은 관련 세법 요건 충족 시 적용되며 자세한 사항은 세무사 등 전문가 및 관련 법령을 확인하시기 바랍니다.」
40호 원본(fixtures/rv40_naver_40ho_original.json)은 막히고, 반영본은 통과하는지 고정한다.
규칙 상수는 banned-terms.ts 하나(preflight.parse_tax_benefit 이 읽는다).
"""
import hashlib
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import preflight  # noqa: E402

FX = json.load(open(os.path.join(HERE, "fixtures", "rv40_naver_40ho_original.json"), encoding="utf-8"))
ADVICE = "세금 관련 자세한 사항은 세무사 등 전문가와 상의 바랍니다."
NOTE = "세액공제 혜택은 관련 세법 요건 충족 시 적용되며 자세한 사항은 세무사 등 전문가 및 관련 법령을 확인하시기 바랍니다."
REVISED_MD5 = "d0897d5ce8585d378b62a3edf1cce3eb"   # 2026-11-12 DB 반영본 naver_blog_content md5(Postgres)


def article(**kw):
    base = {
        "title": FX["title"], "naver_title": FX["naver_title"], "blogspot_title": None,
        "main_website_markdown": None, "naver_blog_content": FX["naver_blog_content"],
        "blogspot_content": None, "is_main_published": False, "ad_reviews": [],
    }
    base.update(kw)
    return base


def revised():
    return article(naver_title=FX["naver_title"] + "(관련 세법 요건 충족 시)",
                   naver_blog_content=FX["naver_blog_content"].replace(ADVICE + "\n", ADVICE + "\n" + NOTE + "\n", 1))


class TaxBenefit(unittest.TestCase):
    def test_parser_reads_single_source(self):
        word, title, tail = preflight.parse_tax_benefit()
        self.assertTrue(word.search("보장성보험료 세액공제"))
        self.assertTrue(title.search("(관련 세법 요건 충족 시)"))
        self.assertTrue(title.search("관련 세법 요건 충족시"))
        self.assertIn(tail, NOTE)

    def test_40_original_blocked(self):
        ok, detail = preflight.check_tax_benefit(article())
        self.assertFalse(ok)
        self.assertIn("naver_title", detail)
        self.assertIn("네이버", detail)

    def test_40_revised_passes(self):
        a = revised()
        self.assertEqual(hashlib.md5(a["naver_blog_content"].encode("utf-8")).hexdigest(), REVISED_MD5)
        ok, detail = preflight.check_tax_benefit(a)
        self.assertTrue(ok, detail)

    def test_title_only_fix_still_blocked(self):
        ok, detail = preflight.check_tax_benefit(article(naver_title=FX["naver_title"] + "(관련 세법 요건 충족 시)"))
        self.assertFalse(ok)
        self.assertNotIn("naver_title", detail)

    def test_submitted_naver_frozen(self):
        ok, _ = preflight.check_tax_benefit(article(ad_reviews=[{"channel": "naver", "status": "submitted"}]))
        self.assertTrue(ok)

    def test_rejected_naver_checked(self):
        ok, _ = preflight.check_tax_benefit(article(ad_reviews=[{"channel": "naver", "status": "rejected"}]))
        self.assertFalse(ok)

    def test_main_title_only_with_main_body(self):
        # 네이버 단독 글(본진판 없음) — 본진 제목은 보지 않는다
        ok, _ = preflight.check_tax_benefit(revised())
        self.assertTrue(ok)
        # 본진판이 있으면 본진 제목도 본다
        ok, detail = preflight.check_tax_benefit(dict(revised(), main_website_markdown="본문 세액공제. " + NOTE))
        self.assertFalse(ok)
        self.assertIn("title:", detail)

    def test_published_softened(self):
        a = article(is_main_published=True, ad_reviews=[{"channel": "main", "status": "approved"}])
        ok, detail = preflight.check_tax_benefit(a)
        self.assertTrue(ok)
        self.assertTrue(detail.startswith(preflight.WARN_PREFIX))

    def test_no_tax_words_clean(self):
        ok, _ = preflight.check_tax_benefit(article(title="수익자 점검", naver_title="연금보험 수익자 점검",
                                                    naver_blog_content="수익자 칸을 봅니다."))
        self.assertTrue(ok)


if __name__ == "__main__":
    unittest.main(verbosity=2)
