#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI 작업 큐 로컬 러너 — API2(2026-10-15). 어드민 「초안 생성」·팩토리 생성을 Vercel 서버가 아니라 이 PC 가 한다.

    python scripts/ai_job_runner.py once [--max 5]      # 대기열을 비울 때까지(최대 N건) 처리하고 끝(1분 크론용)
    python scripts/ai_job_runner.py loop [--interval 15] # 상주 — interval 초마다 once
    python scripts/ai_job_runner.py status               # 상태별 건수

흐름: ai_jobs(sql/008) queued 행을 running 으로 집는다(status=queued 조건부 PATCH — 두 대가 같은 행을 못 집는다)
  → scripts/ai_job_worker.mts 가 `claude -p`(구독)로 생성하고 종전 route 와 같은 {status, body} 를 낸다
  → result·result_status 기록, 2xx 면 done · 아니면 error.

🔴 유료 API 차단
  · 워커에는 Supabase·텔레그램 변수만 골라 넘긴다. ANTHROPIC_API_KEY 등은 .env.local 에 있어도 넘기지 않는다.
  · 워커가 「API 변수가 보인다 / claude 가 없다」로 멈추면(stop) 작업을 queued 로 되돌리고 이번 회차를 끝낸다.
🔴 이 러너가 하지 않는 것: 게시·발송·PAMS. 생성물은 종전과 같이 초안(kin_answers '초안' · premium_articles 미발행)뿐.
"""
import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_kit as kit  # noqa: E402

ROOT = kit.ROOT
STATE_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "SHIN")
LOCK_PATH = os.path.join(STATE_DIR, "ai_job_runner.lock")
WORKER = "scripts/ai_job_worker.mts"
WORKER_TIMEOUT = 60 * 60            # 팩토리 = 2단계 × (1회 + 재생성 1회) × claude 20분 상한
STALE_AFTER = timedelta(minutes=75)  # running 이 이보다 오래면 러너가 죽은 것 — WORKER_TIMEOUT 보다 길게
MAX_PER_RUN = 5
# 워커에 넘기는 변수(이것만). API 키는 절대 넣지 않는다.
PASS_KEYS = ("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
             "AI_JOB_CLAUDE_MODEL", "CLAUDE_EXE")
DROP_KEYS = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")


class RunnerError(Exception):
    pass


def now_iso(now=None):
    return (now or datetime.now(timezone.utc)).isoformat()


# ── DB(PostgREST) ────────────────────────────────────────────
class Rest:
    def __init__(self, env, http=requests):
        base = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
        key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not base or not key:
            raise RunnerError("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다")
        self.url = f"{base}/rest/v1/ai_jobs"
        self.h = {"apikey": key, "Authorization": f"Bearer {key}"}
        self.http = http

    def get(self, params):
        r = self.http.get(self.url, params=params, headers=self.h, timeout=30)
        if r.status_code >= 300:
            raise RunnerError(f"ai_jobs 조회 실패 HTTP {r.status_code}")
        return r.json()

    def patch(self, params, body):
        r = self.http.patch(self.url, params=params, json=body, timeout=30,
                            headers={**self.h, "Content-Type": "application/json", "Prefer": "return=representation"})
        if r.status_code >= 300:
            raise RunnerError(f"ai_jobs 갱신 실패 HTTP {r.status_code}")
        return r.json()


def claim_next(rest, runner, now=None, tries=3):
    """가장 오래된 queued 1건을 running 으로. 다른 러너가 먼저 집었으면 다음 것을 본다."""
    for _ in range(tries):
        rows = rest.get({"select": "id,kind,payload,attempts", "status": "eq.queued", "order": "created_at.asc", "limit": "1"})
        if not rows:
            return None
        job = rows[0]
        got = rest.patch({"id": f"eq.{job['id']}", "status": "eq.queued"},
                         {"status": "running", "started_at": now_iso(now), "runner": runner,
                          "attempts": int(job.get("attempts") or 0) + 1, "error": None})
        if got:
            return job
    return None


def finish(rest, job_id, outcome, now=None):
    status = int(outcome.get("status") or 500)
    body = outcome.get("body") if isinstance(outcome.get("body"), dict) else {}
    ok = 200 <= status < 300
    rest.patch({"id": f"eq.{job_id}"},
               {"status": "done" if ok else "error", "result": body, "result_status": status,
                "error": None if ok else str(body.get("error") or f"HTTP {status}")[:500], "finished_at": now_iso(now)})
    return ok


def fail(rest, job_id, msg, now=None):
    rest.patch({"id": f"eq.{job_id}"}, {"status": "error", "error": str(msg)[:500], "finished_at": now_iso(now)})


def requeue(rest, job_id):
    rest.patch({"id": f"eq.{job_id}"}, {"status": "queued", "started_at": None, "runner": None})


def reap_stale(rest, now=None):
    """running 인데 STALE_AFTER 넘게 끝나지 않은 행 → error(러너가 중간에 꺼진 것). 건수 반환"""
    now = now or datetime.now(timezone.utc)
    rows = rest.get({"select": "id", "status": "eq.running", "started_at": f"lt.{now_iso(now - STALE_AFTER)}"})
    for row in rows:
        rest.patch({"id": f"eq.{row['id']}", "status": "eq.running"},
                   {"status": "error", "error": "러너 중단 — 시간 초과(다시 생성 버튼을 누르세요)", "finished_at": now_iso(now)})
    return len(rows)


# ── 워커 ────────────────────────────────────────────────────
def worker_env(loaded, base=None):
    """워커 환경 = 현재 환경 − API 키·중첩 표지 + Supabase·텔레그램 변수(loaded 에서 골라)."""
    base = dict(os.environ if base is None else base)
    env = {k: v for k, v in base.items() if k not in DROP_KEYS}
    for k in PASS_KEYS:
        if loaded.get(k):
            env[k] = loaded[k]
    return env


def run_worker(job, env):
    """워커 1회 → {status, body[, stop]}"""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fp:
        json.dump({"id": job["id"], "kind": job["kind"], "payload": job["payload"]}, fp, ensure_ascii=False)
        tmp = fp.name
    try:
        r = subprocess.run(f'npx tsx {WORKER} "{tmp}"', cwd=ROOT, shell=True, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=env, timeout=WORKER_TIMEOUT)
        lines = [ln for ln in (r.stdout or "").strip().splitlines() if ln.strip()]
        if not lines:
            raise RunnerError(f"워커 출력 없음 rc={r.returncode}: {(r.stderr or '').strip()[:300]}")
        try:
            out = json.loads(lines[-1])
        except json.JSONDecodeError:
            raise RunnerError(f"워커 출력이 JSON 아님 rc={r.returncode}: {lines[-1][:200]}")
        if not isinstance(out, dict) or "status" not in out:
            raise RunnerError("워커 출력 형식 오류")
        return out
    finally:
        os.unlink(tmp)


# ── 회차 ────────────────────────────────────────────────────
def run_once(rest, env, max_jobs=MAX_PER_RUN, worker=run_worker, runner=None, now_fn=None):
    """대기열 처리 1회차 → 로그 줄 목록"""
    now_fn = now_fn or (lambda: datetime.now(timezone.utc))
    runner = runner or socket.gethostname()
    log = []
    reaped = reap_stale(rest, now_fn())
    if reaped:
        log.append(f"⚠️ 멈춘 작업 {reaped}건 → error")
    for _ in range(max_jobs):
        job = claim_next(rest, runner, now_fn())
        if not job:
            break
        t0 = time.time()
        try:
            out = worker(job, env)
        except (RunnerError, subprocess.TimeoutExpired, OSError) as e:
            fail(rest, job["id"], f"러너: {e}", now_fn())
            log.append(f"✗ {job['kind']} {job['id']} — {e}")
            continue
        if out.get("stop"):
            requeue(rest, job["id"])
            log.append(f"⏸ {job['kind']} {job['id']} 대기열로 되돌림 — {out.get('body', {}).get('error', '')}")
            break
        ok = finish(rest, job["id"], out, now_fn())
        secs = round(time.time() - t0)
        msg = "" if ok else f" — {(out.get('body') or {}).get('error', '')}"
        log.append(f"{'✓' if ok else '✗'} {job['kind']} {job['id']} HTTP {out.get('status')} {secs}초{msg}")
    return log


# ── 잠금(1분 크론이 겹치지 않게) ───────────────────────────────
def acquire_lock(path=LOCK_PATH, stale=STALE_AFTER):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for _ in range(2):
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"{os.getpid()} {now_iso()}".encode())
            os.close(fd)
            return True
        except FileExistsError:
            age = time.time() - os.path.getmtime(path)
            if age < stale.total_seconds():
                return False
            os.unlink(path)  # 앞 회차가 죽고 남긴 잠금
    return False


def release_lock(path=LOCK_PATH):
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def cmd_once(env, max_jobs):
    if not acquire_lock():
        return ["앞 회차가 아직 돈다 — 건너뜀"]
    try:
        return run_once(Rest(env), worker_env(env), max_jobs=max_jobs)
    finally:
        release_lock()


def cmd_status(env):
    rows = Rest(env).get({"select": "status"})
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return [" · ".join(f"{k} {counts.get(k, 0)}" for k in ("queued", "running", "done", "error"))]


def main():
    ap = argparse.ArgumentParser(description="AI 작업 큐 로컬 러너(API2)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("once")
    p1.add_argument("--max", type=int, default=MAX_PER_RUN)
    p2 = sub.add_parser("loop")
    p2.add_argument("--interval", type=int, default=15)
    p2.add_argument("--max", type=int, default=MAX_PER_RUN)
    sub.add_parser("status")
    a = ap.parse_args()
    env = kit.load_env()
    try:
        if a.cmd == "status":
            print("\n".join(cmd_status(env)))
        elif a.cmd == "once":
            print("\n".join(cmd_once(env, a.max)) or "대기열 비어 있음")
        else:
            while True:
                try:
                    lines = cmd_once(env, a.max)
                except (RunnerError, requests.RequestException) as e:  # 상주는 일시 오류로 죽지 않는다
                    lines = [f"✗ {e}"]
                for line in lines:
                    print(f"[{datetime.now():%H:%M:%S}] {line}", flush=True)
                time.sleep(max(5, a.interval))
    except RunnerError as e:
        print(f"✗ {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
