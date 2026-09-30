#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
심의본 = 게시본 대조 게이트 (원장 D0-1)

    python scripts/review_lock.py            # 현재 접수·승인 행의 대조 결과 표(읽기만)
    python scripts/review_lock.py --stamp    # 해시 기록이 없는 접수·승인 행에 키트 해시를 적는다

왜: 심의받은 원안과 한 글자라도 달라지면 원안 변경이다(CLAUDE.md §6.4 함정 3 · §6.11-9 — 연장 불가·미심의 광고).
    본진은 승인되면 **자동으로 공개**된다. 접수 뒤 누가 DB 원고를 고쳤다면 심의받지 않은 글이 나간다.

동작
  1. 기록 — 키트를 만들 때 원고 해시(kit.content_hash)를 키트 .txt 에 「원고해시: sha256 …」로 적는다.
     ad_reviews 행이 접수(submitted) 이상이 되면 pams_auto 가 그 해시를 notes 에 한 줄로 옮긴다
     (「원고해시 sha256 <64hex> (<키트>.zip)」). 스레드가 접수 원고 해시를 notes 에 남기는 것과 같은 방식.
  2. 대조 — publish_approved 가 게시(본진 자동 공개 · 네이버 공개 전환 안내) 직전에
     현재 DB 원고 해시와 notes 의 해시를 비교한다.
       같음 → 진행
       다름 → **게시를 막고** PAMS 알림방(텔레그램)으로 1통. 같은 상태로는 다시 보내지 않는다.
       기록 없음 → 본진은 막는다(되돌릴 수 없는 공개). 네이버는 사람이 공개 전환하므로 안내에 경고만 붙인다.
  해시 대상 필드 = kit.content_hash 와 같다(본진: 제목·분류·요약·핵심·본문 등 / 네이버: 네이버 제목·본문).
