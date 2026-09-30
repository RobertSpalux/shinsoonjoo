#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PAMS 키트 자동 생성 판정 테스트 — python scripts/test_pams_auto.py

DB·빌드·서버·텔레그램은 가짜로 바꿔 끼우고 「언제 만들고 언제 건너뛰는가」만 고정한다.
"""
import os
import sys
import tempfile
import unittest
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_auto as auto  # noqa: E402
import pams_kit as kit  # noqa: E402

auto.log = lambda msg: None  # 테스트 중 로그 파일을 쓰지 않는다


def art(slug="ltc-grade-home-care-rider-check", body="본문", acks=None, reviews=None, **kw):
    a = {"id": slug, "slug": slug, "title": "제목", "naver_title": "부모님 장기요양등급 나왔다면",
         "main_website_markdown": body, "naver_blog_content": "네이버 " + body, "raw_source_name": "출처",
         "compliance_acks": acks or [], "ad_reviews": reviews or [],
         "is_main_published": False, "is_naver_published": False}
    a.update(kw)
    return a


class Harness:
    def __init__(self, main=None, naver=None, gate_blocked=()):
        self.drafts = {"main": main or [], "naver": naver if naver is not None else (main or [])}
        self.gate_blocked = set(gate_blocked)
        self.built, self.notes = [], []
        self.dir = tempfile.mkdtemp()
        self.state = {"kits": {}, "gate_blocked": {}, "captures": {}}

    def fetch(self, ch):
        return self.drafts[ch]

    def build(self, env, a, ch, capture=None, server=None, out_dir=None):
        if a["slug"] in self.gate_blocked:
            raise kit.KitError("확인 미완료", gate=True)
        name = kit.kit_basename(a["slug"], ch, datetime(2026, 9, 29, tzinfo=kit.KST))
        z = os.path.join(out_dir, name + ".zip")
        for path, body in ((z, "zip"), (z[:-4] + ".txt", "txt")):
            with open(path, "w", encoding="utf-8") as fp:
                fp.write(body)
        self.built.append((a["slug"], ch, capture))
        return {"zip": z, "txt": z[:-4] + ".txt", "name": name + ".zip", "title": "게시명",
                "slug": a["slug"], "channel": ch, "article_title": "장기요양 등급 받았는데 — 부제",
                "sources": ["국민건강보험공단, 자료, 2026, 2026.3.17"], "files": [], "hash": kit.content_hash(a, ch)}

    def run(self):
        return auto.run_once({}, self.state, self.fetch, self.build, self.notes.append, kit_dir=self.dir)


class NamingTest(unittest.TestCase):
    def test_name_with_issue_number(self):
        d = datetime(2026, 9, 29, tzinfo=kit.KST)
        self.assertEqual(kit.kit_basename("ltc-grade-home-care-rider-check", "main", d), "0929_7호_본진")
        self.assertEqual(kit.kit_basename("caregiver-daily-benefit-support-vs-use", "naver", d), "0929_6호_네이버")

    def test_name_without_issue_number_falls_back_to_slug(self):
        d = datetime(2026, 10, 1, tzinfo=kit.KST)
        self.assertEqual(kit.kit_basename("new-draft", "main", d), "1001_new-draft_본진")

    def test_kit_dir_is_downloads(self):
        self.assertTrue(kit.KIT_DIR.endswith(os.path.join("Downloads", "PAMS접수")))


class MainKitTest(unittest.TestCase):
    def test_new_draft_builds_once(self):
        h = Harness(main=[art()])
        self.assertEqual(len(h.run()), 1)
        self.assertEqual(len(h.run()), 0, "원고가 같으면 다시 만들지 않는다")
        self.assertEqual(len(h.notes), 1)
        # 글 제목이 앞, 호수는 괄호(로버트 2026-09-30) — 키트 파일명은 그대로 뒤에
        self.assertTrue(h.notes[0].startswith("장기요양 등급 받았는데 (7호) 본진 키트 준비됨 — 0929_7호_본진.zip"), h.notes[0])
        self.assertIn("PAMS 게시명: 게시명 / 자료명: 국민건강보험공단", h.notes[0])

    def test_content_change_rebuilds(self):
        h = Harness(main=[art(body="v1")])
        h.run()
        h.drafts["main"] = [art(body="v2")]
        self.assertEqual(len(h.run()), 1, "원고가 바뀌면 다시 만든다")

    def test_missing_file_rebuilds(self):
        h = Harness(main=[art()])
        k = h.run()[0]
        os.remove(k["zip"])
        self.assertEqual(len(h.run()), 1, "키트 파일이 없어졌으면 다시 만든다")

    def test_gate_blocked_is_skipped_and_not_retried_until_acks_change(self):
        h = Harness(main=[art()], gate_blocked={"ltc-grade-home-care-rider-check"})
        self.assertEqual(h.run(), [])
        self.assertEqual(h.built, [])
        self.assertEqual(h.notes, [], "게이트 막힘은 알림하지 않는다(10분마다 울리지 않게)")
        need, why = auto.needs_main_kit(art(), h.state)
        self.assertFalse(need, "원고·확인 이력이 그대로면 서버를 다시 띄우지 않는다")
        need, _ = auto.needs_main_kit(art(acks=[{"field": "x", "term": "15%", "offset": 1}]), h.state)
        self.assertTrue(need, "확인 이력이 바뀌면 다시 시도한다")

    def test_ack_then_build(self):
        h = Harness(main=[art()], gate_blocked={"ltc-grade-home-care-rider-check"})
        h.run()
        h.gate_blocked.clear()
        h.drafts["main"] = [art(acks=[{"field": "x", "term": "15%", "offset": 1}])]
        self.assertEqual(len(h.run()), 1)

    def test_published_or_submitted_is_skipped(self):
        h = Harness(main=[art(is_main_published=True),
                          art(slug="caregiver-daily-benefit-support-vs-use",
                              reviews=[{"channel": "main", "status": "submitted"}])])
        self.assertEqual(h.run(), [])


class CaptureTest(unittest.TestCase):
    def cap(self, h, name):
        p = os.path.join(h.dir, name)
        with open(p, "wb") as fp:
            fp.write(b"img")
        return p

    def test_single_waiting_article_pairs_without_hint(self):
        h = Harness(main=[], naver=[art()])
        self.cap(h, "스크린샷 2026-09-29.png")
        made = h.run()
        self.assertEqual([(s, c) for s, c, _ in h.built], [("ltc-grade-home-care-rider-check", "naver")])
        self.assertTrue(os.path.exists(os.path.join(h.dir, auto.DONE_DIR_NAME, "스크린샷 2026-09-29.png")))
        self.assertTrue(h.notes[-1].startswith("장기요양 등급 받았는데 (7호) 네이버 키트 준비됨 — 0929_7호_네이버.zip"), h.notes[-1])
        self.assertEqual(len(made), 1)
        self.assertEqual(h.run(), [], "처리한 캡처는 다시 쓰지 않는다")

    def test_issue_number_in_filename_picks_that_article(self):
        h = Harness(main=[], naver=[art(), art(slug="caregiver-daily-benefit-support-vs-use", naver_title="간병")])
        self.cap(h, "7호 네이버 캡처.pdf")
        h.run()
        self.assertEqual(h.built[0][0], "ltc-grade-home-care-rider-check")

    def test_keyword_in_filename_matches_single_owner(self):
        """「백내장.pdf」처럼 핵심어만 있어도, 그 말이 대기 글 한 편의 제목에만 있으면 짝이 맞는다(2026-09-30 실측 보완)."""
        c = [art(), art(slug="cataract-x", title="백내장 수술 실비, 입원으로 받을까", naver_title="백내장 실비 청구했는데 통원으로만 나왔다면"),
             art(slug="manual-x", title="도수치료 실비, 앞으로도 계속 나올까", naver_title="도수치료 실비 청구되나요")]
        for fn, want in (("백내장.pdf", "cataract-x"), ("백내장 실비.pdf", "cataract-x"), ("도수치료.pdf", "manual-x"),
                         ("네이버 비공개 백내장 0930.pdf", "cataract-x")):
            a, why = auto.match_capture(fn, c)
            self.assertIsNotNone(a, fn)
            self.assertEqual(a["slug"], want, fn)
            self.assertEqual(why, "파일명 핵심어 일치")

    def test_shared_or_generic_word_does_not_match(self):
        c = [art(slug="cataract-x", title="백내장 수술 실비", naver_title="백내장 실비 청구했는데"),
             art(slug="manual-x", title="도수치료 실비", naver_title="도수치료 실비 청구되나요")]
        for fn in ("실비.pdf", "0930.pdf", "스크린샷 2026-09-30.png", "청구.pdf"):
            a, why = auto.match_capture(fn, c)
            self.assertIsNone(a, fn)      # 두 글에 다 있거나 날짜·일반어 → 묻는다
        a, why = auto.match_capture("백내장 도수치료.pdf", c)
        self.assertIsNone(a)
        self.assertIn("여러 글", why)

    def test_17ho_does_not_match_7ho(self):
        a, why = auto.match_capture("17호.png", [art(), art(slug="caregiver-daily-benefit-support-vs-use")])
        self.assertIsNone(a)

    def test_ambiguous_asks_once_and_builds_nothing(self):
        h = Harness(main=[], naver=[art(), art(slug="caregiver-daily-benefit-support-vs-use", naver_title="간병")])
        self.cap(h, "캡처.png")
        self.assertEqual(h.run(), [])
        self.assertEqual(h.built, [])
        self.assertEqual(len(h.notes), 1)
        self.assertIn("짝을 못 정했습니다", h.notes[0])
        h.run()
        self.assertEqual(len(h.notes), 1, "같은 이유로 두 번 묻지 않는다")

    def test_no_waiting_article_asks(self):
        h = Harness(main=[], naver=[])
        self.cap(h, "캡처.png")
        h.run()
        self.assertIn("네이버 대기 글이 없음", h.notes[0])

    def test_locked_naver_is_not_a_candidate(self):
        locked = art(reviews=[{"channel": "naver", "status": "submitted"}])
        h = Harness(main=[], naver=[locked])
        self.cap(h, "7호.png")
        h.run()
        self.assertEqual(h.built, [])

    def test_gate_blocked_capture_waits(self):
        h = Harness(main=[], naver=[art()], gate_blocked={"ltc-grade-home-care-rider-check"})
        p = self.cap(h, "7호.png")
        h.run()
        self.assertTrue(os.path.exists(p), "게이트에 막히면 캡처를 그대로 둔다")
        self.assertEqual(h.run(), [])
        self.assertEqual(len(h.built), 0)


class ThreadsKitPickTest(unittest.TestCase):
    def test_pick(self):
        metas = [("a.zip", {"slug": "s", "row_id": None, "created": "2026-09-29T10"}),
                 ("b.zip", {"slug": "s", "row_id": "r1", "created": "2026-09-29T11"}),
                 ("c.zip", {"slug": "other", "row_id": None, "created": "2026-09-29T12"})]
        self.assertEqual(auto.pick_threads_kit(metas, "s", "r1"), "b.zip", "같은 행 id 키트, 최근 것")
        self.assertEqual(auto.pick_threads_kit(metas, "s", "r2"), "a.zip", "다른 행 id 키트는 못 쓴다(utm 불일치)")
        self.assertIsNone(auto.pick_threads_kit(metas, "none", "r1"))


class Telegram(unittest.TestCase):
    """2026-10-01 — 보낸 기록이 없어 「제대로 들어오는지」 답할 수 없었다 · 예외 문구에 토큰 URL 이 샐 수 있었다."""

    def setUp(self):
        self.logs = []
        self._log, self._post = auto.log, auto.requests.post
        auto.log = lambda m: self.logs.append(m)

    def tearDown(self):
        auto.log, auto.requests.post = self._log, self._post

    def test_success_and_failure_are_logged_with_first_line(self):
        class R:
            def __init__(self, ok, code=200):
                self.ok, self.status_code, self._ok = ok, code, ok
            def json(self):
                return {"ok": self._ok}
        env = {"TELEGRAM_BOT_TOKEN": "TOKEN123", "TELEGRAM_CHAT_ID": "1"}
        auto.requests.post = lambda *a, **k: R(True)
        self.assertTrue(auto.telegram(env, "첫 줄 제목\n둘째 줄"))
        auto.requests.post = lambda *a, **k: R(False, 400)
        self.assertFalse(auto.telegram(env, "두 번째 알림"))
        self.assertEqual(self.logs, ["텔레그램 보냄 · 첫 줄 제목", "텔레그램 실패(HTTP 400) · 두 번째 알림"])

    def test_exception_does_not_leak_token(self):
        def boom(*a, **k):
            raise auto.requests.ConnectionError("HTTPSConnectionPool: /botTOKEN123/sendMessage")
        auto.requests.post = boom
        self.assertFalse(auto.telegram({"TELEGRAM_BOT_TOKEN": "TOKEN123", "TELEGRAM_CHAT_ID": "1"}, "알림"))
        self.assertTrue(self.logs and "TOKEN123" not in " ".join(self.logs), self.logs)
        self.assertIn("ConnectionError", self.logs[0])

    def test_alert_once_per_day(self):
        sent, st = [], {}
        self.assertTrue(auto.alert_once({}, st, "queue:X", "깨짐", notify=sent.append))
        self.assertFalse(auto.alert_once({}, st, "queue:X", "깨짐", notify=sent.append))
        self.assertEqual(sent, ["깨짐"])

    def test_rebuild_is_labelled(self):
        s = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pams_auto.py"), encoding="utf-8").read()
        self.assertIn('"🔁 원고 변경 — 키트 다시 만듦 · " if why == "원고 변경"', s)


if __name__ == "__main__":
    unittest.main(verbosity=2)
