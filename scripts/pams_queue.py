#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PAMS 접수 순서(운영표) — 칸이 비면 로버트에게 「다음 접수: ○」 한 줄.

    python scripts/pams_queue.py          # 운영표 한 줄 + 지금 다음 접수(알림 안 보냄)

순서 = configs/pams_queue.json(단일 출처). pams_auto 가 매 바퀴 notify_next() 를 부른다.
  · 심사중 = ad_reviews.status ∈ {submitted, under_review} 전체 건수(팜스 한도 = [심사중] 3건, CLAUDE.md §6.4).
  · 끝난 항목 = 그 글·채널에 submitted/under_review/approved 행이 있음 → 건너뜀.
  · 다음 접수 = 끝나지 않았고 키트(zip)가 준비된 첫 항목. 키트 없는 항목(네이버 캡처 전 등)은 건너뛰고 한 줄 끝에 적는다.
  · 알림 = 빈 칸이 있고 (다음 항목, 빈 칸 수)가 지난번과 다를 때만 1통. 같은 상태로 10분마다 보내지 않는다.
"""
import glob
import json
import os
import sys

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_kit as kit  # noqa: E402

QUEUE_JSON = os.path.join(kit.ROOT, "configs", "pams_queue.json")
ACTIVE = ("submitted", "under_review")
DONE = ACTIVE + ("approved",)


def load_queue(path=QUEUE_JSON):
    q = json.load(open(path, encoding="utf-8"))
    return int(q.get("limit", 3)), q["order"]


def label(item):
    return f"{kit.issue_label(item['slug'])} {kit.CH_LABEL[item['channel']]}"


def find_kit(item, kit_dir=kit.KIT_DIR):
    """가장 최근 키트 zip(MMDD_N호_채널.zip). 없으면 None."""
    pat = os.path.join(kit_dir, f"*_{kit.issue_label(item['slug'])}_{kit.CH_LABEL[item['channel']]}.zip")
    hits = sorted(glob.glob(pat), key=os.path.getmtime)
    return hits[-1] if hits else None


# ── 순수 판정(시험 대상) ─────────────────────────────────────
def plan(order, reviews, kits, limit=3):
    """order: [{slug, channel}] · reviews: [{slug, channel, status}] · kits: {(slug, channel): zip경로|None}
    → {active, free, next(item|None), zip, waiting([item] 키트 없음), done([item])}"""
    active = sum(1 for r in reviews if r.get("status") in ACTIVE)
    done_keys = {(r["slug"], r["channel"]) for r in reviews if r.get("status") in DONE}
    done, waiting, nxt, zp = [], [], None, None
    for it in order:
        k = (it["slug"], it["channel"])
        if k in done_keys:
            done.append(it)
            continue
        if not kits.get(k):
            waiting.append(it)
            continue
        if nxt is None:
            nxt, zp = it, kits[k]
    return {"active": active, "free": max(0, limit - active), "next": nxt, "zip": zp,
            "waiting": waiting, "done": done, "limit": limit}


def message(p):
    """한 줄. 다음 항목이 없으면 None."""
    if not p["next"] or p["free"] <= 0:
        return None
    tail = ""
    if p["waiting"]:
        tail = " · 키트 대기: " + ", ".join(label(w) for w in p["waiting"])
    return f"다음 접수: {label(p['next'])} — {os.path.basename(p['zip'])} (빈 칸 {p['free']}/{p['limit']}){tail}"


def should_notify(p, state):
    """빈 칸이 있고 (다음 항목, 빈 칸 수)가 지난번과 다를 때만."""
    if not p["next"] or p["free"] <= 0:
        return False, None
    sig = f"{p['next']['slug']}|{p['next']['channel']}|{p['free']}"
    return sig != state.get("queue_notified"), sig


def order_line(order, p=None):
    """운영표 한 줄 — 끝난 항목은 ✓, 키트 없는 항목은 (키트 대기)."""
    done = {(i["slug"], i["channel"]) for i in (p["done"] if p else [])}
    wait = {(i["slug"], i["channel"]) for i in (p["waiting"] if p else [])}
    out = []
    for it in order:
        k = (it["slug"], it["channel"])
        s = label(it) + (" ✓" if k in done else " (키트 대기)" if k in wait else "")
        out.append(s)
    return " → ".join(out)


# ── 조회 ─────────────────────────────────────────────────────
def fetch_reviews(env):
    url, h = kit._rest(env)
    rv = url.rsplit("/", 1)[0] + "/ad_reviews"
    rows = requests.get(rv, params={"select": "channel,status,premium_articles(slug)",
                                    "status": "in.(submitted,under_review,approved)"}, headers=h, timeout=30).json()
    return [{"slug": (r.get("premium_articles") or {}).get("slug"), "channel": r["channel"], "status": r["status"]}
            for r in rows]


def current(env, kit_dir=kit.KIT_DIR):
    limit, order = load_queue()
    kits = {(it["slug"], it["channel"]): find_kit(it, kit_dir) for it in order}
    return order, plan(order, fetch_reviews(env), kits, limit)


def notify_next(env, state, notify, log=print):
    """pams_auto 한 바퀴에서 부른다. 보냈으면 그 한 줄을 돌려준다."""
    order, p = current(env)
    go, sig = should_notify(p, state)
    if go:
        msg = message(p)
        if notify(msg):
            state["queue_notified"] = sig
        log(f"큐 알림: {msg}")
        return msg
    return None


def main():
    env = kit.load_env()
    order, p = current(env)
    print("운영표:", order_line(order, p))
    print(f"심사중 {p['active']}/{p['limit']} · 빈 칸 {p['free']}")
    print(message(p) or "다음 접수: 없음(빈 칸 없음 또는 준비된 키트 없음)")


if __name__ == "__main__":
    main()
