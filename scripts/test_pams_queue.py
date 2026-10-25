#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PAMS 접수 순서 · 「다음 접수」 알림 — python scripts/test_pams_queue.py (네트워크 없음)"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import pams_queue as q  # noqa: E402

A, B, C = "old-silson-keep-or-switch-selective-discount", "manual-therapy-silson-by-rider-managed-benefit", "ltc-grade-home-care-rider-check"
ORDER = [{"slug": A, "channel": "main"}, {"slug": B, "channel": "main"}, {"slug": C, "channel": "main"},
         {"slug": C, "channel": "threads"}, {"slug": C, "channel": "naver"}]
KITS = {(A, "main"): r"x\0930_9호_본진.zip", (B, "main"): r"x\0930_8호_본진.zip", (C, "main"): r"x\0930_7호_본진.zip",
        (C, "threads"): r"x\0930_7호_스레드.zip", (C, "naver"): None}
OTHER_THREADS = {"slug": "caregiver-daily-benefit-support-vs-use", "channel": "threads", "status": "submitted"}


class Plan(unittest.TestCase):
    def test_first_ready_in_order(self):
        p = q.plan(ORDER, [OTHER_THREADS], KITS)
        self.assertEqual((p["next"]["slug"], p["next"]["channel"]), (A, "main"))
        self.assertEqual((p["active"], p["free"]), (1, 2))

    def test_done_items_skipped(self):
        p = q.plan(ORDER, [{"slug": A, "channel": "main", "status": "submitted"},
                           {"slug": B, "channel": "main", "status": "approved"}], KITS)
        self.assertEqual((p["next"]["slug"], p["next"]["channel"]), (C, "main"))
        self.assertEqual(p["active"], 1)      # approved 는 칸을 차지하지 않는다
        self.assertEqual(len(p["done"]), 2)

    def test_rejected_not_done(self):
        p = q.plan(ORDER, [{"slug": A, "channel": "main", "status": "rejected"}], KITS)
        self.assertEqual(p["next"]["slug"], A)   # 반송은 다시 접수할 대상
        self.assertEqual(p["free"], 3)

    def test_no_kit_goes_to_waiting(self):
        p = q.plan(ORDER, [{"slug": C, "channel": "main", "status": "approved"}], KITS)
        self.assertIn({"slug": C, "channel": "naver"}, p["waiting"])

    def test_naver_held_until_main_approved(self):
        """본진 먼저 — 네이버는 같은 글 본진이 승인된 뒤에만 다음 접수(2026-10-01 로버트 원칙)."""
        kits = {**KITS, (C, "naver"): "1001_7호_네이버.zip"}
        only_naver = [{"slug": C, "channel": "naver"}]
        for st in ([], [{"slug": C, "channel": "main", "status": "submitted"}]):
            p = q.plan(only_naver, st, kits)
            self.assertIsNone(p["next"], st)
            self.assertEqual(p["held"], only_naver)
        p = q.plan(only_naver, [{"slug": C, "channel": "main", "status": "approved"}], kits)
        self.assertEqual(p["next"], only_naver[0])
        self.assertEqual(p["held"], [])

    def test_before_main_ok_exception(self):
        kits = {(C, "naver"): "1001_7호_네이버.zip"}
        it = {"slug": C, "channel": "naver", "before_main_ok": True}
        p = q.plan([it], [{"slug": C, "channel": "main", "status": "submitted"}], kits)
        self.assertEqual(p["next"], it)

    def test_naver_only_not_held(self):
        """네이버 단독 글(본진판 없음, SH16)은 before_main_ok 를 안 적어도 본진을 기다리지 않는다(SH17)."""
        S = "silson-claim-deadline-3year-start-point"
        it = {"slug": S, "channel": "naver"}
        kits = {(S, "naver"): "1012_18호_네이버.zip"}
        p = q.plan([it], [], kits)
        self.assertIsNone(p["next"])                      # 모르면(naver_only 안 넘김) 종전대로 대기
        self.assertEqual(p["held"], [it])
        p = q.plan([it], [], kits, naver_only={S})
        self.assertEqual(p["next"], it)
        self.assertEqual(p["held"], [])
        # 다른 글의 네이버는 여전히 본진 승인 대기
        p = q.plan([{"slug": C, "channel": "naver"}], [], {(C, "naver"): "x.zip"}, naver_only={S})
        self.assertIsNone(p["next"])

    def test_fetch_naver_only_uses_kit_rule(self):
        """판정은 pams_kit.naver_only(본진판 NULL/공백) 하나 — 같은 규칙을 두 벌 두지 않는다."""
        rows = [{"slug": "a", "main_website_markdown": None}, {"slug": "b", "main_website_markdown": "  "},
                {"slug": "c", "main_website_markdown": "본진"}]
        seen = {}

        class R:
            def json(self):
                return rows
        orig = (q.requests.get, q.kit._rest)
        q.kit._rest = lambda env: ("u", {})
        q.requests.get = lambda url, params=None, **kw: (seen.update(params), R())[1]
        try:
            self.assertEqual(q.fetch_naver_only({}, ["c", "a", "b", "a"]), {"a", "b"})
            self.assertEqual(seen["slug"], "in.(a,b,c)")
            self.assertEqual(q.fetch_naver_only({}, []), set())
        finally:
            q.requests.get, q.kit._rest = orig

    def test_full_queue(self):
        full = [{"slug": s, "channel": "x", "status": "submitted"} for s in ("a", "b", "c")]
        p = q.plan(ORDER, full, KITS)
        self.assertEqual(p["free"], 0)
        self.assertIsNone(q.message(p))
        self.assertEqual(q.should_notify(p, {})[0], False)


