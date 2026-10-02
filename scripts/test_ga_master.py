#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
「GA명장」 단독 표기 차단 테스트 — python scripts/test_ga_master.py

PAMS 7168 조건(2026-09-28): 「[GA명장] → [22년~25년 GA 명장] 등 기간 명시」.
새 원고에 단독 표기가 나오면 preflight 가 막고, 승인 게시분은 경고로만 띄우는지 고정한다.
"""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import ga_master  # noqa: E402
import preflight  # noqa: E402

LABEL = ga_master.load_label()


def article(**kw):
    base = {
        "title": "제목", "naver_title": "네이버 제목", "blogspot_title": None,
        "main_website_markdown": "본문", "naver_blog_content": "네이버 본문",
        "blogspot_content": None, "instagram_caption": None,
        "is_main_published": False, "ad_reviews": [],
    }
    base.update(kw)
    return base


def check(a, slug="__no_such_slug__"):
    return preflight.check_ga_master(slug, a, renderers=[])


class LabelTest(unittest.TestCase):
    def test_label_is_period_form(self):
        self.assertEqual(LABEL, "22년·25년 GA 명장")   # 확정 2026-10-02(22년과 25년 — 연속 기간 아님)


class FindBareTest(unittest.TestCase):
    def test_bare_forms_are_caught(self):
        for s in ["23년 차 GA명장 · 보험 리모델링", "GA 명장", "GA  명장 신순주",
                  "22년~25년 GA명장", "22~25년 GA 명장", "22년~25년 GA 명장", "22년·25년 GA명장"]:
            self.assertTrue(ga_master.find_bare(s, LABEL), s)

    def test_label_passes(self):
        for s in [LABEL, f"23년 차 {LABEL} · 보험 리모델링", f"{LABEL}, {LABEL}", "", None,
                  "우수인증설계사 8년 연속"]:
            self.assertEqual(ga_master.find_bare(s, LABEL), [], s)

    def test_mixed_reports_only_bare(self):
        hits = ga_master.find_bare(f"{LABEL} 그리고 GA명장", LABEL)
        self.assertEqual(len(hits), 1)


class PreflightTest(unittest.TestCase):
    def test_new_body_with_bare_fails(self):
        ok, detail = check(article(main_website_markdown="저자는 GA명장입니다."))
        self.assertFalse(ok, detail)

    def test_new_title_and_caption_with_bare_fail(self):
        self.assertFalse(check(article(naver_title="GA명장이 알려드림"))[0])
        self.assertFalse(check(article(instagram_caption="#GA명장"))[0])

    def test_label_passes(self):
        ok, detail = check(article(main_website_markdown=f"저자는 {LABEL}입니다."))
        self.assertTrue(ok, detail)

    def test_frozen_channel_is_not_scanned(self):
        a = article(naver_blog_content="GA명장", ad_reviews=[{"channel": "naver", "status": "approved"}])
        self.assertTrue(check(a)[0])

    def test_published_approved_is_softened(self):
        a = article(main_website_markdown="GA명장", is_main_published=True,
                    naver_blog_content="GA명장",
                    ad_reviews=[{"channel": "blogspot", "status": "approved"}])
        ok, detail = check(a)
        self.assertTrue(ok)
        self.assertTrue(detail.startswith(preflight.SOFT_MARK), detail)

    def test_renderer_source_is_scanned(self):
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write('d.text((0, 0), "23년 차 GA명장 · 보험 리모델링")\n')
        try:
            ok, _ = preflight.check_ga_master("__x__", article(), renderers=[f.name])
            self.assertFalse(ok)
        finally:
            os.unlink(f.name)

    def test_repo_renderers_are_clean(self):
        ok, detail = preflight.check_ga_master("__x__", article())
        self.assertTrue(ok, detail)


if __name__ == "__main__":
    unittest.main(verbosity=2)
