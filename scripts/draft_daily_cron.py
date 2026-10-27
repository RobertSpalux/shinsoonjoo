#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hermes no-agent cron 래퍼 — 매일 06:30 draft_daily.py 를 부른다(DD1, 2026-10-27).

    py -3.14 -X utf8 D:/dev/SHIN/scripts/draft_daily_cron.py          # 실행
    py -3.14 -X utf8 D:/dev/SHIN/scripts/draft_daily_cron.py --check  # main 브랜치 확인만(생성·DB 쓰기 없음)

왜: SHIN_draft_daily 작업 스케줄러 등록은 정책으로 막혔고(schtasks 「persistence primitive」), 등록이 처음부터 없어
    10/21~ 일간 원고가 0편이었다. 게이트웨이 PATH 에 bash 가 없어 .sh 는 쓰지 않는다.

규칙(CLAUDE.md 8번 크론 규칙과 동일): 크론은 main 작업 트리에서 돈다 → 현재 브랜치가 main 이 아니면 **건너뛰고 알린다**.
종료코드: 0 = 원고 투입 성공 · 1 = 생성/투입 실패(draft_daily 가 이유를 이미 텔레그램에 알림) · 2 = main 아니라서 건너뜀.
하지 않는 것: PAMS · 게시 · ad_reviews. (draft_daily 의 범위를 그대로 따른다)
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SKIP = 2


def current_branch():
    """현재 브랜치명. git 이 실패하면 None(→ 건너뜀: 확인 못 하면 돌리지 않는다)."""
    try:
        r = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=ROOT,
                           capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def skip_message(branch):
    return f"오늘 원고 건너뜀 — 저장소가 main 이 아니라 {branch or '브랜치 확인 불가'} 에 있다. main 으로 돌려놓아야 일간 원고가 돈다."


def notify(text):
    try:
        import pams_kit as kit
        import draft_daily as dd
        dd.send(kit.load_env(), text)
    except Exception as e:   # 알림 실패가 종료코드를 바꾸지 않는다
        print(f"알림 실패: {type(e).__name__}: {e}", flush=True)


def main(argv):
    branch = current_branch()
    if branch != "main":
        msg = skip_message(branch)
        print(msg, flush=True)
        if "--check" not in argv:
            notify(msg)
        return SKIP
    if "--check" in argv:
        print("main 확인 — 실행 가능", flush=True)
        return 0
    r = subprocess.run([sys.executable, "-X", "utf8", os.path.join(HERE, "draft_daily.py")], cwd=ROOT)
    return r.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