class Message(unittest.TestCase):
    def test_one_line(self):
        m = q.message(q.plan(ORDER, [OTHER_THREADS], KITS))
        self.assertNotIn("\n", m)
        self.assertTrue(m.startswith("다음 접수: 9호 본진 — 0930_9호_본진.zip (빈 칸 2/3)"), m)
        self.assertNotIn("7호 네이버", m)      # 본진 승인 전 네이버는 키트 대기 목록에도 올리지 않는다

    def test_title_first_when_titles_given(self):
        titles = {A: "1세대 실비 유지해야 하나 — 기준은 보험료가 아니라 앞으로의 치료 계획입니다", C: "장기요양 등급 받았는데, 내 보험 재가급여 특약은 언제 나오나요"}
        m = q.message(q.plan(ORDER, [OTHER_THREADS], KITS), titles)
        self.assertTrue(m.startswith("다음 접수: 1세대 실비 유지해야 하나 (9호) 본진 — 0930_9호_본진.zip (빈 칸 2/3)"), m)
        self.assertNotIn("(7호) 네이버", m)
        self.assertNotIn("\n", m)

    def test_notify_once_per_state(self):
        p = q.plan(ORDER, [OTHER_THREADS], KITS)
        go, sig = q.should_notify(p, {})
        self.assertTrue(go)
        self.assertEqual(q.should_notify(p, {"queue_notified": sig})[0], False)   # 같은 상태 = 다시 안 보냄
        p2 = q.plan(ORDER, [OTHER_THREADS, {"slug": A, "channel": "main", "status": "submitted"}], KITS)
        self.assertTrue(q.should_notify(p2, {"queue_notified": sig})[0])          # 다음 항목이 바뀌면 보냄

    def test_order_line(self):
        p = q.plan(ORDER, [{"slug": A, "channel": "main", "status": "approved"}], KITS)
        line = q.order_line(ORDER, p)
        self.assertTrue(line.startswith("9호 본진 ✓ → 8호 본진 → 7호 본진 → 7호 스레드 → 7호 네이버 (본진 승인 대기)"), line)


