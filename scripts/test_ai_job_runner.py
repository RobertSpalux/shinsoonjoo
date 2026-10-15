#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 작업 큐 러너 — python scripts/test_ai_job_runner.py (네트워크·DB·claude 호출 없음)

가짜 DB(ai_jobs 메모리 표)와 가짜 워커로 집기·기록·되돌리기·멈춘 작업 정리·잠금·환경 거르기를 본다.
워커(가짜 claude) 쪽은 scripts/ai_job_worker.test.mts.
"""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import ai_job_runner as r  # noqa: E402

T0 = datetime(2026, 10, 15, 9, 0, tzinfo=timezone.utc)


class FakeRest:
    """PostgREST eq./lt. 필터만 흉내 낸다."""

    def __init__(self, rows, steal_first=False):
        self.rows = rows
        self.patches = []
        self.steal_first = steal_first  # 첫 집기 직전에 다른 러너가 가져간 상황

    def _match(self, row, params):
        for k, v in params.items():
            if k in ("select", "order", "limit"):
                continue
            op, val = v.split(".", 1)
            if op == "eq" and str(row.get(k)) != val:
                return False
            if op == "lt" and not (row.get(k) and row[k] < val):
                return False
        return True

    def get(self, params):
        out = [x for x in self.rows if self._match(x, params)]
        out.sort(key=lambda x: x.get("created_at", ""))
        return out[: int(params.get("limit", 10 ** 6))]

    def patch(self, params, body):
        if self.steal_first and body.get("status") == "running":
            self.steal_first = False
            for x in self.rows:
                if self._match(x, params):
                    x["status"] = "running"
            return []
        hit = [x for x in self.rows if self._match(x, params)]
        for x in hit:
            x.update(body)
        self.patches.append((params, body))
        return hit


def job(i, status="queued", **kw):
    return {"id": f"j{i}", "kind": "kin_draft", "payload": {"q": i}, "status": status, "attempts": 0,
            "created_at": f"2026-10-15T08:0{i}:00+00:00", **kw}


class RunOnce(unittest.TestCase):
    def run_once(self, rest, worker, **kw):
        return r.run_once(rest, {}, worker=worker, runner="pc", now_fn=lambda: T0, **kw)

    def test_오래된_것부터_집어서_done(self):
        rest = FakeRest([job(2), job(1)])
        seen = []
        log = self.run_once(rest, lambda j, env: (seen.append(j["id"]), {"status": 200, "body": {"success": True}})[1])
        self.assertEqual(seen, ["j1", "j2"])
        self.assertTrue(all(x["status"] == "done" and x["result_status"] == 200 for x in rest.rows))
        self.assertTrue(all(x["attempts"] == 1 and x["runner"] == "pc" for x in rest.rows))
        self.assertEqual(len(log), 2)

    def test_2xx_아니면_error_와_사유(self):
        rest = FakeRest([job(1)])
        self.run_once(rest, lambda j, env: {"status": 400, "body": {"error": "연결 글을 찾을 수 없습니다."}})
        row = rest.rows[0]
        self.assertEqual((row["status"], row["result_status"], row["error"]), ("error", 400, "연결 글을 찾을 수 없습니다."))
        self.assertEqual(row["result"], {"error": "연결 글을 찾을 수 없습니다."})

    def test_워커_실패는_error(self):
        rest = FakeRest([job(1)])

        def boom(j, env):
            raise r.RunnerError("워커 출력 없음")
        log = self.run_once(rest, boom)
        self.assertEqual(rest.rows[0]["status"], "error")
        self.assertIn("워커 출력 없음", rest.rows[0]["error"])
        self.assertTrue(log[0].startswith("✗"))

    def test_stop_이면_되돌리고_회차_끝(self):
        rest = FakeRest([job(1), job(2)])
        calls = []
        log = self.run_once(rest, lambda j, env: (calls.append(1), {"status": 503, "stop": True, "body": {"error": "API 키 보임"}})[1])
        self.assertEqual(len(calls), 1)
        self.assertTrue(all(x["status"] == "queued" for x in rest.rows))
        self.assertIsNone(rest.rows[1 if rest.rows[0]["id"] == "j2" else 0].get("started_at"))
        self.assertIn("되돌림", log[0])

    def test_다른_러너가_먼저_집으면_다음_것(self):
        rest = FakeRest([job(1), job(2)], steal_first=True)
        seen = []
        self.run_once(rest, lambda j, env: (seen.append(j["id"]), {"status": 200, "body": {}})[1], max_jobs=1)
        self.assertEqual(seen, ["j2"])

    def test_최대_건수(self):
        rest = FakeRest([job(i) for i in range(1, 6)])
        self.run_once(rest, lambda j, env: {"status": 200, "body": {}}, max_jobs=2)
        self.assertEqual(sum(x["status"] == "done" for x in rest.rows), 2)

    def test_빈_대기열(self):
        self.assertEqual(self.run_once(FakeRest([]), lambda j, env: self.fail("호출 안 됨")), [])

    def test_멈춘_running_정리(self):
        old = (T0 - r.STALE_AFTER - timedelta(minutes=1)).isoformat()
        fresh = (T0 - timedelta(minutes=5)).isoformat()
        rest = FakeRest([job(1, "running", started_at=old), job(2, "running", started_at=fresh)])
        log = self.run_once(rest, lambda j, env: {"status": 200, "body": {}})
        self.assertEqual(rest.rows[0]["status"], "error")
        self.assertEqual(rest.rows[1]["status"], "running")
        self.assertIn("멈춘 작업 1건", log[0])


class Env(unittest.TestCase):
    def test_API_키는_안_넘기고_DB_변수만_넘긴다(self):
        loaded = {"NEXT_PUBLIC_SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "srk",
                  "ANTHROPIC_API_KEY": "sk-비밀", "OTHER_SECRET": "o"}
        base = {"PATH": "p", "ANTHROPIC_API_KEY": "sk-환경", "CLAUDECODE": "1", "ANTHROPIC_BASE_URL": "u"}
        env = r.worker_env(loaded, base)
        self.assertEqual(env, {"PATH": "p", "NEXT_PUBLIC_SUPABASE_URL": "https://x.supabase.co",
                               "SUPABASE_SERVICE_ROLE_KEY": "srk"})

    def test_Rest_변수_없으면_오류(self):
        with self.assertRaises(r.RunnerError):
            r.Rest({})


class Lock(unittest.TestCase):
    def test_겹치면_건너뛰고_오래된_잠금은_치운다(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "x.lock")
        self.assertTrue(r.acquire_lock(p))
        self.assertFalse(r.acquire_lock(p))
        old = os.path.getmtime(p) - r.STALE_AFTER.total_seconds() - 60
        os.utime(p, (old, old))
        self.assertTrue(r.acquire_lock(p))
        r.release_lock(p)
        self.assertFalse(os.path.exists(p))
        r.release_lock(p)  # 두 번 풀어도 괜찮다


class Finish(unittest.TestCase):
    def test_body_가_dict_아니면_빈_result(self):
        rest = FakeRest([job(1, "running")])
        self.assertFalse(r.finish(rest, "j1", {"status": 502, "body": "x"}, T0))
        self.assertEqual((rest.rows[0]["result"], rest.rows[0]["error"]), ({}, "HTTP 502"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
