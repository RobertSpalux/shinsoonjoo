#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""심의본 = 게시본 대조 게이트 — python scripts/test_review_lock.py (네트워크 없음)"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import pams_kit as kit  # noqa: E402
import review_lock as L  # noqa: E402

ART = {"id": "a1", "slug": "cataract-surgery-silson-inpatient-or-outpatient", "title": "백내장 수술 실비 — 부제", "category": "c",
       "summary": "s", "key_points": ["k"], "remodeling_bridge": None, "raw_source_name": "출처",
       "main_website_markdown": "본문 원안", "naver_title": "네이버 제목", "naver_blog_content": "네이버 원안"}
H = kit.content_hash(ART, "main")


class Pure(unittest.TestCase):
    def test_same_is_ok(self):
        notes = "접수 메모\n" + L.note_line(H, "0930_10호_본진.zip", "09-30 18:06")
        self.assertEqual(L.verdict(H, notes), ("ok", H))

    def test_one_character_change_is_mismatch(self):
        changed = dict(ART, main_website_markdown="본문 원안.")   # 마침표 하나
        cur = kit.content_hash(changed, "main")
        st, noted = L.verdict(cur, L.note_line(H, "k.zip", "09-30 18:06"))
        self.assertEqual(st, "mismatch")
        self.assertEqual(noted, H)
        self.assertTrue(L.blocks(st, "main"))
        self.assertTrue(L.blocks(st, "naver"))

    def test_title_change_is_mismatch(self):
        cur = kit.content_hash(dict(ART, title="백내장 수술 실비 — 다른 부제"), "main")
        self.assertEqual(L.verdict(cur, L.note_line(H, "k.zip", "t"))[0], "mismatch")

    def test_naver_hash_ignores_main_body(self):
        hn = kit.content_hash(ART, "naver")
        cur = kit.content_hash(dict(ART, main_website_markdown="본진만 바뀜"), "naver")
        self.assertEqual(L.verdict(cur, L.note_line(hn, "k.zip", "t"))[0], "ok")

    def test_missing_blocks_main_only(self):
        self.assertEqual(L.verdict(H, "해시 없는 메모"), ("missing", None))
        self.assertTrue(L.blocks("missing", "main"))
        self.assertFalse(L.blocks("missing", "naver"))
        self.assertFalse(L.blocks("ok", "main"))

    def test_latest_note_wins(self):
        h2 = "b" * 64
        notes = L.note_line(H, "옛.zip", "09-29 10:00") + "\n" + L.note_line(h2, "새.zip", "09-30 10:00")
        self.assertEqual(L.noted_hash(notes), h2)      # 재접수하면 마지막 해시가 기준

    def test_threads_note_is_not_mistaken(self):
        self.assertIsNone(L.noted_hash("09-30 접수 원고 · 본문 https://x (sha256 " + "a" * 64 + ")"))

    def test_messages(self):
        m = L.message("백내장 수술 실비 (10호)", "main", "mismatch", H, "c" * 64)
        self.assertTrue(m.startswith("⛔ [게시 막음] 백내장 수술 실비 (10호) 본진 — 심의본과 현재 원고가 다릅니다"))
        self.assertIn("자동 게시하지 않습니다", m)
        self.assertIn("기록이 없어", L.message("t", "main", "missing", None, H))


class KitTxt(unittest.TestCase):
    def test_kit_txt_carries_hash_and_parser_reads_it(self):
        lines = kit.kit_lines(ART["slug"], "main", "게시명", "title 정리", ["출처"], ["a.pdf"], H)
        self.assertEqual(lines[-1], L.txt_line(H))
        self.assertEqual(L.txt_hash("\n".join(lines)), H)

    def test_kit_hash_prefers_txt_then_state(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(L.kit_hash(ART["slug"], "main", d, {"kits": {ART["slug"] + "|main": {"hash": "e" * 64, "zip": "x\\0930_10호_본진.zip"}}}),
                             ("e" * 64, "0930_10호_본진.zip"))                       # 옛 키트(줄 없음) → 상태 기록
            open(os.path.join(d, "0930_10호_본진.txt"), "w", encoding="utf-8").write("게시명: x\n" + L.txt_line(H) + "\n")
            self.assertEqual(L.kit_hash(ART["slug"], "main", d, {}), (H, "0930_10호_본진.zip"))
            self.assertEqual(L.kit_hash(ART["slug"], "naver", d, {}), (None, None))


class Stamp(unittest.TestCase):
    def test_stamp_appends_once(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "0930_10호_본진.txt"), "w", encoding="utf-8").write(L.txt_line(H) + "\n")
            rows = [{"id": "r1", "channel": "main", "status": "submitted", "notes": "메모",
                     "premium_articles": {"slug": ART["slug"], "title": "t"}},
                    {"id": "r2", "channel": "main", "status": "approved", "notes": L.note_line(H, "k.zip", "t"),
                     "premium_articles": {"slug": ART["slug"], "title": "t"}}]
            got = {}
            orig = kit._rest
            kit._rest = lambda env: ("http://x/rest/v1/premium_articles", {})
            try:
                done = L.stamp({}, {}, log=lambda *_: None, kit_dir=d, rows=rows, only_unpublished=False,
                               patch=lambda rid, notes: got.update({rid: notes}))
            finally:
                kit._rest = orig
            self.assertEqual(done, [(ART["slug"], "main")])
            self.assertEqual(list(got), ["r1"])                      # 이미 적힌 행은 다시 안 적는다
            self.assertTrue(got["r1"].startswith("메모\n"))           # 기존 메모 보존
            self.assertEqual(L.noted_hash(got["r1"]), H)


class Hooks(unittest.TestCase):
    def test_gate_runs_before_publish(self):
        here = os.path.dirname(os.path.abspath(__file__))
        s = open(os.path.join(here, "publish_approved.py"), encoding="utf-8").read()
        i = s.index("review_lock.check(env, a[\"slug\"]")
        self.assertLess(i, s.index("res = publish_main(server, env, t, live)"))
        self.assertIn("review_lock.blocks(lk, t[\"channel\"])", s[i:i + 600])
        self.assertIn("continue", s[i:i + 1100])
        a = open(os.path.join(here, "pams_auto.py"), encoding="utf-8").read()
        self.assertLess(a.index("review_lock.stamp(env, state"), a.index("publish_approved.run("))


if __name__ == "__main__":
    unittest.main(verbosity=1)