class HeldKits(unittest.TestCase):
    """SK2 — 칸이 다 찬 동안 보류한 키트 알림은, 칸이 비는 순간 「다음 접수」 한 통에 실린다."""
    HELD = {f"{C}|main": {"label": "장기요양 (7호) 본진", "zip": r"D:\PAMS접수\1020_7호_본진.zip"},
            "corp|main": {"label": "법인 계약 (corp) 본진", "why": "본문에서 configs/sources.json 의 자료명을 찾지 못했습니다"}}
    FULL = [{"slug": s, "channel": "main", "status": "submitted"} for s in ("a", "b", "c")]

    def test_full_sends_nothing(self):
        p = q.plan(ORDER, self.FULL, KITS)
        self.assertEqual(q.should_notify(p, {"held_kits": self.HELD})[0], False, "칸이 다 찼으면 보류한 키트도 보내지 않는다")

    def test_free_slot_sends_one_message_with_locations(self):
        p = q.plan(ORDER, [OTHER_THREADS], KITS)
        st = {"held_kits": dict(self.HELD)}
        _, sig = q.should_notify(p, {})
        st["queue_notified"] = sig
        self.assertTrue(q.should_notify(p, st)[0], "같은 다음 항목이라도 보류한 키트가 있으면 보낸다")
        m = q.held_message(p, st, file_exists=lambda z: True)
        lines = m.split("\n")
        self.assertTrue(lines[0].startswith("다음 접수: 9호 본진"), lines[0])
        self.assertIn(r"준비된 키트: 장기요양 (7호) 본진 — D:\PAMS접수\1020_7호_본진.zip", lines)
        self.assertIn("키트 없음 — 법인 계약 (corp) 본진: 본문에서 configs/sources.json 의 자료명을 찾지 못했습니다", lines)
        self.assertEqual(len(lines), 3)

    def test_missing_file_reported(self):
        lines = q.held_lines({"k": {"label": "L", "zip": "gone.zip"}}, file_exists=lambda z: False)
        self.assertEqual(lines, ["키트 없음 — L: 만들었던 키트 파일이 없어졌습니다"])

    def test_free_slot_without_next_still_sends_held(self):
        p = q.plan([], [], {})
        self.assertTrue(q.should_notify(p, {"held_kits": self.HELD})[0])
        self.assertFalse(q.should_notify(p, {})[0])
        self.assertTrue(q.held_message(p, {"held_kits": self.HELD}).startswith("다음 접수: 운영표에 준비된 항목 없음 (빈 칸 3/3)"))

    def test_notify_next_clears_held_after_send(self):
        orig = q.current, q.fetch_titles
        q.current = lambda env: (ORDER, q.plan(ORDER, [OTHER_THREADS], KITS))
        q.fetch_titles = lambda env: {}
        sent = []
        try:
            st = {"held_kits": dict(self.HELD)}
            q.notify_next({}, st, notify=lambda t: sent.append(t) or True, log=lambda *_: None)
            self.assertEqual(len(sent), 1)
            self.assertIn("키트 없음 — 법인 계약", sent[0])
            self.assertEqual(st["held_kits"], {})
            self.assertIsNone(q.notify_next({}, st, notify=lambda t: sent.append(t) or True, log=lambda *_: None),
                              "보낸 뒤 같은 상태면 다시 안 보낸다")
            st2 = {"held_kits": dict(self.HELD)}
            q.notify_next({}, st2, notify=lambda t: False, log=lambda *_: None)
            self.assertEqual(st2["held_kits"], self.HELD, "보내기 실패면 보류 목록을 남겨 다음 바퀴에 다시")
        finally:
            q.current, q.fetch_titles = orig

    def test_held_line_without_held_is_unchanged(self):
        p = q.plan(ORDER, [OTHER_THREADS], KITS)
        self.assertEqual(q.held_message(p, {}), q.message(p))

    def test_slots_full_counts_active_only(self):
        orig = q.load_queue, q.fetch_reviews
        q.load_queue = lambda path=None: (3, ORDER)
        try:
            q.fetch_reviews = lambda env: self.FULL
            self.assertTrue(q.slots_full({}))
            q.fetch_reviews = lambda env: self.FULL[:2] + [{"slug": "c", "channel": "main", "status": "approved"}]
            self.assertFalse(q.slots_full({}))
        finally:
            q.load_queue, q.fetch_reviews = orig


