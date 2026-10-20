#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""매일 원고 공급기 — python scripts/test_draft_daily.py (네트워크·DB·claude·텔레그램 호출 없음)

반려·생성 실패·[확인] 남은 원고는 투입하지 않고 **다음 주제로 1회만** 다시 한다. 통과분만 DB 투입 → 사진 → 네이버 파일 → 1줄.
저장소 추적 파일(configs/naver_keywords.json)을 고치지 않고 초안 폴더 쪽 장부에 적는다.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import draft_daily as dd  # noqa: E402
import draft_weekly as dw  # noqa: E402

OK = {"pass": True, "stages": [], "placeholders": [], "unrun": []}
NG = {"pass": False, "stages": [{"name": "네이버 규칙 10", "pass": False}], "placeholders": [], "unrun": []}
HOLD = {"pass": True, "stages": [], "placeholders": ["[확인: 개정일]"], "unrun": []}


class PureTest(unittest.TestCase):
    def test_ready(self):
        self.assertTrue(dd.ready(OK))
        self.assertFalse(dd.ready(NG))
        self.assertFalse(dd.ready(HOLD))
        self.assertFalse(dd.ready({**OK, "unrun": ["금지어·문체·근거(check_draft.mts)"]}))
        self.assertFalse(dd.ready(None))

    def test_message(self):
        m = dd.message(True, "제목입니다", "1021_x_네이버비공개", 5)
        self.assertTrue(m.startswith("오늘 원고: 제목입니다 · 네이버 파일: Downloads\\PAMS접수\\_네이버비공개\\1021_x_네이버비공개.txt"))
        self.assertIn("근거 원문 대조 전", m)
        self.assertIn("(사진 없음)", dd.message(True, "제목", "b", 0))
        self.assertTrue(dd.message(False, reasons=["a 반려", "b 반려"]).startswith("오늘 원고 없음 — a 반려 / b 반려"))

    def test_self_flagged(self):
        meta = {"verify_claims": [{"basis": "금융감독원, 자료, 2026, 2026.5.19 — 4쪽"},
                                  {"basis": "금융감독원, 자료, 2026, 2026.5.19 (원문 문장 대조 필요)"}]}
        self.assertEqual(len(dd.self_flagged(meta)), 1)
        self.assertEqual(dd.self_flagged({"verify_claims": []}), [])

    def test_pending_keyword_ledger(self):
        d = tempfile.mkdtemp()
        try:
            p = os.path.join(d, dd.PENDING_KW)
            dd.add_pending_keyword(p, "a-slug", "키워드 하나")
            dd.add_pending_keyword(p, "b-slug", "키워드 둘")
            self.assertEqual(json.load(open(p, encoding="utf-8")), {"a-slug": "키워드 하나", "b-slug": "키워드 둘"})
        finally:
            shutil.rmtree(d)

    def test_render_without_config_is_zero(self):
        d = tempfile.mkdtemp()
        try:
            self.assertEqual(dd.render_images(d, "x")[0], 0)
            json.dump({"slug": "x"}, open(os.path.join(d, "naver_images.json"), "w", encoding="utf-8"))
            n, why = dd.render_images(d, "x")
            self.assertEqual(n, 0)
            self.assertIn("빠진 칸", why)
        finally:
            shutil.rmtree(d)


class RunTest(unittest.TestCase):
    """run() 순서 — 생성·판정·투입·사진·네이버·발송을 가짜로 바꿔 끼운다."""

    def setUp(self):
        self.out = tempfile.mkdtemp()
        self.calls = []
        self.saved = {n: getattr(dd, n) for n in ("insert", "render_images", "naver_file", "send")}
        self.saved_dw = {n: getattr(dw, n) for n in ("generate_one", "load_topics", "RULES_MD")}
        self.saved_env = dd.kit.load_env
        dd.kit.load_env = lambda: {}
        rules = os.path.join(self.out, "rules.md")
        open(rules, "w", encoding="utf-8").write("규칙")
        dw.RULES_MD = rules
        dw.load_topics = lambda path=None: {"topics": [
            {"slug": "a-topic", "category": "실손", "keyword": "가", "angle": "", "notices": []},
            {"slug": "b-topic", "category": "실손", "keyword": "나", "angle": "", "notices": []},
            {"slug": "c-topic", "category": "실손", "keyword": "다", "angle": "", "notices": []}], "notices": {}}
        dd.insert = lambda env, d: (self.calls.append(("insert", d)) or ({"id": "1", "slug": os.path.basename(d)[9:], "naver_title": "제목"}, "가"))
        dd.render_images = lambda d, slug: (self.calls.append(("render", slug)) or (5, ""))
        dd.naver_file = lambda env, slug, d: (self.calls.append(("naver", slug)) or {"txt": f"C:/x/1021_{slug}_네이버비공개.txt"})
        dd.send = lambda env, text: (self.calls.append(("send", text)) or True)

    def tearDown(self):
        for n, v in self.saved.items():
            setattr(dd, n, v)
        for n, v in self.saved_dw.items():
            setattr(dw, n, v)
        dd.kit.load_env = self.saved_env
        shutil.rmtree(self.out)

    def gen(self, results):
        def fake(t, cfg, out_dir, env, rules_text, **kw):
            r = results.pop(0)
            self.calls.append(("gen", t["slug"]))
            if r is None:
                return None, None, "시간 초과"
            d = os.path.join(out_dir, ("" if r["pass"] else "_rejected/") + f"20261021_{t['slug']}")
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as fp:
                json.dump({"verify_claims": r.get("_claims", [])}, fp)
            return d, {}, r
        dw.generate_one = fake

    def test_first_topic_passes(self):
        self.gen([OK])
        self.assertEqual(dd.run(self.out), 0)
        kinds = [c[0] for c in self.calls]
        self.assertEqual(kinds, ["gen", "insert", "render", "naver", "send"])
        self.assertIn("오늘 원고: 제목 · 네이버 파일:", self.calls[-1][1])
        self.assertEqual(json.load(open(os.path.join(self.out, dd.PENDING_KW), encoding="utf-8")), {"a-topic": "가"})

    def test_reject_then_retry_next_topic_once(self):
        self.gen([NG, OK])
        self.assertEqual(dd.run(self.out), 0)
        self.assertEqual([c[1] for c in self.calls if c[0] == "gen"], ["a-topic", "b-topic"])

    def test_two_failures_stop_and_say_so(self):
        self.gen([None, HOLD])
        self.assertEqual(dd.run(self.out), 1)
        self.assertEqual([c[1] for c in self.calls if c[0] == "gen"], ["a-topic", "b-topic"])   # 1회만 다시
        self.assertNotIn("insert", [c[0] for c in self.calls])
        last = self.calls[-1]
        self.assertEqual(last[0], "send")
        self.assertIn("오늘 원고 없음", last[1])
        self.assertIn("확인 필요 1건", last[1])

    def test_self_flagged_basis_holds_and_retries(self):
        flagged = {**OK, "_claims": [{"basis": "금융감독원, 자료, 2026, 2026.5.19 (원문 문장 대조 필요)"}]}
        self.gen([flagged, OK])
        self.assertEqual(dd.run(self.out), 0)
        self.assertEqual([c[1] for c in self.calls if c[0] == "gen"], ["a-topic", "b-topic"])
        self.assertEqual(len([c for c in self.calls if c[0] == "insert"]), 1)

    def test_no_send(self):
        self.gen([OK])
        dd.run(self.out, do_send=False)
        self.assertNotIn("send", [c[0] for c in self.calls])


if __name__ == "__main__":
    unittest.main()
