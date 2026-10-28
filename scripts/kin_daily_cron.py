#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hermes no-agent cron 래퍼 — 매일 아침 지식iN 하루치(KIN1, 2026-10-29).

    py -3.14 -X utf8 D:/dev/SHIN/scripts/kin_daily_cron.py          # 실행
    py -3.14 -X utf8 D:/dev/SHIN/scripts/kin_daily_cron.py --check  # main 브랜치 확인만

순서: ① sync-watcher(PAMS 감시기 승인 행 → ad_reviews·상태, 새 승인은 「게시할 묶음」 텔레그램)
      ② run --n 5(수집 → 점수 → 초안 → 게이트 → 키트, 「오늘 제출할 지식인 N건」 텔레그램)
왜 여기 두나: 지금 hermes 의 kin_daily.py(저장소 밖)는 run 결과의 종료코드만 보고 ✅ 를 찍어,
  10/26~28 검색 API 401 로 「질문 0」인 날도 ✅ 였다. 이제 run 이 수집 전부 실패면 종료코드 1 + 알림.
종료코드: 0 = 정상(만든 것 0건 포함) · 1 = 수집·초안 실패 · 2 = main 아니라서 건너뜀(DD1 과 같은 규칙).
하지 않는 것: PAMS 「저장」「제출」 · 지식iN 게시 — 로버트 몫.
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

from draft_daily_cron import SKIP, current_branch, notify  # noqa: E402

N = 5


def steps(py=sys.executable):
    script = os.path.join(HERE, "kin_pipeline.py")
    return [("sync-watcher", [py, "-X", "utf8", script, "sync-watcher"]),
            ("run", [py, "-X", "utf8", script, "run", "--n", str(N)])]


def main(argv, run=subprocess.run, branch_fn=current_branch, notify_fn=notify):
    branch = branch_fn()
    if branch != "main":
        msg = f"오늘 지식인 건너뜀 — 저장소가 main 이 아니라 {branch or '브랜치 확인 불가'} 에 있다."
        print(msg, flush=True)
        if "--check" not in argv:
            notify_fn(msg)
        return SKIP
    if "--check" in argv:
        print("main 확인 — 실행 가능", flush=True)
        return 0
    rc = 0
    for name, cmd in steps():
        r = run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
                stdin=subprocess.DEVNULL, timeout=1500)
        print(f"[{name}] exit={r.returncode}\n{(r.stdout or '')[-3000:]}", flush=True)
        if r.returncode != 0:
            print(f"[{name}] stderr: {(r.stderr or '')[-1500:]}", flush=True)
            if name == "run":   # sync 실패는 run 을 막지 않는다
                rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
