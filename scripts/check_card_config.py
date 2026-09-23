# -*- coding: utf-8 -*-
"""카드 config 폭 검사 — fit_or_fail (설계안 §1, 2026-09-23 실측 반영).

🔴 왜 생겼나
  5호 첫 렌더에서 표 칸이 겹쳐 읽을 수 없었다(로버트 실측). naver_images.py 의
  `wrap()` 은 폭을 넘으면 줄을 늘리는데, 행 높이(row_h=108)는 고정이라 **줄이 늘면
  아래 행을 침범한다.** 렌더러는 그래도 이미지를 만들어 낸다 — 조용히 못 읽는 카드가
  심의에 첨부되는 경로다.

  설계안(§1)의 원칙 그대로다: **조용히 잘린 이미지를 심의에 내는 것보다 렌더가 멈추는
  쪽이 낫다.** 다만 렌더러는 관제탑 샌드박스(리눅스 폰트) 전용이라 여기서 못 돌린다.
  그래서 이 검사는 **폰트 없이** 돌아가야 한다.

판정은 두 겹이고, 겹마다 무게가 다르다.
  ① **실패 — 폭을 재서 확실히 넘치는 것만.**
     · 헤더(col_before/col_after)가 열 폭을 넘음 — 헤더는 wrap 되지 않아 **옆 칸을 덮는다**
     · table_note 한 줄이 카드 폭을 넘음
     · 표 칸이 **4줄 이상** — 근사가 한 줄 틀려도 실제 3줄이라 row_h 를 확실히 넘는다
  ② **경고 — 위험 신호이되 단정하지 않는 것.**
     · 자수 한계 초과(열 제목 6 · before 10 · after 12, 로버트 실측 2026-09-23)
     · 표 칸 3줄

  ⚠️ **자수를 실패로 두면 안 되는 이유가 실측으로 나왔다.** 이 규칙을 기존 config 8개에
     걸었더니 7개가 실패했는데, 그중 다수가 **이미 심의를 통과해 게시된 글**이다.
     「2020.3.31 이전」은 12자지만 숫자·점이라 실제 폭은 한글 6자보다 좁다.
     자수는 사람이 config 를 쓸 때 겨냥할 선이고, 겹침 여부를 정하는 것은 폭이다.

  ⚠️ 근사는 실제로 틀린다: 계수 1.0 에서 「부위의 진단·치료 여부」를 3줄로 셌으나
     렌더는 2줄이었다. 그래서 2줄 초과가 아니라 **3줄 초과**를 실패선으로 잡는다.

  🔴 **폭의 최종 판정자는 여기가 아니다.** 폰트를 가진 렌더러(naver_images.py) 안의
     fit_or_fail 이 진짜 게이트다(설계안 §1 우선순위 1). 이 파일은 그 앞단에서
     **사람이 config 를 쓰는 순간** 걸러 주는 자수 게이트다. 둘은 대체 관계가 아니다.

렌더러 실측 좌표 (naver_images.py 표 카드):
  W=800 · pad=64 · col2=pad+300 · col3=pad+500 · row_h=108
  before 폭 = col3-col2-24 = 176 · 25px regular · 줄간 34
  after  폭 = W-pad-col3   = 172 · 27px bold    · 줄간 36
  헤더(col_before/col_after)는 **wrap 하지 않는다** — 넘치면 옆 칸을 덮는다.
"""
import json
import os
import sys
import unicodedata

# 렌더러와 같은 값이어야 한다. naver_images.py 를 고치면 여기도 고친다.
W, PAD, ROW_H = 800, 64, 108
COL2, COL3 = PAD + 300, PAD + 500
BEFORE_W, BEFORE_SIZE = COL3 - COL2 - 24, 25
AFTER_W, AFTER_SIZE = W - PAD - COL3, 27
HEAD_W_BEFORE, HEAD_W_AFTER, HEAD_SIZE = COL3 - COL2, W - PAD - COL3, 24
NOTE_W, NOTE_SIZE = W - 2 * PAD, 21
POINT_W, POINT_SIZE = W - 2 * PAD - 56, 25  # ③ 카드 번호 들여쓰기 제외

# 자수 한계 (로버트 실측 2026-09-23)
MAX_HEAD, MAX_BEFORE, MAX_AFTER = 6, 10, 12
WARN_LINES = 2   # 2줄까지가 안전. 3줄이면 아래 행에 닿기 시작한다 → 경고
FAIL_LINES = 3   # 4줄 이상이면 근사가 한 줄 틀려도 확실히 덮는다 → 실패


