#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PAMS 접수 폴더 정리 — 승인이 끝난 키트를 `_접수완료\\<채널>\\` 로 옮긴다(삭제 없음, 이동만).

    python scripts/pams_folder_tidy.py           # 드라이런(기본) — 옮길 목록만 출력
    python scripts/pams_folder_tidy.py --apply   # 실제로 옮긴다

로버트 2026-10-09 「접수된 건 파일 정리 — 문서만 쌓여간다」. 관제탑이 같은 날 07:30 손으로 한 번 정리한
배치(`_접수완료/{본진,네이버,스레드,네이버게시,네이버비공개,캡처}`)를 기계가 이어 받는다.

판정 — ad_reviews(status·channel·submitted_at)와 키트 txt 머리줄의 **slug** 를 대조한다.
   🔴 파일명의 「N호」로 글을 추측하지 않는다 — 머리줄(`[PAMS 접수 문자열] N호 · 채널 · slug` 등)의 slug 가 기준.
   같은 이름 줄기(MMDD_N호_채널 + .zip/.txt/.html/_본문.txt/_이미지N/.kit\\)는 txt 와 함께 묶어서 옮긴다.
   그 글·채널의 **가장 최근 심의 행**(submitted_at, 없으면 created_at)이
     · approved → 옮긴다. 단 본진·네이버 키트는 원고해시가 notes 에 기록됐거나(review_lock) 이미 게시된 뒤에만
       — review_lock.kit_hash 가 PAMS접수 맨 위 키트 txt 를 읽는다.
     · submitted·under_review(심사중) · rejected(보완) · 행 없음(미접수) → 그대로 둔다.
   스레드는 심사중인 스레드 행이 하나라도 있으면 그대로(접수 뒤 업로드가 키트를 읽는다).
   `_네이버게시\\`(공개 전환 안내)는 승인만으로는 안 옮긴다 — 네이버가 실제로 게시(is_naver_published)된 뒤에만.
   `캡처_처리됨\\` 은 머리줄이 없어 pams_auto 상태(captures[파일].slug)로 글을 찾는다.