class Config(unittest.TestCase):
    def test_config_main_first(self):
        limit, order = q.load_queue()
        self.assertEqual(limit, 3)
        chans = [o["channel"] for o in order]
        # 본진 먼저 — 본진이 다른 채널 뒤에 오면 안 된다(예외: before_main_ok 로 적은 항목만 본진 사이에 낄 수 있다)
        rest = [o for o in order if not o.get("before_main_ok")]
        chans = [o["channel"] for o in rest]
        first_non_main = next((i for i, c in enumerate(chans) if c != "main"), len(chans))
        self.assertTrue(all(c != "main" for c in chans[first_non_main:]), "본진 먼저 — 본진이 다른 채널 뒤에 오면 안 된다")

    def test_config_main_order_and_exception(self):
        """2026-10-01 23:00 관제탑 — 본진 7→8→9→10→11→13→12→14→15→16 · 예외는 7호 네이버 하나."""
        import pams_kit as kit
        _, order = q.load_queue()
        mains = [kit.issue_label(o["slug"]) for o in order if o["channel"] == "main"]
        self.assertEqual(mains, ["7호", "8호", "9호", "10호", "11호", "13호", "12호", "14호", "15호", "16호"])
        ex = [(kit.issue_label(o["slug"]), o["channel"]) for o in order if o.get("before_main_ok")]
        self.assertEqual(ex, [("7호", "naver")])
        self.assertEqual(len({(o["slug"], o["channel"]) for o in order}), len(order), "중복 항목 없음")
        for o in order:
            self.assertIn(o["channel"], ("main", "naver", "threads"))


class AutoHook(unittest.TestCase):
    def test_pams_auto_calls_queue_and_isolates_failure(self):
        src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pams_auto.py"), encoding="utf-8").read()
        self.assertIn("pams_queue.notify_next(env, state", src)
        i = src.index("pams_queue.notify_next")
        self.assertIn("except Exception", src[i:i + 300])
        self.assertLess(i, src.index("save_state(state)\n        upload_submitted_threads"))


