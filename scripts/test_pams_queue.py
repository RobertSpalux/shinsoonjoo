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
        p = q.plan(ORDER, [], KITS)
        self.assertIn({"slug": C, "channel": "naver"}, p["waiting"])

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
        self.assertIn("키트 대기: 7호 네이버", m)

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
        self.assertTrue(line.startswith("9호 본진 ✓ → 8호 본진 → 7호 본진 → 7호 스레드 → 7호 네이버 (키트 대기)"), line)


class Config(unittest.TestCase):
    def test_config_main_first(self):
        limit, order = q.load_queue()
        self.assertEqual(limit, 3)
        chans = [o["channel"] for o in order]
        first_non_main = next((i for i, c in enumerate(chans) if c != "main"), len(chans))
        self.assertTrue(all(c != "main" for c in chans[first_non_main:]), "본진 먼저 — 본진이 다른 채널 뒤에 오면 안 된다")
        for o in order:
            self.assertIn(o["channel"], ("main", "naver", "threads"))


class AutoHook(unittest.TestCase):
    def test_pams_auto_calls_queue_and_isolates_failure(self):
        src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pams_auto.py"), encoding="utf-8").read()
        self.assertIn("pams_queue.notify_next(env, state", src)
        i = src.index("pams_queue.notify_next")
        self.assertIn("except Exception", src[i:i + 300])
        self.assertLess(i, src.index("save_state(state)\n        upload_submitted_threads"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