"""
import argparse
import glob
import os
import re
import sys
from datetime import datetime

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_kit as kit  # noqa: E402

NOTE_RX = re.compile(r"원고해시\s*sha256\s*([0-9a-f]{64})")
TXT_RX = re.compile(r"^원고해시:\s*sha256\s*([0-9a-f]{64})", re.M)
LOCKED = ("submitted", "under_review", "approved")
CHANNELS = ("main", "naver")


# ── 순수(시험 대상) ───────────────────────────────────────────
def txt_line(h):
    """키트 .txt 에 넣는 줄."""
    return f"원고해시: sha256 {h}"


def note_line(h, kit_name, when):
    return f"{when} 심의본 원고해시 sha256 {h} ({kit_name})"


def noted_hash(notes):
    """notes 에 적힌 해시 — 여러 번 적혔으면 **마지막**(가장 최근 접수분)."""
    m = NOTE_RX.findall(notes or "")
    return m[-1] if m else None


def txt_hash(text):
    m = TXT_RX.search(text or "")
    return m.group(1) if m else None


def verdict(current_hash, notes):
    """→ (상태, 기록된 해시). 상태: ok | mismatch | missing"""
    h = noted_hash(notes)
    if not h:
        return "missing", None
    return ("ok" if h == current_hash else "mismatch"), h


def blocks(state, channel):
    """게시를 막는가 — 다르면 항상, 기록 없음은 본진만."""
    return state == "mismatch" or (state == "missing" and channel == "main")


def message(title_label, channel, state, noted, current):
    ch = kit.CH_LABEL.get(channel, channel)
    if state == "mismatch":
        return (f"⛔ [게시 막음] {title_label} {ch} — 심의본과 현재 원고가 다릅니다(원안 변경).\n"
                f"심의본 {noted[:12]}… ≠ 현재 {current[:12]}…\n"
                "원고를 심의본으로 되돌리거나, 바꾼 원고로 신규 심의를 받아야 합니다. 그 전까지 자동 게시하지 않습니다.")
    return (f"⛔ [게시 막음] {title_label} {ch} — 심의본 원고해시 기록이 없어 대조할 수 없습니다.\n"
            "접수한 키트와 현재 원고가 같은지 사람이 확인한 뒤 `python scripts/review_lock.py --stamp` 또는 어드민에서 발행하세요.")


# ── 키트 해시 찾기 · 기록 ─────────────────────────────────────
def kit_hash(slug, channel, kit_dir=kit.KIT_DIR, state=None):
    """그 글·채널의 가장 최근 키트 해시 → (해시, 키트이름). 키트 .txt 의 줄이 먼저, 없으면 pams_auto 상태."""
    pat = os.path.join(kit_dir, f"*_{kit.issue_label(slug)}_{kit.CH_LABEL[channel]}.txt")
    for p in sorted(glob.glob(pat), key=os.path.getmtime, reverse=True):
        h = txt_hash(open(p, encoding="utf-8").read())
        if h:
            return h, os.path.basename(p)[:-4] + ".zip"
    rec = ((state or {}).get("kits") or {}).get(f"{slug}|{channel}")
    if rec and rec.get("hash"):
        return rec["hash"], os.path.basename(rec.get("zip") or "") or "pams_auto 상태"
    return None, None


def fetch_locked_rows(env):
    url, h = kit._rest(env)
    rv = url.rsplit("/", 1)[0] + "/ad_reviews"
    return requests.get(rv, params={"select": "id,channel,status,notes,premium_articles(slug,title)",
                                    "channel": "in.(main,naver)", "status": "in.(submitted,under_review,approved)"},
                        headers=h, timeout=30).json()


def stamp(env, state=None, log=print, kit_dir=kit.KIT_DIR, patch=None, rows=None, only_unpublished=True):
    """해시 기록이 없는 접수·승인 행에 키트 해시를 적는다. 적은 (slug, channel) 목록.
    이미 공개된 글(옛 승인분)은 건드리지 않는다 — 대조할 게시가 남아 있지 않다."""
    url, h = kit._rest(env)
    rv = url.rsplit("/", 1)[0] + "/ad_reviews"
    done = []
    for r in (rows if rows is not None else fetch_locked_rows(env)):
        if noted_hash(r.get("notes")):
            continue
        slug = (r.get("premium_articles") or {}).get("slug")
        if not slug:
            continue
        if only_unpublished:
            art = kit.fetch_article(env, slug)
            flag = "is_main_published" if r["channel"] == "main" else "is_naver_published"
            if art.get(flag):
                continue
        hh, name = kit_hash(slug, r["channel"], kit_dir, state)
        if not hh:
            continue
        head = (r.get("notes") or "").rstrip()
        notes = (head + "\n" if head else "") + note_line(hh, name, f"{datetime.now(kit.KST):%m-%d %H:%M}")
        if patch:
            patch(r["id"], notes)
        else:
            q = requests.patch(rv, params={"id": f"eq.{r['id']}"}, json={"notes": notes},
                               headers={**h, "Prefer": "return=minimal"}, timeout=30)
            if not q.ok:
                log(f"원고해시 기록 실패 {slug} {r['channel']} — {q.status_code}")
                continue
        log(f"원고해시 기록: {kit.issue_label(slug)} {kit.CH_LABEL[r['channel']]} {hh[:12]}… ({name})")
        done.append((slug, r["channel"]))
    return done


def check(env, slug, channel, notes):
    """게시 직전 대조 → (상태, 기록 해시, 현재 해시)."""
    cur = kit.content_hash(kit.fetch_article(env, slug), channel)
    st, noted = verdict(cur, notes)
    return st, noted, cur


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stamp", action="store_true")
    a = ap.parse_args()
    env = kit.load_env()
    if a.stamp:
        import pams_auto
        print("기록:", stamp(env, pams_auto.load_state()) or "없음")
    for r in fetch_locked_rows(env):
        art = r.get("premium_articles") or {}
        st, noted, cur = check(env, art.get("slug"), r["channel"], r.get("notes"))
        mark = {"ok": "같음", "mismatch": "🔴 다름", "missing": "기록 없음"}[st]
        print(f"{kit.title_label(art.get('title'), art.get('slug'))[:30]:30} {kit.CH_LABEL[r['channel']]} {r['status']:9} {mark}"
              + (f" (심의본 {noted[:12]}… / 현재 {cur[:12]}…)" if st == "mismatch" else ""))


if __name__ == "__main__":
    main()
