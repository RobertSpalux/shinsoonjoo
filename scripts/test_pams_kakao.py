#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KC1 — 카카오 채널 소식 키트 · 새 원고 CTA 전달 시험. python scripts/test_pams_kakao.py
네트워크·DB 는 쓰지 않는다(본진 승인 여부는 인자로 주입).
"""
import json
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_kit as kit  # noqa: E402
import pams_kakao as kk  # noqa: E402
import publish_approved as pub  # noqa: E402

SLUGS = ("kakao-channel-intro", "kakao-csection-silson", "kakao-annuity-cancel-tax")


def draft(slug):
    return kk.load_draft(slug)


def main_url(meta):
    return kit.main_location(meta["main_slug"]) if meta.get("main_slug") else None


class DraftTest(unittest.TestCase):
    def test_three_drafts_pass_when_main_is_approved(self):
        for s in SLUGS:
            body, meta = draft(s)
            self.assertEqual(kk.check_body(body, meta, banned=[], approved_link=main_url(meta)), [], s)

    def test_main_link_blocks_until_main_approved(self):
        body, meta = draft("kakao-annuity-cancel-tax")
        p = kk.check_body(body, meta, banned=[], approved_link=None)
        self.assertTrue(any("승인·게시 전" in x for x in p), p)

    def test_intro_has_no_link_and_no_free(self):
        body, meta = draft("kakao-channel-intro")
        self.assertEqual(kk.URL_RX.findall(body), [])
        self.assertNotIn("무료", body)
        self.assertNotIn("년차", body, "연차 숫자는 손으로 쓰지 않는다")

    def test_free_is_blocked(self):
        body, meta = draft("kakao-channel-intro")
        p = kk.check_body(body + "\n무료로 점검해 드립니다.", meta, banned=[])
        self.assertTrue(any("무료" in x for x in p), p)

    def test_other_link_is_blocked(self):
        body, meta = draft("kakao-csection-silson")
        p = kk.check_body(body + "\nhttps://goodfinance.kr/diagnosis", meta, banned=[], approved_link=main_url(meta))
        self.assertTrue(any("하나만" in x for x in p), p)

    def test_notice_missing_is_blocked(self):
        body, meta = draft("kakao-channel-intro")
        p = kk.check_body(body.replace("계약체결에 따른", "계약에 따른"), meta, banned=[])
        self.assertTrue(any("필수 유의문구" in x for x in p), p)

    def test_silson_needs_actual_loss_notice(self):
        body, meta = draft("kakao-csection-silson")
        p = kk.check_body(body.replace("실손보험은 자기부담금 제외 후 보장되는 보험입니다.\n", ""), meta,
                          banned=[], approved_link=main_url(meta))
        self.assertTrue(any("ACTUAL_LOSS_NOTICE" in x for x in p), p)

    def test_lf_only(self):
        for s in SLUGS:
            raw = open(os.path.join(kk.DRAFT_ROOT, s, "body.txt"), "rb").read()
            self.assertNotIn(b"\r", raw, s)

    def test_sources_resolve_to_evidence(self):
        for s in ("kakao-csection-silson", "kakao-annuity-cancel-tax"):
            body, _ = draft(s)
            self.assertTrue(kit.evidence_for({"naver_blog_content": body, "raw_source_name": ""}, "naver"), s)

    def test_channel_url_matches_brand(self):
        ts = open(kit.os.path.join(kit.ROOT, "src", "lib", "brand.ts"), encoding="utf-8").read()
        self.assertIn(f'"{kk.KAKAO_CHANNEL_URL}"', ts)

    def test_kit_labels(self):
        self.assertEqual(kit.CH_LABEL["kakao"], "카카오")
        self.assertEqual(kit.AD_FORM["kakao"], "기타")


class CtaPassThroughTest(unittest.TestCase):
    """새 원고 CTA(카톡 채널)가 네이버 게시 안내(publish_approved)까지 이어지는가 — 승인된 옛 글은 불변."""

    def write(self, d, slug, cta_url):
        with open(os.path.join(d, f"{slug}.json"), "w", encoding="utf-8") as fp:
            json.dump({"cta_url": cta_url}, fp)

    def test_kakao_config_gives_kakao_link(self):
        with tempfile.TemporaryDirectory() as d:
            self.write(d, "new", "pf.kakao.com/_xoxdBwX")
            self.assertEqual(pub.cta_url_for("new", d), kk.KAKAO_CHANNEL_URL)

    def test_old_config_stays_diagnosis(self):
        with tempfile.TemporaryDirectory() as d:
            self.write(d, "old", "goodfinance.kr/diagnosis")
            self.assertIsNone(pub.cta_url_for("old", d))
            self.assertIsNone(pub.cta_url_for("missing", d))

    def test_real_approved_config_unchanged(self):
        self.assertIsNone(pub.cta_url_for("csection-silson-childbirth-280day"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