def char_w(ch, size):
    """근사 글자 폭. 폰트가 없는 환경에서 도는 것이 이 함수의 존재 이유다."""
    if ch == " ":
        return size * 0.28
    if unicodedata.east_asian_width(ch) in ("W", "F"):
        # 0.93 은 5호 렌더 실측 역산이다(after 172px 에 「무진단·무치료」가 한 줄로 들어간다).
        # 1.0 으로 두면 실제로는 2줄인 칸을 3줄로 세어 멀쩡한 config 를 막는다.
        return size * 0.93
    if ch.isdigit() or ch.isupper():
        return size * 0.55
    if ch.isalpha():
        return size * 0.5
    return size * 0.45  # · + / 기호류


def text_w(s, size):
    return sum(char_w(c, size) for c in s)


def wrap_lines(s, size, max_w):
    """naver_images.wrap() 과 같은 규칙 — 공백 우선, 단어 단위."""
    lines, cur = [], ""
    for wd in s.split(" "):
        trial = (cur + " " + wd).strip()
        if text_w(trial, size) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = wd
    if cur:
        lines.append(cur)
    return lines or [""]


def check(cfg):
    """(problems, notes) — problems 가 비어 있으면 통과."""
    bad, notes = [], []

    for key, limit, width in (("col_before", MAX_HEAD, HEAD_W_BEFORE),
                              ("col_after", MAX_HEAD, HEAD_W_AFTER)):
        v = str(cfg.get(key) or "")
        if len(v) > limit:
            notes.append(f"{key} {len(v)}자 — 한글 기준 {limit}자를 겨냥할 것 「{v}」")
        if text_w(v, HEAD_SIZE) > width:
            # 헤더는 wrap 되지 않는다. 넘치면 잘리는 게 아니라 옆 칸을 덮는다.
            bad.append(f"{key} 가 열 폭({width}px)을 넘어 옆 칸을 덮는다 — 「{v}」")

    for idx, row in enumerate(cfg.get("table_rows") or [], 1):
        if len(row) != 3:
            bad.append(f"table_rows[{idx}] 는 [라벨, before, after] 3칸이어야 한다")
            continue
        _, before, after = row
        for name, v, limit, size, width in (
            ("before", before, MAX_BEFORE, BEFORE_SIZE, BEFORE_W),
            ("after", after, MAX_AFTER, AFTER_SIZE, AFTER_W),
        ):
            v = str(v)
            if len(v) > limit:
                notes.append(f"{idx}행 {name} {len(v)}자 — 한글 기준 {limit}자를 겨냥할 것 「{v}」")
            n = len(wrap_lines(v, size, width))
            if n > FAIL_LINES:
                bad.append(f"{idx}행 {name} 가 {n}줄 — 아래 행을 덮는다(row_h={ROW_H}) 「{v}」")
            elif n > WARN_LINES:
                notes.append(f"{idx}행 {name} 가 {n}줄로 보인다 — 아래 행에 닿는다. 줄이는 편이 좋다 「{v}」")

    note = str(cfg.get("table_note") or "")
    if note:
        for ln in note.split("\n"):
            if text_w(ln, NOTE_SIZE) > NOTE_W:
                bad.append(f"table_note 한 줄이 폭({NOTE_W}px)을 넘는다 — "
                           f"줄바꿈으로 나눌 것 「{ln[:28]}…」")
        if len(note.split("\n")) > 3:
            bad.append("table_note 가 4줄 이상 — 카드 하단을 넘는다")

    title = str(cfg.get("title") or "")
    title_lines = len(title.split("\n"))
    if title_lines > 3:
        bad.append(f"title 이 {title_lines}줄 — 썸네일은 3줄까지")

    for i, p in enumerate(cfg.get("points") or [], 1):
        n = len(wrap_lines(str(p), POINT_SIZE, POINT_W))
        if n > 2:
            notes.append(f"points[{i}] 가 {n}줄 — 3장 카드가 길어진다(경고)")

    return bad, notes


def main():
    if len(sys.argv) < 2:
        sys.exit("사용법: python scripts/check_card_config.py <config.json | slug>")
    arg = sys.argv[1]
    path = arg if arg.endswith(".json") else os.path.join("configs", arg + ".json")
    if not os.path.exists(path):
        sys.exit(f"[없음] {path}")
    cfg = json.load(open(path, encoding="utf-8"))
    bad, notes = check(cfg)
    for n in notes:
        print("  경고 —", n)
    if bad:
        print(f"\n[fit_or_fail 실패] {path}")
        for b in bad:
            print("  ·", b)
        print("\n칸을 줄여라. 렌더는 실패한 config 로 돌리지 않는다.")
        sys.exit(1)
    print(f"[fit_or_fail 통과] {path}")


if __name__ == "__main__":
    main()
