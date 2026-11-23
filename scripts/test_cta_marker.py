#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CTA 마커 검사 테스트 — python scripts/test_cta_marker.py (CF1d)"""
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

M = "<!--CTA-->"


def art(body, reviews=None):
    return {"main_website_markdown": body, "ad_reviews": reviews or []}


class CtaMarkerTest(unittest.TestCase):
    def test_zero_fails(self):
        ok, d = preflight.check_cta_marker(art("본문"))
        self.assertFalse(ok)
        self.assertIn("마커 1개 필요", d)

    def test_none_body_fails(self):
        self.assertFalse(preflight.check_cta_marker(art(None))[0])

    def test_one_passes(self):
        self.assertTrue(preflight.check_cta_marker(art(f"표\n\n{M}\n\n결론"))[0])

    def test_two_fails(self):
        self.assertFalse(preflight.check_cta_marker(art(f"{M}\n\n{M}"))[0])

    def test_approved_main_exempt(self):
        for st in ("approved", "submitted"):
            a = art("본문", [{"channel": "main", "status": st}])
            self.assertTrue(preflight.check_cta_marker(a)[0], st)

    def test_rejected_main_is_checked(self):
        a = art("본문", [{"channel": "main", "status": "rejected"}])
        self.assertFalse(preflight.check_cta_marker(a)[0])

    def test_naver_approved_does_not_exempt_main(self):
        a = art("본문", [{"channel": "naver", "status": "approved"}])
        self.assertFalse(preflight.check_cta_marker(a)[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