class SlotEmpty(unittest.TestCase):
    """SUP2 — 칸이 비었는데 접수할 키트가 없으면 가장 오래된 미접수 네이버 비공개 파일을 하루 1통."""
    ISSUES = {B: 8, C: 7}
    FILES = [("1020_health-x_네이버비공개.txt", r"d\1020_health-x_네이버비공개.txt", 300),
             ("1008_8호_네이버비공개.txt", r"d\1008_8호_네이버비공개.txt", 100),
             ("1008_8호_네이버비공개_본문.txt", r"d\1008_8호_네이버비공개_본문.txt", 99),
             ("1008_7호_네이버비공개.txt", r"d\1008_7호_네이버비공개.txt", 50),
             ("1008_99호_네이버비공개.txt", r"d\1008_99호_네이버비공개.txt", 10)]
    EMPTY = q.plan([], [{"slug": "a", "channel": "naver", "status": "submitted"},
                        {"slug": "b", "channel": "naver", "status": "submitted"}], {})   # 칸 1 빔 · 다음 없음

    def test_label_to_slug(self):
        self.assertEqual(q.label_to_slug("8호", self.ISSUES), B)
        self.assertEqual(q.label_to_slug("health-x", self.ISSUES), "health-x")
        self.assertIsNone(q.label_to_slug("99호", self.ISSUES), "모르는 호수는 버린다")

    def test_backlog_oldest_unsubmitted_main_approved_first(self):
        rv = [{"slug": C, "channel": "naver", "status": "approved"},          # 7호 네이버 끝남 → 제외
              {"slug": "health-x", "channel": "main", "status": "approved"}]
        b = q.private_backlog(self.FILES, self.ISSUES, rv)
        self.assertEqual([x["label"] for x in b], ["health-x", "8호"], "본진 승인 글 먼저, 그 안에서 오래된 순 · _본문 제외")
        b = q.private_backlog(self.FILES, self.ISSUES, rv[:1] + [{"slug": B, "channel": "main", "status": "approved"},
                                                                 {"slug": "health-x", "channel": "main", "status": "approved"}])
        self.assertEqual(b[0]["label"], "8호", "둘 다 본진 승인이면 오래된 것")

    def test_backlog_rejected_naver_stays_and_kit_excluded(self):
        rv = [{"slug": B, "channel": "naver", "status": "rejected"}]
        self.assertIn("8호", [x["label"] for x in q.private_backlog(self.FILES, self.ISSUES, rv)], "반송은 다시 할 대상")
        b = q.private_backlog(self.FILES, self.ISSUES, [], has_kit=lambda lb: lb == "8호")
        self.assertNotIn("8호", [x["label"] for x in b], "키트가 있으면 「다음 접수」 몫")

    def test_message(self):
        b = q.private_backlog(self.FILES, self.ISSUES, [])
        m = q.slot_nudge_message(self.EMPTY, b)
        self.assertEqual(m, r"칸 1 빔 · 다음 할 일: 네이버 비공개 게시 → 캡처 · 파일: d\1008_7호_네이버비공개.txt")
        self.assertIn("원고 공급", q.slot_nudge_message(self.EMPTY, []))
        full = q.plan([], [{"slug": s, "channel": "naver", "status": "submitted"} for s in "abc"], {})
        self.assertIsNone(q.slot_nudge_message(full, b), "칸이 다 차면 없음")
        ready = q.plan(ORDER, [], KITS)
        self.assertIsNone(q.slot_nudge_message(ready, b), "접수할 키트가 있으면 「다음 접수」가 말한다")

    def test_once_a_day(self):
        orig = (q.current, q.fetch_reviews, q.list_private_files)
        q.current = lambda env: ([], self.EMPTY)
        q.fetch_reviews = lambda env: []
        q.list_private_files = lambda folder=None: self.FILES[:2]
        sent, st = [], {}
        try:
            m = q.notify_slot_empty({}, st, notify=lambda t: sent.append(t) or True, log=lambda *_: None, today="2026-10-25")
            self.assertTrue(m.startswith("칸 1 빔 · 다음 할 일: 네이버 비공개 게시 → 캡처 · 파일: "), m)
            self.assertIsNone(q.notify_slot_empty({}, st, notify=lambda t: sent.append(t) or True,
                                                  log=lambda *_: None, today="2026-10-25"), "같은 날 두 번 안 보냄")
            self.assertEqual(len(sent), 1)
            q.notify_slot_empty({}, st, notify=lambda t: sent.append(t) or True, log=lambda *_: None, today="2026-10-26")
            self.assertEqual(len(sent), 2, "다음 날 다시")
            st2 = {}
            q.notify_slot_empty({}, st2, notify=lambda t: False, log=lambda *_: None, today="2026-10-25")
            self.assertNotIn("slot_nudge_day", st2, "보내기 실패면 다음 바퀴에 다시")
            st3 = {}
            q.current = lambda env: ([], q.plan(ORDER, [], KITS))
            self.assertIsNone(q.notify_slot_empty({}, st3, notify=lambda t: sent.append(t) or True,
                                                  log=lambda *_: None, today="2026-10-25"))
            self.assertNotIn("slot_nudge_day", st3, "키트가 있는 날은 하루 한도를 쓰지 않는다")
        finally:
            q.current, q.fetch_reviews, q.list_private_files = orig

    def test_pams_auto_hook(self):
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pams_auto.py"), encoding="utf-8") as fp:
            src = fp.read()
        i = src.index("pams_queue.notify_slot_empty(env, state")
        self.assertIn("except Exception", src[i:i + 200])
        self.assertLess(src.index("pams_queue.notify_next(env, state"), i)
        self.assertLess(i, src.index("save_state(state)\n        upload_submitted_threads"))