대상 폴더에 같은 이름이 이미 있으면 옮기지 않고 「건너뜀」으로 출력한다(덮어쓰지 않는다).
키트를 만드는 쪽(pams_kit · naver_private_guide · pams_auto 한 바퀴)이 끝날 때 --apply 로 한 번 부른다.
"""
import argparse
import os
import re
import shutil
import sys

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_kit as kit  # noqa: E402
import review_lock  # noqa: E402

DONE_ROOT = "_접수완료"
ACTIVE = ("submitted", "under_review")
LABEL_CH = {v: k for k, v in kit.CH_LABEL.items()}   # 본진 → main …
HEAD_RX = re.compile(r"^\[(PAMS 접수 문자열|네이버 심의용 비공개 게시|네이버 승인 — 공개 전환)\]\s*(.+?)\s*$")
# (원본 하위 폴더, 머리줄 종류, 옮길 곳) — 원본 "" 는 PAMS접수 맨 위
SOURCES = (
    ("", "PAMS 접수 문자열", None),   # None = 채널 이름(본진·네이버·스레드)
    ("_네이버비공개", "네이버 심의용 비공개 게시", "네이버비공개"),
    ("_네이버게시", "네이버 승인 — 공개 전환", "네이버게시"),
)
CAPTURE_SRC, CAPTURE_DST = "캡처_처리됨", "캡처"


# ── 순수 함수(시험 대상) ─────────────────────────────────────
def parse_head(line):
    """키트 txt 첫 줄 → (종류, slug, channel) | None. 채널이 머리줄에 없는 안내(비공개·공개 전환)는 naver."""
    m = HEAD_RX.match((line or "").lstrip("﻿"))
    if not m:
        return None
    parts = [p.strip() for p in m.group(2).split(" · ")]
    if m.group(1) == "PAMS 접수 문자열":
        if len(parts) != 3 or parts[1] not in LABEL_CH or not parts[2]:
            return None
        return m.group(1), parts[2], LABEL_CH[parts[1]]
    if len(parts) != 2 or not parts[1]:
        return None
    return m.group(1), parts[1], "naver"


def latest_rows(rows):
    """ad_reviews 행 → {(slug, channel): 가장 최근 행}. 최근 = submitted_at, 없으면 created_at."""
    out = {}
    for r in rows:
        slug = (r.get("premium_articles") or {}).get("slug")
        if not slug:
            continue
        k = (slug, r.get("channel"))
        at = r.get("submitted_at") or r.get("created_at") or ""
        if k not in out or at >= (out[k].get("submitted_at") or out[k].get("created_at") or ""):
            out[k] = r
    return out


def published(row, channel):
    a = row.get("premium_articles") or {}
    return bool(a.get("is_main_published" if channel == "main" else "is_naver_published"))


def decide(kind, slug, channel, rows):
    """→ (옮기나, 사유). rows = 이 글의 ad_reviews 전부."""
    mine = [r for r in rows if (r.get("premium_articles") or {}).get("slug") == slug and r.get("channel") == channel]
    last = latest_rows(mine).get((slug, channel))
    if not last:
        return False, "미접수(심의 행 없음)"
    st = last.get("status")
    if channel == "threads" and any(r.get("status") in ACTIVE for r in mine):
        return False, "심사중 스레드 행 있음"
    if st != "approved":
        return False, {"submitted": "심사중", "under_review": "심사중", "rejected": "반송(보완 대상)"}.get(st, f"상태 {st}")
    if kind == "네이버 승인 — 공개 전환":
        return (True, "네이버 게시 완료") if published(last, "naver") else (False, "승인 — 네이버 공개 전환 전")
    if kind == "PAMS 접수 문자열" and channel in ("main", "naver"):
        if not (review_lock.noted_hash(last.get("notes")) or published(last, channel)):
            return False, "승인 — 원고해시 기록·게시 전(review_lock 이 키트 txt 를 읽는다)"
    return True, "승인"


def group_members(names, stem):
    """같은 줄기의 파일·폴더 — stem.zip/.txt/.html/.kit, stem_본문.txt, stem_이미지1.png …"""
    return sorted(n for n in names if n == stem or n.startswith(stem + ".") or n.startswith(stem + "_"))


def plan(kit_dir, rows, captures=None, read_head=None):
    """→ [(원본 경로, 옮길 경로|None, 사유)]. 옮길 경로가 None 이면 그대로 둔다(사유 출력용)."""
    read_head = read_head or _read_head
    out = []
    for sub, kind, dst in SOURCES:
        src_dir = os.path.join(kit_dir, sub) if sub else kit_dir
        if not os.path.isdir(src_dir):
            continue
        names = os.listdir(src_dir)
        taken = set()
        for n in sorted(names):
            p = os.path.join(src_dir, n)
            if not n.endswith(".txt") or not os.path.isfile(p):
                continue
            head = parse_head(read_head(p))
            if not head or head[0] != kind:
                continue   # _본문.txt · 손으로 둔 메모 등 — 머리줄 없는 txt 는 판정하지 않는다
            _, slug, channel = head
            stem = n[:-4]
            members = [m for m in group_members(names, stem) if m not in taken]
            ok, why = decide(kind, slug, channel, rows)
            label = f"{kit.issue_label(slug)} {kit.CH_LABEL[channel]} · {why}"
            target = os.path.join(kit_dir, DONE_ROOT, dst or kit.CH_LABEL[channel])
            for m in members:
                taken.add(m)
                out.append((os.path.join(src_dir, m), os.path.join(target, m) if ok else None, label))
    cap_dir = os.path.join(kit_dir, CAPTURE_SRC)
    if os.path.isdir(cap_dir):
        for n in sorted(os.listdir(cap_dir)):
            slug = ((captures or {}).get(n) or {}).get("slug")
            if not slug:
                out.append((os.path.join(cap_dir, n), None, "캡처 · pams_auto 상태에 글 기록 없음"))
                continue
            ok, why = decide("캡처", slug, "naver", rows)
            out.append((os.path.join(cap_dir, n), os.path.join(kit_dir, DONE_ROOT, CAPTURE_DST, n) if ok else None,
                        f"{kit.issue_label(slug)} 네이버 캡처 · {why}"))
    return out


def _read_head(path):
    try:
        with open(path, encoding="utf-8-sig") as fp:
            return fp.readline().rstrip("\r\n")
    except (OSError, UnicodeDecodeError):
        return ""


def apply(moves, log=print):
    """옮길 것만 옮긴다. 대상에 같은 이름이 있으면 건너뛴다. → 옮긴 수."""
    n = 0
    for src, dst, why in moves:
        if not dst:
            continue
        if os.path.exists(dst):
            log(f"  건너뜀(대상에 같은 이름 있음): {src}")
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(src, dst)
        n += 1
    return n


def report(moves, kit_dir, applied):
    go = [(s, d, w) for s, d, w in moves if d]
    stay = [(s, d, w) for s, d, w in moves if not d]
    head = "옮김" if applied else "옮길 것(드라이런 — --apply 로 실행)"
    lines = [f"[PAMS 폴더 정리] {head} {len(go)}개 · 그대로 {len(stay)}개"]
    lines += [f"  → {os.path.relpath(s, kit_dir)}  ⇒  {os.path.relpath(d, kit_dir)}  ({w})" for s, d, w in go]
    lines += [f"  · {os.path.relpath(s, kit_dir)}  ({w})" for s, _, w in stay]
    return lines


# ── 조회 · 실행 ──────────────────────────────────────────────
def fetch_rows(env):
    url, h = kit._rest(env)
    rv = url.rsplit("/", 1)[0] + "/ad_reviews"
    r = requests.get(rv, params={"select": "channel,status,notes,submitted_at,created_at,"
                                           "premium_articles(slug,is_main_published,is_naver_published)"},
                     headers=h, timeout=30)
    r.raise_for_status()
    return r.json()


def load_captures():
    import pams_auto   # 지연 import — pams_auto 가 이 파일을 부른다
    return pams_auto.load_state().get("captures") or {}


def run(env, do_apply=False, kit_dir=kit.KIT_DIR, rows=None, captures=None, log=print):
    """키트 만드는 쪽이 끝날 때 부른다. 출력 줄 목록을 돌려준다."""
    if not os.path.isdir(kit_dir):
        return []
    rows = rows if rows is not None else fetch_rows(env)
    captures = captures if captures is not None else load_captures()
    moves = plan(kit_dir, rows, captures)
    if do_apply:
        apply(moves, log=log)
        # 10분 바퀴(pams_auto)에서 불린다 — 옮긴 게 없으면 조용히, 있으면 옮긴 줄만(그대로 목록은 드라이런에서 본다)
        moves = [m for m in moves if m[1] and not os.path.exists(m[0])]
        if not moves:
            return []
    lines = report(moves, kit_dir, do_apply)
    for ln in lines:
        log(ln)
    return lines


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true", help="기본값 — 목록만")
    g.add_argument("--apply", action="store_true", help="실제로 옮긴다(삭제 없음)")
    ap.add_argument("--dir", default=kit.KIT_DIR)
    a = ap.parse_args()
    run(kit.load_env(), do_apply=a.apply, kit_dir=a.dir)


if __name__ == "__main__":
    main()