class NaverGuide(unittest.TestCase):
    def test_due_after_main_submitted(self):
        rv = [{"slug": C, "channel": "main", "status": "submitted"}]
        self.assertEqual(q.naver_guides_due(ORDER, rv, {}), [C])

    def test_not_due_before_main(self):
        self.assertEqual(q.naver_guides_due(ORDER, [], {}), [])
        self.assertEqual(q.naver_guides_due(ORDER, [{"slug": C, "channel": "main", "status": "rejected"}], {}), [])

    def test_not_due_when_sent_or_naver_done_or_failed_out(self):
        rv = [{"slug": C, "channel": "main", "status": "approved"}]
        self.assertEqual(q.naver_guides_due(ORDER, rv, {"naver_guide_sent": {C: "t"}}), [])
        self.assertEqual(q.naver_guides_due(ORDER, rv + [{"slug": C, "channel": "naver", "status": "submitted"}], {}), [])
        self.assertEqual(q.naver_guides_due(ORDER, rv, {"naver_guide_fail": {C: q.GUIDE_MAX_TRY}}), [])
        self.assertEqual(q.naver_guides_due(ORDER, rv, {"naver_guide_fail": {C: 1}}), [C])

    def test_only_queue_naver_items(self):
        rv = [{"slug": A, "channel": "main", "status": "submitted"}]   # 9호는 운영표에 네이버 항목이 없다
        self.assertEqual(q.naver_guides_due(ORDER, rv, {}), [])

    def test_send_records_once_and_retries_failures(self):
        import contextlib
        rv = [{"slug": C, "channel": "main", "status": "submitted"}]
        orig = (q.fetch_reviews, q.load_queue, q.kit.fetch_article)
        q.fetch_reviews = lambda env: rv
        q.load_queue = lambda path=None: (3, ORDER)
        q.kit.fetch_article = lambda env, slug: {"slug": slug, "id": "x"}
        sent, notes, st = [], [], {}
        srv = lambda: contextlib.nullcontext("srv")
        try:
            ok = q.send_naver_guides({}, st, notes.append, log=lambda *_: None, server_factory=srv,
                                     build=lambda env, art, s: {"png": "p.png"}, send=lambda env, res: sent.append(res))
            self.assertEqual(ok, [C]); self.assertIn(C, st["naver_guide_sent"]); self.assertEqual(len(sent), 1)
            self.assertEqual(q.send_naver_guides({}, st, notes.append, log=lambda *_: None, server_factory=srv,
                                                 build=lambda *a: {"png": "p"}, send=lambda *a: sent.append(1)), [])
            st2 = {}
            def boom(*a): raise RuntimeError("compose 409")
            for _ in range(q.GUIDE_MAX_TRY):
                q.send_naver_guides({}, st2, notes.append, log=lambda *_: None, server_factory=srv, build=boom, send=boom)
            self.assertEqual(st2["naver_guide_fail"][C], q.GUIDE_MAX_TRY)
            self.assertTrue(any("수동: python scripts/naver_private_guide.py" in n for n in notes))
            self.assertEqual(q.send_naver_guides({}, st2, notes.append, log=lambda *_: None, server_factory=srv, build=boom, send=boom), [])
        finally:
            q.fetch_reviews, q.load_queue, q.kit.fetch_article = orig

    def test_pams_auto_hook(self):
        src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pams_auto.py"), encoding="utf-8").read()
        i = src.index("pams_queue.send_naver_guides(env, state")
        self.assertIn("except Exception", src[i:i + 200])
        self.assertLess(i, src.index("save_state(state)\n        upload_submitted_threads"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
